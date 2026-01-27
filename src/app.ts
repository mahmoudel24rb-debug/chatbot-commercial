import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config/index.js';
import { checkConnection as checkDbConnection, closePool } from './config/database.js';
import { checkConnection as checkRedisConnection, closeConnection as closeRedis } from './config/redis.js';
import { logger } from './utils/logger.js';
import { formatErrorResponse, normalizeError } from './utils/errors.js';
import testRoutes from './api/routes/test.routes.js';
import chatbotRoutes from './api/routes/chatbot.routes.js';
import { aiService } from './services/ai/AIService.js';
import { whatsappService } from './services/whatsapp/WhatsAppService.js';
import { notificationService } from './services/notification/NotificationService.js';
import { ghlService as _ghlService } from './services/gohighlevel/GoHighLevelService.js';
import { twilioService } from './services/twilio/TwilioService.js';

// Creer l'application Express
const app = express();

// Trust proxy pour ngrok/reverse proxy
app.set('trust proxy', 1);

// ===========================================
// MIDDLEWARE DE SECURITE
// ===========================================

// Helmet pour les headers de securite
app.use(helmet());

// CORS
app.use(
  cors({
    origin: config.isDevelopment ? '*' : config.apiBaseUrl,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Rate limiting global
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requetes par minute
  message: { error: { code: 'RATE_LIMIT', message: 'Trop de requetes' } },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// Parser JSON avec limite de taille
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ===========================================
// MIDDLEWARE DE LOGGING
// ===========================================

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
      duration: `${duration}ms`,
      ip: req.ip,
    });
  });

  next();
});

// ===========================================
// ROUTES HEALTH CHECK
// ===========================================

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: config.env,
  });
});

app.get('/health/detailed', async (_req: Request, res: Response) => {
  const dbOk = await checkDbConnection();
  const redisOk = await checkRedisConnection();

  const status = dbOk && redisOk ? 'ok' : 'degraded';
  const statusCode = dbOk && redisOk ? 200 : 503;

  res.status(statusCode).json({
    status,
    timestamp: new Date().toISOString(),
    services: {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
    },
  });
});

// ===========================================
// WEBHOOKS (a implementer)
// ===========================================

// Rate limiter specifique pour les webhooks
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
});

// Placeholder pour le webhook Meta Lead Ads
app.post('/webhooks/meta/leads', webhookLimiter, (req: Request, res: Response) => {
  logger.info('Webhook Meta Lead Ads recu', { body: req.body });
  // TODO: Implementer le traitement des leads
  res.status(200).json({ received: true });
});

// Placeholder pour le webhook WhatsApp - Verification
app.get('/webhooks/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    logger.info('Webhook WhatsApp verifie');
    res.status(200).send(challenge);
  } else {
    logger.warn('Verification webhook WhatsApp echouee');
    res.status(403).send('Forbidden');
  }
});

// Webhook WhatsApp - Messages entrants
app.post('/webhooks/whatsapp', webhookLimiter, async (req: Request, res: Response) => {
  // IMPORTANT: Repondre 200 immediatement pour eviter les retries
  res.status(200).json({ received: true });

  try {
    const body = req.body;

    // Verifier que c'est un message WhatsApp
    if (body.object !== 'whatsapp_business_account') {
      return;
    }

    // Extraire les messages
    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const messages = value.messages || [];

        for (const message of messages) {
          // Ignorer les messages non-texte pour l'instant
          if (message.type !== 'text') {
            logger.info('Message non-texte recu', { type: message.type, from: message.from });
            continue;
          }

          const phone = message.from;
          const text = message.text?.body;

          if (!phone || !text) continue;

          logger.info('Message WhatsApp recu', { from: phone, text: text.substring(0, 50) });

          // Traiter le message avec le chatbot IA
          if (aiService.isConfigured() && whatsappService.isConfigured()) {
            try {
              const result = await aiService.handleIncomingMessage(phone, text);

              // Envoyer la reponse
              await whatsappService.sendTextMessage(phone, result.message);

              logger.info('Reponse chatbot envoyee', {
                to: phone,
                state: result.context.state,
                shouldNotifyAdmin: result.shouldNotifyAdmin,
              });

              // Envoyer notification admin si necessaire
              if (result.shouldNotifyAdmin && result.adminNotification) {
                logger.warn('ADMIN NOTIFICATION', {
                  type: result.adminNotification.type,
                  message: result.adminNotification.message,
                });

                // Envoyer la notification WhatsApp a l'admin
                notificationService.sendAdminNotification(
                  result.adminNotification,
                  result.context
                ).catch((notifError) => {
                  logger.error('Erreur envoi notification admin', { error: notifError });
                });
              }
            } catch (aiError) {
              logger.error('Erreur traitement IA', { error: aiError, phone });
            }
          }
        }
      }
    }
  } catch (error) {
    logger.error('Erreur webhook WhatsApp', { error });
  }
});

