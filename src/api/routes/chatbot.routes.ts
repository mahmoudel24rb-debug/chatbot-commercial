import { Router, Request, Response } from 'express';
import { aiService } from '../../services/ai/AIService.js';
import { whatsappService } from '../../services/whatsapp/WhatsAppService.js';
import { conversationService, PlanType } from '../../services/conversation/ConversationService.js';
import { logger } from '../../utils/logger.js';

const router = Router();

// ===========================================
// CHATBOT MESSAGE HANDLER
// ===========================================

/**
 * POST /api/chatbot/message
 * Process incoming message and generate response
 * Body: { phone: string, message: string }
 */
router.post('/message', async (req: Request, res: Response) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phone and message',
      });
    }

    if (!aiService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'AI service not configured',
      });
    }

    // Process message through AI
    const result = await aiService.handleIncomingMessage(phone, message);

    logger.info('Chatbot response generated', {
      phone,
      state: result.context.state,
      shouldNotifyAdmin: result.shouldNotifyAdmin,
    });

    return res.json({
      success: true,
      data: {
        response: result.message,
        state: result.context.state,
        shouldNotifyAdmin: result.shouldNotifyAdmin,
        adminNotification: result.adminNotification,
        intent: result.intent,
      },
    });
  } catch (error) {
    logger.error('Error processing chatbot message', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/chatbot/message-and-send
 * Process message AND send response via WhatsApp
 * Body: { phone: string, message: string }
 */
router.post('/message-and-send', async (req: Request, res: Response) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phone and message',
      });
    }

    if (!aiService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'AI service not configured',
      });
    }

    if (!whatsappService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service not configured',
      });
    }

    // Process message through AI
    const result = await aiService.handleIncomingMessage(phone, message);

    // Send response via WhatsApp
    const sendResult = await whatsappService.sendTextMessage(phone, result.message);

    logger.info('Chatbot message sent', {
      phone,
      messageId: sendResult.messages[0]?.id,
      state: result.context.state,
    });

    return res.json({
      success: true,
      data: {
        response: result.message,
        messageId: sendResult.messages[0]?.id,
        state: result.context.state,
        shouldNotifyAdmin: result.shouldNotifyAdmin,
        adminNotification: result.adminNotification,
      },
    });
  } catch (error) {
    logger.error('Error sending chatbot message', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ===========================================
// ADMIN ACTIONS
// ===========================================

/**
 * POST /api/chatbot/admin/activate-trial
 * Activate trial for a customer
 * Body: { phone: string, username: string, password: string, url: string }
 */
router.post('/admin/activate-trial', async (req: Request, res: Response) => {
  try {
    const { phone, username, password, url } = req.body;

    if (!phone || !username || !password || !url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phone, username, password, url',
      });
    }

    // Activate trial
    const result = aiService.activateTrial(phone, { username, password, url });

    // Send activation message via WhatsApp
    if (whatsappService.isConfigured()) {
      await whatsappService.sendTextMessage(phone, result.message);
    }

    logger.info('Trial activated', { phone, username });

    return res.json({
      success: true,
      data: {
        message: result.message,
        context: result.context,
      },
    });
  } catch (error) {
    logger.error('Error activating trial', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/chatbot/admin/activate-subscription
 * Activate subscription for a customer
 * Body: { phone: string, plan: string, username: string, password: string, url: string }
 */
router.post('/admin/activate-subscription', async (req: Request, res: Response) => {
  try {
    const { phone, plan, username, password, url } = req.body;

    if (!phone || !plan || !username || !password || !url) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phone, plan, username, password, url',
      });
    }

    // Validate plan
    const validPlans: PlanType[] = ['monthly', 'yearly', '2years', '3years', 'lifetime'];
    if (!validPlans.includes(plan as PlanType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid plan. Must be one of: ${validPlans.join(', ')}`,
      });
    }

    // Activate subscription
    const result = aiService.activateSubscription(phone, plan as PlanType, { username, password, url });

    // Send activation message via WhatsApp
    if (whatsappService.isConfigured()) {
      await whatsappService.sendTextMessage(phone, result.message);
    }

    logger.info('Subscription activated', { phone, plan, username });

    return res.json({
      success: true,
      data: {
        message: result.message,
        context: result.context,
      },
    });
  } catch (error) {
    logger.error('Error activating subscription', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/chatbot/admin/send-message
 * Send a custom message to a customer
 * Body: { phone: string, message: string }
 */
router.post('/admin/send-message', async (req: Request, res: Response) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phone and message',
      });
    }

    if (!whatsappService.isConfigured()) {
      return res.status(500).json({
        success: false,
        error: 'WhatsApp service not configured',
      });
    }

    // Send message
    const result = await whatsappService.sendTextMessage(phone, message);

    // Add to conversation history
    conversationService.addMessage(phone, {
      role: 'assistant',
      content: message,
      timestamp: new Date(),
      metadata: { triggeredAction: 'admin_manual_message' },
    });

    logger.info('Admin message sent', { phone, messageId: result.messages[0]?.id });

    return res.json({
      success: true,
      data: {
        messageId: result.messages[0]?.id,
      },
    });
  } catch (error) {
    logger.error('Error sending admin message', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ===========================================
// CUSTOMER CONTEXT
// ===========================================

/**
 * GET /api/chatbot/context/:phone
 * Get customer context
 */
router.get('/context/:phone', (req: Request, res: Response) => {
  try {
    const phone = req.params.phone as string;
    const context = conversationService.getOrCreateContext(phone);
    const history = conversationService.getHistory(phone, 20);

    return res.json({
      success: true,
      data: {
        context,
        history,
      },
    });
  } catch (error) {
    logger.error('Error getting context', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * PUT /api/chatbot/context/:phone
 * Update customer context
 * Body: Partial<CustomerContext>
 */
router.put('/context/:phone', (req: Request, res: Response) => {
  try {
    const phone = req.params.phone as string;
    const updates = req.body;

    const context = conversationService.updateContext(phone, updates);

    return res.json({
      success: true,
      data: { context },
    });
  } catch (error) {
    logger.error('Error updating context', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// ===========================================
// FOLLOW-UPS
// ===========================================

/**
 * GET /api/chatbot/follow-ups
 * Get all customers needing follow-up
 */
router.get('/follow-ups', (_req: Request, res: Response) => {
  try {
    const customers = conversationService.getTrialsNeedingFollowUp();

    return res.json({
      success: true,
      data: {
        count: customers.length,
        customers: customers.map(c => ({
          phone: c.phone,
          state: c.state,
          device: c.device,
          trialStartedAt: c.trialStartedAt,
          followUpsSent: c.followUpsSent,
        })),
      },
    });
  } catch (error) {
    logger.error('Error getting follow-ups', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/chatbot/follow-ups/send
 * Send follow-up to a specific customer
 * Body: { phone: string, type: string }
 */
router.post('/follow-ups/send', async (req: Request, res: Response) => {
  try {
    const { phone, type } = req.body;

    if (!phone || !type) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: phone and type',
      });
    }

    const context = conversationService.getOrCreateContext(phone);
    const message = conversationService.getFollowUpMessage(type, context);

    if (!message) {
      return res.status(400).json({
        success: false,
        error: `Unknown follow-up type: ${type}`,
      });
    }

    // Send via WhatsApp
    if (whatsappService.isConfigured()) {
      await whatsappService.sendTextMessage(phone, message);
    }

    // Update context
    conversationService.updateContext(phone, {
      followUpsSent: context.followUpsSent + 1,
      lastFollowUpType: type,
    });

    // Add to history
    conversationService.addMessage(phone, {
      role: 'assistant',
      content: message,
      timestamp: new Date(),
      metadata: { triggeredAction: `followup_${type}` },
    });

    logger.info('Follow-up sent', { phone, type });

    return res.json({
      success: true,
      data: { message },
    });
  } catch (error) {
    logger.error('Error sending follow-up', { error });
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
