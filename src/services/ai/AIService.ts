import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { BINGEBEAR_SYSTEM_PROMPT, INTENT_DETECTION_PROMPT } from '../../config/prompts.js';
import {
  conversationService,
  CustomerContext,
  DeviceType,
  ContentPreference,
  PlanType,
} from '../conversation/ConversationService.js';

// ===========================================
// TYPES
// ===========================================

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  tokensUsed: {
    input: number;
    output: number;
  };
  provider: 'claude' | 'openai';
  latencyMs: number;
}

export interface IntentResult {
  intent: string;
  confidence: number;
  entities: {
    device?: DeviceType | null;
    plan_interest?: PlanType | null;
    content_preference?: ContentPreference | null;
    mac_address?: string | null;
    device_key?: string | null;
    payment_method?: 'revolut' | 'paypal' | 'card' | null;
  };
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  needs_human: boolean;
}

export interface ChatbotResponse {
  message: string;
  context: CustomerContext;
  shouldNotifyAdmin: boolean;
  adminNotification?: {
    type: 'trial_request' | 'payment_received' | 'technical_issue' | 'escalation';
    message: string;
  };
  intent?: IntentResult;
}

// ===========================================
// AI SERVICE
// ===========================================

class AIService {
  private anthropic: Anthropic | null = null;
  private model: string;

