import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { BINGEBEAR_SYSTEM_PROMPT, INTENT_DETECTION_PROMPT, ADMIN_SYSTEM_PROMPT } from '../../config/prompts.js';
import {
  conversationService,
  CustomerContext,
  DeviceType,
  ContentPreference,
  PlanType,
} from '../conversation/ConversationService.js';
import { watiService } from '../wati/WatiService.js';

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
// HELPERS
// ===========================================

/**
 * Remove unpaired Unicode surrogates that break JSON serialization.
 */
function sanitizeString(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

// ===========================================
// AI SERVICE
// ===========================================

class AIService {
  private anthropic: Anthropic | null = null;
  private model: string;
  private adminHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

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
   * Analyze an image using Claude Vision to extract MAC address and Device Key
   */
  async analyzeImage(base64: string, mediaType: string): Promise<string | null> {
    if (!this.anthropic) return null;

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: base64,
              },
            },
            {
              type: 'text',
              text: `Extract the MAC Address and Device Key from this screenshot of IBO Pro Player or a similar IPTV app.
Reply ONLY in this exact format (no extra text):
MAC: <mac_address>
Device Key: <device_key>

If you can only find one of them, include only that line.
If you cannot find either, reply exactly: NOT_FOUND`,
            },
          ],
        }],
      });

      const content = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');

      logger.info('Image analysis result', { content });

      if (content.includes('NOT_FOUND')) return null;
      return content.trim();
    } catch (error) {
      logger.error('Error analyzing image', { error });
      return null;
    }
  }

  /**
   * Detect language from message text (simple keyword-based detection)
   */
  private detectLanguage(message: string): 'en' | 'fr' | 'ar' {
    const lower = message.toLowerCase().trim();

    // Arabic detection: check for Arabic Unicode characters
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(message)) {
      return 'ar';
    }

    // French detection: common French words/greetings
    const frenchPatterns = /\b(bonjour|salut|bonsoir|merci|oui|non|je veux|s'il vous|comment|bienvenue|ça va|d'accord|svp|excusez|bonne|enchant[eé]|français|france)\b/i;
    if (frenchPatterns.test(lower)) {
      return 'fr';
    }

    return 'en';
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

    // Detect language on first messages if not set yet
    if (!context.language) {
      const detectedLang = this.detectLanguage(message);
      if (detectedLang !== 'en') {
        context.language = detectedLang;
        logger.info('Language detected', { phone, language: detectedLang });
      }
    }

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
   * Handle admin messages - different mode, business assistant
   */
  async handleAdminMessage(
    _phone: string,
    message: string
  ): Promise<{ message: string }> {
    if (!this.anthropic) {
      throw new Error('AI service not configured');
    }

    this.adminHistory.push({ role: 'user' as const, content: message });

    // Build admin context with active prospects summary
    let adminPrompt = ADMIN_SYSTEM_PROMPT;
    const allContexts = conversationService.getAllContexts();
    if (allContexts.length > 0) {
      adminPrompt += `\n\n--- PROSPECTS ACTIFS (${allContexts.length}) ---`;
      for (const ctx of allContexts) {
        adminPrompt += `\n📱 ${ctx.phone} | State: ${ctx.state}`;
        if (ctx.device) adminPrompt += ` | Device: ${ctx.device}`;
        if (ctx.macAddress) adminPrompt += ` | MAC: ${ctx.macAddress}`;
        if (ctx.deviceKey) adminPrompt += ` | Device Key: ${ctx.deviceKey}`;
        if (ctx.contentPreference) adminPrompt += ` | Content: ${ctx.contentPreference}`;
        if (ctx.plan) adminPrompt += ` | Plan: ${ctx.plan}`;
        if (ctx.createdAt) adminPrompt += ` | Depuis: ${new Date(ctx.createdAt).toLocaleString('fr-FR')}`;
      }
    } else {
      adminPrompt += `\n\nAucun prospect actif pour le moment.`;
    }

    try {
      const messages = this.adminHistory.slice(-20).map(m => ({
        role: m.role,
        content: sanitizeString(m.content),
      }));

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 500,
        system: adminPrompt,
        messages,
      });

      const content = response.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { type: 'text'; text: string }).text)
        .join('\n');

      this.adminHistory.push({ role: 'assistant' as const, content });

      return { message: content };
    } catch (error) {
      logger.error('Error generating admin response', { error });
      return { message: 'Erreur technique, reessaie.' };
    }
  }

  /**
   * Process message - let Claude AI handle all responses naturally
   */
  private async processMessage(
    context: CustomerContext,
    message: string,
    intent: IntentResult
  ): Promise<ChatbotResponse> {
    // Auto-update state based on collected data
    const prevState = context.state;
    this.updateStateFromContext(context);

    // Generate natural AI response
    const response = await this.generateAIResponse(context, message);

    // Determine if admin notification is needed based on what just changed
    const notification = this.checkForAdminNotification(context, prevState, intent, message);
    if (notification) {
      response.shouldNotifyAdmin = true;
      response.adminNotification = notification;
    }

    return response;
  }

  /**
   * Auto-calculate state from collected context data
   */
  private updateStateFromContext(context: CustomerContext): void {
    // Don't change state for post-trial states (managed externally)
    if (['trial_active', 'trial_expired', 'awaiting_payment', 'payment_pending', 'active_subscriber', 'needs_human'].includes(context.state)) {
      return;
    }

    if (context.device && (context.macAddress || context.deviceKey) && context.contentPreference) {
      context.state = 'trial_pending';
    } else if (context.device && (context.macAddress || context.deviceKey)) {
      context.state = 'awaiting_content_pref';
    } else if (context.device) {
      context.state = 'awaiting_mac';
    } else if (context.state === 'new') {
      context.state = 'awaiting_device';
    }
  }

  /**
   * Check if admin notification is needed after processing
   */
  private checkForAdminNotification(
    context: CustomerContext,
    prevState: string,
    intent: IntentResult,
    message: string
  ): ChatbotResponse['adminNotification'] | undefined {
    // Trial request: just transitioned to trial_pending
    if (context.state === 'trial_pending' && prevState !== 'trial_pending') {
      return {
        type: 'trial_request',
        message: conversationService.createTrialNotification(context),
      };
    }

    // Payment confirmation
    if (intent.intent === 'payment' && conversationService.isPaymentConfirmation(message)) {
      context.state = 'payment_pending';
      context.paymentPending = true;
      return {
        type: 'payment_received',
        message: conversationService.createPaymentNotification(context),
      };
    }

    // Technical issue
    if (intent.intent === 'technical_issue') {
      return {
        type: 'technical_issue',
        message: `⚠️ TECHNICAL ISSUE\n\nCustomer: ${context.phone}\nDevice: ${context.device || 'Unknown'}\n\nIssue: "${message}"`,
      };
    }

    return undefined;
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

    // Try to fetch real conversation history from WATI (includes human agent messages)
    let messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (watiService.isConfigured()) {
      const watiHistory = await watiService.getRecentMessages(context.phone, 10);
      if (watiHistory.length > 0) {
        messages = watiHistory.map(m => ({
          role: m.role,
          content: sanitizeString(m.content),
        }));
        logger.info('Using WATI history', { phone: context.phone, messageCount: messages.length });
      }
    }

    // Fallback to in-memory history if WATI fetch failed
    if (messages.length === 0) {
      const history = conversationService.getHistory(context.phone, 10);
      messages = history
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role as 'user' | 'assistant',
          content: sanitizeString(m.content),
        }));
    }

    // Add current message (only if not already the last message in WATI history)
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== 'user' || lastMsg.content !== sanitizeString(message)) {
      messages.push({ role: 'user', content: sanitizeString(message) });
    }

    // Ensure messages alternate correctly (Claude API requirement)
    messages = this.ensureAlternatingRoles(messages);

    // Build context-aware system prompt
    const systemPrompt = this.buildContextualPrompt(context);

    try {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 200,
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
  /**
   * Ensure messages alternate user/assistant (Claude API requirement).
   * Merges consecutive same-role messages and ensures it starts with 'user'.
   */
  private ensureAlternatingRoles(
    msgs: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    if (msgs.length === 0) return msgs;

    // Merge consecutive same-role messages
    const merged: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    for (const msg of msgs) {
      const last = merged[merged.length - 1];
      if (last && last.role === msg.role) {
        last.content += '\n' + msg.content;
      } else {
        merged.push({ ...msg });
      }
    }

    // Ensure starts with 'user'
    if (merged.length > 0 && merged[0].role !== 'user') {
      merged.shift();
    }

    return merged;
  }

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
    if (context.macAddress) {
      prompt += `\nMAC Address: ${context.macAddress}`;
    }
    if (context.deviceKey) {
      prompt += `\nDevice Key: ${context.deviceKey}`;
    }
    if (context.contentPreference) {
      prompt += `\nContent Preference: ${context.contentPreference}`;
    }
    if (context.wantsAdultContent) {
      prompt += `\nAdult Content: Yes`;
    }
    if (context.plan) {
      prompt += `\nInterested Plan: ${context.plan}`;
    }
    if (context.trialStartedAt) {
      const hoursLeft = Math.max(0, 24 - ((Date.now() - new Date(context.trialStartedAt).getTime()) / (1000 * 60 * 60)));
      prompt += `\nTrial: Active (${hoursLeft.toFixed(1)} hours remaining)`;
    }

    // Dynamic instructions based on what's missing
    const missing: string[] = [];
    if (!context.device) missing.push('device type (Fire Stick, Smart TV, Android Phone, Android Box)');
    if (context.device && !context.macAddress && !context.deviceKey) missing.push('MAC Address and Device Key (ask them to open IBO Pro Player and send a screenshot or type the values)');
    if (context.device && (context.macAddress || context.deviceKey) && !context.contentPreference) missing.push('content preference (English only, Europe, or Worldwide)');

    if (missing.length > 0) {
      prompt += `\n\nINFO STILL NEEDED (ask naturally, don't force a rigid order - if the customer provides multiple pieces of info at once, accept them all):`;
      missing.forEach(m => { prompt += `\n- ${m}`; });
    }

    if (context.state === 'trial_pending') {
      prompt += `\n\nAll info collected! Tell the customer their trial is being set up and they'll be watching in about 2 minutes.`;
    }

    if (context.state === 'payment_pending') {
      prompt += `\n\nPayment was sent. Tell the customer you're verifying it and will confirm shortly.`;
    }

    if (context.state === 'needs_human') {
      prompt += `\n\nThis customer has been escalated to a human agent. Keep responses VERY short (1-2 lines max). Just say a team member will be in touch shortly. Do NOT try to solve their problem, do NOT give contact info or phone numbers, do NOT apologize excessively.`;
    }

    // Language instruction
    if (context.language && context.language !== 'en') {
      const langName = context.language === 'fr' ? 'French' : 'Arabic';
      prompt += `\n\nLANGUAGE: The customer prefers ${langName}. You MUST reply entirely in ${langName}. Keep the same friendly tone.`;
    }

    prompt += `\n\nCRITICAL RULES:
- MAX 3-4 short lines per message. This is WhatsApp, NOT email.
- NEVER list what's included (channels, movies, sports) - the customer doesn't need that.
- NEVER recap info you already have - just move forward.
- Be concise like a real WhatsApp chat. One emoji max.
- If the customer provides info, acknowledge briefly and ask the next thing needed.`;

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

    const prompt = INTENT_DETECTION_PROMPT.replace('{message}', sanitizeString(message));

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
    message: string
  ): void {
    context.sentiment = intent.sentiment;

    // Helper to check if value is a real value (not null/undefined/"null"/"none")
    const isValid = (val: unknown): val is string =>
      typeof val === 'string' && val !== 'null' && val !== 'none' && val !== 'N/A' && val.length > 0;

    // Detect adult content request from raw message
    const lower = message.toLowerCase();
    if (lower.includes('adult') || lower.includes('xxx') || lower.includes('porn')) {
      context.wantsAdultContent = true;
    }

    // Also try to extract MAC from raw message if intent didn't catch it
    if (!context.macAddress) {
      const extractedMac = conversationService.extractMacAddress(message);
      if (extractedMac) {
        context.macAddress = extractedMac;
      }
    }

    // Also try to extract device key from raw message
    if (!context.deviceKey) {
      const keyMatch = message.match(/device\s*key[:\s]*([A-Za-z0-9]+)/i);
      if (keyMatch) {
        context.deviceKey = keyMatch[1];
      }
    }

    // Also try to extract content preference from raw message
    if (!context.contentPreference) {
      const extractedPref = conversationService.extractContentPreference(message);
      if (extractedPref) {
        context.contentPreference = extractedPref;
      }
    }

    // Also try to extract device from raw message
    if (!context.device) {
      const extractedDevice = conversationService.extractDeviceType(message);
      if (extractedDevice) {
        context.device = extractedDevice;
      }
    }

    if (isValid(intent.entities.device) && !context.device) {
      context.device = intent.entities.device;
    }
    if (isValid(intent.entities.plan_interest) && !context.plan) {
      context.plan = intent.entities.plan_interest;
    }
    if (isValid(intent.entities.content_preference) && !context.contentPreference) {
      context.contentPreference = intent.entities.content_preference;
    }
    if (isValid(intent.entities.mac_address) && !context.macAddress) {
      context.macAddress = intent.entities.mac_address;
    }
    if (isValid(intent.entities.device_key) && !context.deviceKey) {
      context.deviceKey = intent.entities.device_key;
    }
    if (isValid(intent.entities.payment_method) && !context.paymentMethod) {
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
      max_tokens: 150,
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