// ===========================================
// WEBHOOK GOHIGHLEVEL
// ===========================================

app.post('/webhooks/gohighlevel', webhookLimiter, async (req: Request, res: Response) => {
  try {
    const rawPayload = req.body;

    // Extraire les champs selon la structure reelle de GHL
    const contactId = rawPayload.contact_id;
    const phone = rawPayload.phone;
    const contactName = rawPayload.full_name || rawPayload.first_name;
    // Le message peut etre soit un objet {type, body} soit une string
    const message = typeof rawPayload.message === 'object'
      ? rawPayload.message?.body
      : rawPayload.message;

    logger.info('Webhook GHL recu', {
      phone,
      contactId,
      contactName,
      message: message?.substring(0, 50),
    });

    if (!phone || !message || !contactId) {
      logger.warn('Donnees manquantes dans payload GHL', { phone, message, contactId });
      res.status(200).json({ received: true, reply: '' });
      return;
    }

    // Traiter le message avec le chatbot IA
    if (aiService.isConfigured()) {
      try {
        const result = await aiService.handleIncomingMessage(phone, message);

        logger.info('Reponse chatbot generee', {
          to: phone,
          contactId,
          contactName,
          state: result.context.state,
          shouldNotifyAdmin: result.shouldNotifyAdmin,
        });

        // Envoyer notification admin si necessaire (en arriere-plan)
        if (result.shouldNotifyAdmin && result.adminNotification) {
          logger.warn('ADMIN NOTIFICATION (GHL)', {
            type: result.adminNotification.type,
            message: result.adminNotification.message,
          });
        }

        // Retourner la reponse dans le body pour que GHL puisse l'utiliser
        res.status(200).json({
          received: true,
          reply: result.message,
          contactId: contactId,
          phone: phone,
        });
        return;

      } catch (aiError) {
        logger.error('Erreur traitement IA (GHL)', { error: aiError, phone, contactId });
        res.status(200).json({ received: true, reply: '', error: 'AI error' });
        return;
      }
    }

    // AI non configure
    res.status(200).json({ received: true, reply: '' });

  } catch (error) {
    logger.error('Erreur webhook GHL', { error });
    res.status(200).json({ received: true, reply: '' });
  }
});

// ===========================================
// WEBHOOK TWILIO WHATSAPP
// ===========================================