  constructor() {
    this.model = config.ai.anthropic.model;

    if (config.ai.anthropic.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: config.ai.anthropic.apiKey,
      });
      logger.info('AIService initialise avec Claude');
    } else {
      logger.warn('AIService: Cle API Anthropic non configuree');
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return this.anthropic !== null;
  }

  /**
   * Main chatbot handler - processes incoming WhatsApp message
   */
  async handleIncomingMessage(
    phone: string,
    message: string
  ): Promise<ChatbotResponse> {
    if (!this.anthropic) {
      throw new Error('AI service not configured');
    }

    // Get or create customer context
    const context = conversationService.getOrCreateContext(phone);
    context.lastMessageAt = new Date();

    // Add user message to history
    conversationService.addMessage(phone, {
      role: 'user',
      content: message,
      timestamp: new Date(),
    });

    // Detect intent
    const intent = await this.detectIntent(message);

    // Update context based on intent entities
    this.updateContextFromIntent(context, intent, message);

    // Check if needs human escalation
    if (conversationService.shouldEscalateToHuman(context, message, intent.intent)) {
      context.needsHuman = true;
      context.state = 'needs_human';
      conversationService.updateContext(phone, context);

      return {
        message: `I'm getting one of our team members to help you right away. They'll message you shortly! 👍`,
        context,
        shouldNotifyAdmin: true,
        adminNotification: {
          type: 'escalation',
          message: `🚨 ESCALATION NEEDED\n\nCustomer: ${phone}\nReason: ${intent.intent === 'human_request' ? 'Requested human' : 'Detected frustration'}\nLast message: "${message}"`,
        },
        intent,
      };
    }

    // Process based on current state and intent
    const response = await this.processMessage(context, message, intent);

    // Add assistant response to history
    conversationService.addMessage(phone, {
      role: 'assistant',
      content: response.message,
      timestamp: new Date(),
    });

    // Update context
    conversationService.updateContext(phone, response.context);

    return response;
  }

  /**
   * Process message based on state machine logic
   */
  private async processMessage(
    context: CustomerContext,
    message: string,
    intent: IntentResult
  ): Promise<ChatbotResponse> {
    const state = context.state;

    // Handle specific intents regardless of state
    if (intent.intent === 'pricing') {
      return this.handlePricingRequest(context);
    }

    if (intent.intent === 'technical_issue') {
      return this.handleTechnicalIssue(context, message);
    }

    // State machine
    switch (state) {
      case 'new':
        return this.handleNewConversation(context, message, intent);

      case 'awaiting_device':
        return this.handleDeviceSelection(context, message, intent);

      case 'awaiting_mac':
        return this.handleMacCollection(context, message, intent);

      case 'awaiting_content_pref':
        return this.handleContentPreference(context, message, intent);

      case 'trial_active':
        return this.handleTrialActive(context, message, intent);

      case 'trial_expired':
      case 'awaiting_payment':
        return this.handlePaymentFlow(context, message, intent);

      case 'payment_pending':
        return this.handlePaymentPending(context, message, intent);

      case 'active_subscriber':
        return this.handleActiveSubscriber(context, message, intent);

      default:
        return this.generateAIResponse(context, message);
    }
  }

  /**
   * Handle new conversation - first contact
   */
  private async handleNewConversation(
    context: CustomerContext,
    message: string,
    _intent: IntentResult
  ): Promise<ChatbotResponse> {
    // Check if they mentioned a device
    const device = conversationService.extractDeviceType(message);

    if (device) {
      context.device = device;
      context.state = 'awaiting_mac';

      return {
        message: conversationService.getSetupInstructions(device),
        context,
        shouldNotifyAdmin: false,
      };
    }

    // Standard greeting
    context.state = 'awaiting_device';

    return {
      message: `Hey! 👋 Thanks for reaching out to BingeBear.

I can get you set up with a free 24-hour trial right now - full access to everything, no payment needed.

Quick question: What device will you be using?

📱 Android Phone/Tablet
📺 Smart TV (Samsung, LG, etc.)
🔥 Fire Stick
📦 Android Box

Just let me know and I'll send the setup instructions!`,
      context,
      shouldNotifyAdmin: false,
    };
  }

  /**
   * Handle device selection
   */
  private async handleDeviceSelection(
    context: CustomerContext,
    message: string,
    intent: IntentResult
  ): Promise<ChatbotResponse> {
    const device = intent.entities.device || conversationService.extractDeviceType(message);

    if (device) {
      context.device = device;
      context.state = 'awaiting_mac';

      return {
        message: conversationService.getSetupInstructions(device),
        context,
        shouldNotifyAdmin: false,
      };
    }

    // Couldn't identify device
    return {
      message: `No problem! What device are you using exactly?

📱 Android Phone/Tablet
📺 Smart TV (Samsung, LG, Sony, etc.)
🔥 Fire Stick
📦 Android Box
💻 Other

Just let me know!`,
      context,
      shouldNotifyAdmin: false,
    };
  }

  /**
   * Handle MAC address collection
   */
  private async handleMacCollection(
    context: CustomerContext,
    message: string,
    intent: IntentResult
  ): Promise<ChatbotResponse> {
    // Check for MAC address in message
    const mac = intent.entities.mac_address || conversationService.extractMacAddress(message);

    // Check if they're asking about TiviMate
    if (message.toLowerCase().includes('tivimate') || message.toLowerCase().includes('tivi mate')) {
      context.device = 'tivimate';
      context.state = 'awaiting_content_pref';

      return {
        message: `Ah, you've got TiviMate! Great choice 👍

I'll send you the login details (Username, Password, URL) instead.

Which content do you want?
🇮🇪 English only (IE/UK/USA/CA/AU)
🌍 Europe
🌎 Worldwide (everything)
🔞 Adult content? (just let me know)`,
        context,
        shouldNotifyAdmin: false,
      };
    }

    // Check if message looks like it contains MAC/device info (screenshot or text)
    if (mac || message.length > 10 || message.includes(':') || /[0-9a-f]{6,}/i.test(message)) {
      // Looks like they sent device info
      context.macAddress = mac || message;
      context.state = 'awaiting_content_pref';

      return {
        message: `Perfect! Got your device details ✅

One last thing before I activate your trial:

What content are you most interested in?
🇮🇪 English channels (Ireland, UK, USA, CA, etc.)
🌍 Europe
🌎 Worldwide (everything)
🔞 Adult content? (just let me know)

This helps me set up exactly what you want to test!`,
        context,
        shouldNotifyAdmin: false,
      };
    }

    // They might be stuck
    return {
      message: `No worries! Having trouble finding the MAC address?

Open IBO Pro Player - you should see a screen with:
- MAC Address
- Device Key

Just send me a screenshot of that screen, or type the numbers you see.

Need help with any step? I'm here! 👍`,
      context,
      shouldNotifyAdmin: false,
    };
  }

  /**
   * Handle content preference selection
   */
  private async handleContentPreference(
    context: CustomerContext,
    message: string,
    intent: IntentResult
  ): Promise<ChatbotResponse> {
    const pref = intent.entities.content_preference || conversationService.extractContentPreference(message);

    // Check for adult content request
    if (message.toLowerCase().includes('adult') || message.toLowerCase().includes('xxx') || message.toLowerCase().includes('porn')) {
      context.wantsAdultContent = true;
    }

    if (pref) {
      context.contentPreference = pref;
    } else {
      context.contentPreference = 'english'; // Default
    }

    context.state = 'trial_pending';

    // Notify admin to activate trial
    return {
      message: `Perfect! I'm setting up your trial now...

You'll be watching in about 2 minutes! I'll message you as soon as it's ready 👍`,
      context,
      shouldNotifyAdmin: true,
      adminNotification: {
        type: 'trial_request',
        message: conversationService.createTrialNotification(context),
      },
    };
  }

  /**
   * Handle messages during active trial
   */
  private async handleTrialActive(
    context: CustomerContext,
    message: string,
    intent: IntentResult
  ): Promise<ChatbotResponse> {
    // Check if asking about pricing/plans
    if (intent.intent === 'pricing' || message.toLowerCase().includes('price') || message.toLowerCase().includes('plan')) {
      return this.handlePricingRequest(context);
    }

    // Check if ready to subscribe
    if (intent.intent === 'payment' || message.toLowerCase().includes('yes') || message.toLowerCase().includes('subscribe') || message.toLowerCase().includes('buy')) {
      context.state = 'awaiting_payment';
      return this.handlePaymentFlow(context, message, intent);
    }

    // General question during trial
    return this.generateAIResponse(context, message);
  }

  /**
   * Handle pricing request
   */
  private handlePricingRequest(context: CustomerContext): ChatbotResponse {
    const pricing = conversationService.getPricingMessage(context.plan);
    context.state = 'awaiting_payment';

    return {
      message: pricing,
      context,
      shouldNotifyAdmin: false,
    };
  }

  /**
   * Handle payment flow
   */
  private async handlePaymentFlow(
    context: CustomerContext,
    message: string,
    _intent: IntentResult
  ): Promise<ChatbotResponse> {
    const lower = message.toLowerCase();

    // Detect payment method preference
    if (lower.includes('revolut') || lower.includes('bank') || lower.includes('iban')) {
      context.paymentMethod = 'revolut';
      return {
        message: conversationService.getPaymentInstructions('revolut'),
        context,
        shouldNotifyAdmin: false,
      };
    }

    if (lower.includes('paypal')) {
      context.paymentMethod = 'paypal';
      return {
        message: conversationService.getPaymentInstructions('paypal'),
        context,
        shouldNotifyAdmin: false,
      };
    }

    // Detect plan selection
    if (lower.includes('lifetime')) {
      context.plan = 'lifetime';
    } else if (lower.includes('2 year') || lower.includes('two year')) {
      context.plan = '2years';
    } else if (lower.includes('3 year') || lower.includes('three year')) {
      context.plan = '3years';
    } else if (lower.includes('year')) {
      context.plan = 'yearly';
    } else if (lower.includes('month')) {
      context.plan = 'monthly';
    }

    // Check if confirming payment sent
    if (conversationService.isPaymentConfirmation(message)) {
      context.state = 'payment_pending';
      context.paymentPending = true;

      return {
        message: `Got it! Let me verify the payment...

Can you send me a screenshot of the payment receipt please? ✅`,
        context,
        shouldNotifyAdmin: true,
        adminNotification: {
          type: 'payment_received',
          message: conversationService.createPaymentNotification(context),
        },
      };
    }

    // Show payment options
    return {
      message: `Great choice${context.plan ? ` on the ${conversationService.formatPlanName(context.plan)}` : ''}! 🎉

Which payment method works best for you?

💳 Revolut/Bank Transfer
📱 PayPal

Let me know and I'll send the details!`,
      context,
      shouldNotifyAdmin: false,
    };
  }

  /**
   * Handle payment pending verification
   */
  private handlePaymentPending(
    context: CustomerContext,
    message: string,
    _intent: IntentResult
  ): Promise<ChatbotResponse> {
    // Waiting for admin to verify
    return Promise.resolve({
      message: `Thanks! I'm just verifying the payment now - will confirm in a moment 👍`,
      context,
      shouldNotifyAdmin: true,
      adminNotification: {
        type: 'payment_received',
        message: `📸 Customer sent what looks like a receipt:\n\n"${message.substring(0, 100)}..."\n\nPhone: ${context.phone}\nPlan: ${context.plan}\n\nPlease verify and activate.`,
      },
    });
  }

  /**
   * Handle active subscriber messages
   */
  private handleActiveSubscriber(
    context: CustomerContext,
    message: string,
    intent: IntentResult
  ): Promise<ChatbotResponse> {
    if (intent.intent === 'technical_issue') {
      return this.handleTechnicalIssue(context, message);
    }

    return this.generateAIResponse(context, message);
  }

  /**
   * Handle technical issues
   */
  private handleTechnicalIssue(
    context: CustomerContext,
    message: string
  ): Promise<ChatbotResponse> {
    return Promise.resolve({
      message: `On it! Let me check what's happening.

Quick questions:
1. Which channel/content is having issues?
2. What device are you using?
3. Is your internet working okay for other things?

I'll get this sorted for you right away 👍`,
      context,
      shouldNotifyAdmin: true,
      adminNotification: {
        type: 'technical_issue',
        message: `⚠️ TECHNICAL ISSUE\n\nCustomer: ${context.phone}\nPlan: ${context.plan || 'Trial'}\nDevice: ${context.device || 'Unknown'}\n\nIssue: "${message}"`,
      },
    });
  }

  /**
   * Generate AI response using Claude for complex queries
   */
  private async generateAIResponse(
    context: CustomerContext,
    message: string
  ): Promise<ChatbotResponse> {
    if (!this.anthropic) {
      throw new Error('AI service not configured');
    }

    const history = conversationService.getHistory(context.phone, 10);
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = history
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    // Add current message
    messages.push({ role: 'user', content: message });

    // Build context-aware system prompt
    const systemPrompt = this.buildContextualPrompt(context);

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 500,
        system: systemPrompt,
        messages,
      });

      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('\n');

      return {
        message: content,
        context,
        shouldNotifyAdmin: false,
      };
    } catch (error) {
      logger.error('Error generating AI response', { error });
      return {
        message: `Sorry, I'm having a technical issue right now. Let me get someone to help you! 👍`,
        context: { ...context, needsHuman: true },
        shouldNotifyAdmin: true,
        adminNotification: {
          type: 'escalation',
          message: `🚨 AI ERROR\n\nCustomer: ${context.phone}\nError: ${error instanceof Error ? error.message : 'Unknown'}\nLast message: "${message}"`,
        },
      };
    }
  }

  /**
   * Build contextual system prompt
   */
  private buildContextualPrompt(context: CustomerContext): string {
    let prompt = BINGEBEAR_SYSTEM_PROMPT;

    prompt += `\n\n--- CURRENT CUSTOMER CONTEXT ---`;
    prompt += `\nConversation State: ${context.state}`;

    if (context.name) {
      prompt += `\nCustomer Name: ${context.name}`;
    }
    if (context.device) {
      prompt += `\nDevice: ${context.device}`;
    }
    if (context.contentPreference) {
      prompt += `\nContent Preference: ${context.contentPreference}`;
    }
    if (context.plan) {
      prompt += `\nInterested Plan: ${context.plan}`;
    }
    if (context.trialStartedAt) {
      const hoursLeft = Math.max(0, 24 - ((Date.now() - new Date(context.trialStartedAt).getTime()) / (1000 * 60 * 60)));
      prompt += `\nTrial: Active (${hoursLeft.toFixed(1)} hours remaining)`;
    }

    prompt += `\n\nRespond naturally as Joe. Keep it short and WhatsApp-friendly.`;

    return prompt;
  }

  /**
   * Detect intent from message
   */
  async detectIntent(message: string): Promise<IntentResult> {
    if (!this.anthropic) {
      return {
        intent: 'other',
        confidence: 0,
        entities: {},
        sentiment: 'neutral',
        needs_human: false,
      };
    }

    const prompt = INTENT_DETECTION_PROMPT.replace('{message}', message);

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('');

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error('Error detecting intent', { error });
    }

    return {
      intent: 'other',
      confidence: 0.5,
      entities: {},
      sentiment: 'neutral',
      needs_human: false,
    };
  }

  /**
   * Update context from detected intent
   */
  private updateContextFromIntent(
    context: CustomerContext,
    intent: IntentResult,
    _message: string
  ): void {
    context.sentiment = intent.sentiment;

    if (intent.entities.device) {
      context.device = intent.entities.device;
    }
    if (intent.entities.plan_interest) {
      context.plan = intent.entities.plan_interest;
    }
    if (intent.entities.content_preference) {
      context.contentPreference = intent.entities.content_preference;
    }
    if (intent.entities.mac_address) {
      context.macAddress = intent.entities.mac_address;
    }
    if (intent.entities.device_key) {
      context.deviceKey = intent.entities.device_key;
    }
    if (intent.entities.payment_method) {
      context.paymentMethod = intent.entities.payment_method;
    }
  }

  /**
   * Activate trial for customer (called by admin)
   */
  activateTrial(
    phone: string,
    credentials: { username: string; password: string; url: string }
  ): ChatbotResponse {
    const context = conversationService.getOrCreateContext(phone);

    context.state = 'trial_active';
    context.trialStartedAt = new Date();
    context.trialExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    context.credentials = {
      ...credentials,
      m3uUrl: `${credentials.url}/get.php?username=${credentials.username}&password=${credentials.password}&type=m3u_plus&output=ts`,
    };

    conversationService.updateContext(phone, context);

    const activationMessage = context.device === 'tivimate'
      ? `🎉 Your trial is live!

Here are your login details for TiviMate:

Username: ${credentials.username}
Password: ${credentials.password}
URL: ${credentials.url}

Open TiviMate, go to Settings → Add Playlist → Xtream Codes Login, and enter these details.

Give it a moment to load all the channels. Enjoy! 🍿📺

Your 24-hour trial started now - let me know if you need anything!`
      : `🎉 Your trial is live!

Here's what to do:
1️⃣ Exit the IBO Pro Player app completely
2️⃣ Reopen the app
3️⃣ Click "Continue" when it loads
4️⃣ Give it 10-15 seconds to load all the channels

Everything should be working now!

Try a few channels and let me know if you see any issues. I'm here if you need anything! 🍿📺

Your 24-hour trial started now.`;

    return {
      message: activationMessage,
      context,
      shouldNotifyAdmin: false,
    };
  }

  /**
   * Activate subscription for customer (called by admin)
   */
  activateSubscription(
    phone: string,
    plan: PlanType,
    credentials: { username: string; password: string; url: string }
  ): ChatbotResponse {
    const context = conversationService.getOrCreateContext(phone);

    context.state = 'active_subscriber';
    context.plan = plan;
    context.subscribedAt = new Date();
    context.paymentPending = false;
    context.credentials = {
      ...credentials,
      m3uUrl: `${credentials.url}/get.php?username=${credentials.username}&password=${credentials.password}&type=m3u_plus&output=ts`,
    };

    // Calculate expiry based on plan
    const now = new Date();
    switch (plan) {
      case 'monthly':
        context.expiresAt = new Date(now.setMonth(now.getMonth() + 1));
        break;
      case 'yearly':
        context.expiresAt = new Date(now.setMonth(now.getMonth() + 14)); // 12 + 2 free
        break;
      case '2years':
        context.expiresAt = new Date(now.setMonth(now.getMonth() + 28)); // 24 + 4 free
        break;
      case '3years':
        context.expiresAt = new Date(now.setMonth(now.getMonth() + 36));
        break;
      case 'lifetime':
        context.expiresAt = new Date(now.setFullYear(now.getFullYear() + 6));
        break;
    }

    conversationService.updateContext(phone, context);

    return {
      message: `🎉 Welcome to BingeBear!

Your ${conversationService.formatPlanName(plan)} is now active ✅

Save these details:
M3u: ${context.credentials.m3uUrl}
Username: ${credentials.username}
Password: ${credentials.password}
URL: ${credentials.url}

Everything should keep working exactly as it did during your trial. If anything changes or stops working, message me immediately!

We truly appreciate you subscribing! 🙏

Quick favor: Would you mind leaving us a quick review on Trustpilot?
trustpilot.com/review/bingebear.tv

Thanks mate! Enjoy unlimited streaming 🍿📺`,
      context,
      shouldNotifyAdmin: false,
    };
  }

  /**
   * Legacy method for backward compatibility
   */
  async generateResponse(
    userMessage: string,
    _context?: { firstName?: string; tvBrand?: string; currentState?: string; trialActivated?: boolean },
    conversationHistory?: ConversationMessage[]
  ): Promise<AIResponse> {
    if (!this.anthropic) {
      throw new Error('AI service not configured');
    }

    const startTime = Date.now();
    const messages = conversationHistory || [];
    messages.push({ role: 'user', content: userMessage });

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 500,
      system: BINGEBEAR_SYSTEM_PROMPT,
      messages,
    });

    return {
      content: response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('\n'),
      tokensUsed: {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      },
      provider: 'claude',
      latencyMs: Date.now() - startTime,
    };
  }
}

// Export singleton instance
export const aiService = new AIService();
export default aiService;
