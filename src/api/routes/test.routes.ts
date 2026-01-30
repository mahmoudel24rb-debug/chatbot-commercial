import { Router, Request, Response } from 'express';
import { whatsappService } from '../../services/whatsapp/WhatsAppService.js';
import { aiService } from '../../services/ai/AIService.js';
import { logger } from '../../utils/logger.js';

const router = Router();

/**
 * POST /api/test/whatsapp
 * Envoie un message WhatsApp de test
 * Body: { to: string, message: string }
 */
router.post('/whatsapp', async (req: Request, res: Response) => {
  try {
    const { to, message } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: 'Parametres manquants: to et message requis',
      });
    }

    if (!whatsappService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service non configure',
      });
    }

    const result = await whatsappService.sendTextMessage(to, message);

    logger.info('Message WhatsApp test envoye', { to, messageId: result.messages[0]?.id });

    return res.json({
      success: true,
      data: {
        messageId: result.messages[0]?.id,
        to: result.contacts[0]?.wa_id,
      },
    });
  } catch (error) {
    logger.error('Erreur envoi WhatsApp test', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
    });
  }
});

/**
 * POST /api/test/whatsapp/buttons
 * Envoie un message avec boutons
 * Body: { to: string, text: string, buttons: [{id, title}] }
 */
router.post('/whatsapp/buttons', async (req: Request, res: Response) => {
  try {
    const { to, text, buttons } = req.body;

    if (!to || !text || !buttons) {
      return res.status(400).json({
        success: false,
        error: 'Parametres manquants: to, text et buttons requis',
      });
    }

    const result = await whatsappService.sendButtonMessage(to, text, buttons);

    return res.json({
      success: true,
      data: {
        messageId: result.messages[0]?.id,
      },
    });
  } catch (error) {
    logger.error('Erreur envoi boutons WhatsApp', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
    });
  }
});

/**
 * POST /api/test/ai
 * Teste la generation de reponse IA
 * Body: { message: string, context?: object }
 */
router.post('/ai', async (req: Request, res: Response) => {
  try {
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Parametre manquant: message requis',
      });
    }

    if (!aiService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'AI service non configure - cle API manquante',
      });
    }

    const response = await aiService.generateResponse(message, context);

    return res.json({
      success: true,
      data: {
        response: response.content,
        tokensUsed: response.tokensUsed,
        latencyMs: response.latencyMs,
        provider: response.provider,
      },
    });
  } catch (error) {
    logger.error('Erreur generation IA', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
    });
  }
});

/**
 * POST /api/test/ai/intent
 * Detecte l'intention d'un message
 * Body: { message: string }
 */
router.post('/ai/intent', async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Parametre manquant: message requis',
      });
    }

    const intent = await aiService.detectIntent(message);

    return res.json({
      success: true,
      data: intent,
    });
  } catch (error) {
    logger.error('Erreur detection intention', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erreur inconnue',
    });
  }
});

/**
 * GET /api/test/status
 * Verifie le statut des services
 */
router.get('/status', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    services: {
      whatsapp: whatsappService.isConfigured(),
      ai: aiService.isConfigured(),
    },
  });
});

export default router;
