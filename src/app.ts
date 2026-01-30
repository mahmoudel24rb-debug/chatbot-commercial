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

import { watiService } from './services/wati/WatiService.js';
import { conversationService } from './services/conversation/ConversationService.js';

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
// WEBHOOK WATI WHATSAPP
// ===========================================

// Anti-spam: ignorer les messages deja traites (WATI replay les anciens messages au reconnect)
const processedWatiMessages = new Set<string>();
const serverStartTime = Date.now();

app.post('/webhooks/wati', webhookLimiter, async (req: Request, res: Response) => {
  try {
    const payload = req.body;

    logger.info('Webhook WATI recu', {
      waId: payload.waId,
      senderName: payload.senderName,
      text: payload.text?.substring(0, 50),
    });

    const phone = payload.waId;
    const text = payload.text;

    // Si pas de waId, ignorer
    if (!phone) {
      res.status(200).json({ received: true });
      return;
    }

    // Dedup: ignorer les messages deja traites (WATI replay au reconnect)
    const rawPayload = req.body as Record<string, unknown>;
    const messageId = (rawPayload.id as string) || `${phone}:${text || ''}:${rawPayload.timestamp || ''}`;
    if (processedWatiMessages.has(messageId)) {
      logger.info('Message WATI deja traite (dedup)', { phone, messageId });
      res.status(200).json({ received: true });
      return;
    }
    processedWatiMessages.add(messageId);
    setTimeout(() => processedWatiMessages.delete(messageId), 10 * 60 * 1000);

    // Ignorer les messages arrives dans les 5 premieres secondes (batch replay WATI)
    if (Date.now() - serverStartTime < 5000) {
      logger.info('Message ignore - demarrage du serveur (anti-replay)', { phone });
      res.status(200).json({ received: true });
      return;
    }

    // Si pas de texte (image/video/audio), essayer d'analyser l'image
    if (!text) {
      const mediaType = rawPayload.type as string | undefined;
      const mediaUrl = rawPayload.data as string | undefined;

      logger.info('MEDIA WEBHOOK', { phone, type: mediaType, hasUrl: !!mediaUrl });

      const allowedForMedia = ['33685343973', '212695150281', '33621426352'];
      if (allowedForMedia.includes(phone) && watiService.isConfigured() && aiService.isConfigured()) {
        // Si c'est une image, essayer de l'analyser avec Claude Vision
        if (mediaType === 'image' && mediaUrl) {
          try {
            const media = await watiService.downloadMedia(mediaUrl);
            if (media) {
              const extracted = await aiService.analyzeImage(media.base64, media.mediaType);
              if (extracted) {
                logger.info('Image analyzed - extracted text', { phone, extracted });

                // Store pending confirmation and ask user to confirm
                const context = conversationService.getOrCreateContext(phone);
                (context as unknown as Record<string, unknown>).pendingImageData = extracted;
                conversationService.updateContext(phone, context);

                // Parse extracted data for display
                const macMatch = extracted.match(/MAC:\s*(.+)/i);
                const keyMatch = extracted.match(/Device Key:\s*(.+)/i);
                let confirmMsg = "I found the following from your screenshot:\n\n";
                if (macMatch) confirmMsg += `📍 MAC Address: ${macMatch[1].trim()}\n`;
                if (keyMatch) confirmMsg += `🔑 Device Key: ${keyMatch[1].trim()}\n`;
                confirmMsg += "\nIs this correct? Reply *yes* to confirm or *no* to re-send.";

                await watiService.sendMessage(phone, confirmMsg);
                res.status(200).json({ received: true });
                return;
              }
            }
          } catch (imgError) {
            logger.error('Erreur analyse image', { error: imgError, phone });
          }
        }

        // Fallback: image non lisible ou pas une image
        if (conversationService.hasContext(phone)) {
          await watiService.sendMessage(phone, "I couldn't read that image clearly. Could you type out the MAC Address and Device Key instead? 📝");
        }
      }
      res.status(200).json({ received: true });
      return;
    }

    // MODE TEST: ne repondre qu'aux numeros autorises
    const allowedNumbers = ['33685343973', '212695150281', '33621426352'];
    if (!allowedNumbers.includes(phone)) {
      logger.info('Message ignore - numero non autorise (mode test)', { phone });
      res.status(200).json({ received: true });
      return;
    }

    const adminPhone = config.admin?.phone;
    const isAdmin = !!(adminPhone && phone === adminPhone);

    // Mode admin: repondre comme assistant business, pas comme bot client
    if (isAdmin && aiService.isConfigured() && watiService.isConfigured()) {
      try {
        const result = await aiService.handleAdminMessage(phone, text);
        await watiService.sendMessage(phone, result.message);
        logger.info('Reponse admin envoyee via WATI', { to: phone });
      } catch (aiError) {
        logger.error('Erreur traitement admin (WATI)', { error: aiError, phone });
      }
      res.status(200).json({ received: true });
      return;
    }

    // Si pas de contexte existant, verifier que c'est un vrai premier message (greeting)
    // pour eviter de repondre aux conversations deja existantes apres un redemarrage
    if (!conversationService.hasContext(phone)) {
      const greetingsLatin = /^(hi|hello|hey|bonjour|salut|salam|yo|bonsoir|test|start|begin|hola|ciao)\b/i;
      const greetingsArabic = /^(السلام عليكم|السلام|مرحبا|اهلا|صباح الخير|مساء الخير)/;
      if (!greetingsLatin.test(text.trim()) && !greetingsArabic.test(text.trim())) {
        logger.info('Message ignore - pas un premier contact (pas de greeting)', { phone, text: text.substring(0, 30) });
        res.status(200).json({ received: true });
        return;
      }
    }

    // Check if user is confirming/rejecting image-extracted data
    if (conversationService.hasContext(phone)) {
      const ctx = conversationService.getOrCreateContext(phone);
      const pendingData = (ctx as unknown as Record<string, unknown>).pendingImageData as string | undefined;
      if (pendingData) {
        const lower = text.trim().toLowerCase();
        if (lower === 'yes' || lower === 'oui' || lower === 'y') {
          // Confirmed - process the extracted data as a normal message
          delete (ctx as unknown as Record<string, unknown>).pendingImageData;
          conversationService.updateContext(phone, ctx);
          logger.info('Image data confirmed by user', { phone, pendingData });

          if (aiService.isConfigured() && watiService.isConfigured()) {
            const result = await aiService.handleIncomingMessage(phone, pendingData);
            await watiService.sendMessage(phone, result.message);
            if (result.shouldNotifyAdmin && result.adminNotification) {
              notificationService.sendAdminNotification(result.adminNotification, result.context)
                .catch(e => logger.error('Erreur notif admin', { error: e }));
            }
          }
          res.status(200).json({ received: true });
          return;
        } else if (lower === 'no' || lower === 'non' || lower === 'n') {
          delete (ctx as unknown as Record<string, unknown>).pendingImageData;
          conversationService.updateContext(phone, ctx);
          if (watiService.isConfigured()) {
            await watiService.sendMessage(phone, "No worries! Please send another screenshot or type the MAC Address and Device Key manually 👍");
          }
          res.status(200).json({ received: true });
          return;
        }
        // If neither yes/no, clear pending and continue with normal flow
        delete (ctx as unknown as Record<string, unknown>).pendingImageData;
        conversationService.updateContext(phone, ctx);
      }
    }

    // Traiter le message avec le chatbot IA (mode client)
    if (aiService.isConfigured() && watiService.isConfigured()) {
      try {
        const result = await aiService.handleIncomingMessage(phone, text);

        // Envoyer la reponse via WATI
        await watiService.sendMessage(phone, result.message);

        logger.info('Reponse chatbot envoyee via WATI', {
          to: phone,
          state: result.context.state,
          shouldNotifyAdmin: result.shouldNotifyAdmin,
        });

        // Envoyer notification admin si necessaire
        if (result.shouldNotifyAdmin && result.adminNotification) {
          logger.warn('ADMIN NOTIFICATION (WATI)', {
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
        logger.error('Erreur traitement IA (WATI)', { error: aiError, phone });
      }
    }

    res.status(200).json({ received: true });

  } catch (error) {
    logger.error('Erreur webhook WATI', { error });
    res.status(200).json({ received: true });
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