app.post('/webhooks/twilio', webhookLimiter, async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    logger.info('Webhook Twilio recu', {
      from: payload.From,
      profileName: payload.ProfileName,
      body: payload.Body?.substring(0, 50),
    });

    // Valider le payload
    if (!twilioService.validateWebhookPayload(payload)) {
      res.status(200).send('<Response></Response>');
      return;
    }

    // Extraire le numero de telephone (enlever whatsapp:+)
    const phone = twilioService.extractPhoneNumber(payload.From);
    const text = payload.Body;

    if (!phone || !text) {
      res.status(200).send('<Response></Response>');
      return;
    }

    // Traiter le message avec le chatbot IA
    if (aiService.isConfigured() && twilioService.isConfigured()) {
      try {
        const result = await aiService.handleIncomingMessage(phone, text);

        // Envoyer la reponse via Twilio
        await twilioService.sendMessage(phone, result.message);

        logger.info('Reponse chatbot envoyee via Twilio', {
          to: phone,
          state: result.context.state,
          shouldNotifyAdmin: result.shouldNotifyAdmin,
        });

        // Envoyer notification admin si necessaire
        if (result.shouldNotifyAdmin && result.adminNotification) {
          logger.warn('ADMIN NOTIFICATION (Twilio)', {
            type: result.adminNotification.type,
            message: result.adminNotification.message,
          });

          notificationService.sendAdminNotification(
            result.adminNotification,
            result.context
          ).catch((notifError) => {
            logger.error('Erreur envoi notification admin', { error: notifError });
          });
        }
      } catch (aiError) {
        logger.error('Erreur traitement IA (Twilio)', { error: aiError, phone });
      }
    }

    // Twilio attend une reponse TwiML vide (on repond via API)
    res.status(200).send('<Response></Response>');

  } catch (error) {
    logger.error('Erreur webhook Twilio', { error });
    res.status(200).send('<Response></Response>');
  }
});

// ===========================================
// ROUTES DE TEST
// ===========================================

app.use('/api/test', testRoutes);
app.use('/api/chatbot', chatbotRoutes);

// ===========================================
// ROUTES API (a implementer)
// ===========================================

// Placeholder pour l'API leads
app.get('/api/leads', (_req: Request, res: Response) => {
  // TODO: Implementer
  res.json({ leads: [], total: 0 });
});

app.get('/api/leads/:id', (req: Request, res: Response) => {
  // TODO: Implementer
  res.json({ id: req.params.id, message: 'Not implemented' });
});

// Placeholder pour l'API conversations
app.get('/api/conversations/:id', (req: Request, res: Response) => {
  // TODO: Implementer
  res.json({ id: req.params.id, messages: [] });
});

// Placeholder pour les stats
app.get('/api/stats', (_req: Request, res: Response) => {
  // TODO: Implementer
  res.json({
    totalLeads: 0,
    conversionRate: 0,
    messagesTotal: 0,
  });
});

// ===========================================
// GESTION DES ERREURS
// ===========================================

// Route 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route non trouvee',
    },
  });
});

// Gestionnaire d'erreurs global
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const error = normalizeError(err);

  // Logger l'erreur
  if (error.statusCode >= 500) {
    logger.error('Erreur serveur', {
      code: error.code,
      message: error.message,
      stack: error.stack,
    });
  } else {
    logger.warn('Erreur client', {
      code: error.code,
      message: error.message,
    });
  }

  // Reponse
  res.status(error.statusCode).json(formatErrorResponse(error));
});

// ===========================================
// DEMARRAGE DU SERVEUR
// ===========================================

async function startServer(): Promise<void> {
  try {
    // Verifier les connexions
    logger.info('Verification des connexions...');

    const dbOk = await checkDbConnection();
    if (!dbOk) {
      logger.warn('Base de donnees non disponible - le serveur demarre quand meme');
    }

    const redisOk = await checkRedisConnection();
    if (!redisOk) {
      logger.warn('Redis non disponible - le serveur demarre quand meme');
    }

    // Demarrer le serveur
    app.listen(config.port, () => {
      logger.info(`Serveur demarre sur le port ${config.port}`, {
        env: config.env,
        apiBaseUrl: config.apiBaseUrl,
      });
    });
  } catch (error) {
    logger.error('Erreur au demarrage du serveur', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Gestion de l'arret propre
async function shutdown(signal: string): Promise<void> {
  logger.info(`Signal ${signal} recu, arret en cours...`);

  try {
    await closePool();
    await closeRedis();
    logger.info('Arret propre termine');
    process.exit(0);
  } catch (error) {
    logger.error('Erreur lors de l\'arret', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Gestion des erreurs non gerees
process.on('uncaughtException', (error) => {
  logger.error('Exception non geree', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise rejetee non geree', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});

// Demarrer
startServer();

export default app;
