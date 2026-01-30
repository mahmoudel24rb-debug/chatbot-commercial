import { logger } from '../../utils/logger.js';
import {
  FOLLOW_UP_TEMPLATES,
  DEVICE_SETUP_INSTRUCTIONS,
  PAYMENT_TEMPLATES
} from '../../config/prompts.js';

// ===========================================
// TYPES
// ===========================================

export type ConversationState =
  | 'new'                    // First contact
  | 'awaiting_device'        // Asked what device they use
  | 'awaiting_mac'           // Sent setup instructions, waiting for MAC
  | 'awaiting_content_pref'  // Got MAC, asking content preference
  | 'trial_pending'          // Waiting for admin to activate trial
  | 'trial_active'           // Trial is running
  | 'trial_expired'          // Trial ended
  | 'awaiting_payment'       // Presented pricing, waiting for payment
  | 'payment_pending'        // Customer says they paid, waiting verification
  | 'active_subscriber'      // Paid customer
  | 'churned'                // Customer left
  | 'needs_human';           // Escalated to human

export type DeviceType =
  | 'firestick'
  | 'android_phone'
  | 'smart_tv'
  | 'android_box'
  | 'tivimate'
  | 'other';

export type ContentPreference =
  | 'english'
  | 'europe'
  | 'worldwide';

export type PlanType =
  | 'monthly'
  | 'yearly'
  | '2years'
  | '3years'
  | 'lifetime';

export interface CustomerContext {
  // Identifiers
  id?: string;
  phone: string;
  name?: string;

  // Conversation state
  state: ConversationState;
  previousState?: ConversationState;

  // Device info
  device?: DeviceType;
  macAddress?: string;
  deviceKey?: string;

  // Preferences
  contentPreference?: ContentPreference;
  wantsAdultContent?: boolean;
  language?: 'en' | 'fr' | 'ar';

  // Trial info
  trialStartedAt?: Date;
  trialExpiresAt?: Date;

  // Subscription info
  plan?: PlanType;
  subscribedAt?: Date;
  expiresAt?: Date;

  // Payment
  paymentMethod?: 'revolut' | 'paypal' | 'card';
  paymentPending?: boolean;

  // Credentials (after activation)
  credentials?: {
    username: string;
    password: string;
    url: string;
    m3uUrl?: string;
  };

  // Follow-up tracking
  lastMessageAt?: Date;
  followUpsSent: number;
  lastFollowUpType?: string;

  // Flags
  needsHuman: boolean;
  escalationReason?: string;
  sentiment?: 'positive' | 'neutral' | 'negative' | 'frustrated';

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    intent?: string;
    confidence?: number;
    triggeredAction?: string;
  };
}

export interface ProcessedMessage {
  response: string;
  newState: ConversationState;
  shouldNotifyAdmin: boolean;
  adminNotification?: {
    type: 'trial_request' | 'payment_received' | 'technical_issue' | 'escalation';
    message: string;
    customerPhone: string;
    data?: Record<string, unknown>;
  };
  scheduledFollowUp?: {
    type: string;
    sendAt: Date;
  };
}

// ===========================================
// CONVERSATION SERVICE
// ===========================================

class ConversationService {
  private conversations: Map<string, CustomerContext> = new Map();
  private messageHistory: Map<string, ConversationMessage[]> = new Map();

  /**
   * Check if a conversation context exists for this phone
   */
  hasContext(phone: string): boolean {
    return this.conversations.has(phone);
  }

  /**
   * Get all active conversation contexts
   */
  getAllContexts(): CustomerContext[] {
    return Array.from(this.conversations.values());
  }

  /**
   * Get or create customer context
   */
  getOrCreateContext(phone: string): CustomerContext {
    let context = this.conversations.get(phone);

    if (!context) {
      context = {
        phone,
        state: 'new',
        followUpsSent: 0,
        needsHuman: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.conversations.set(phone, context);
      logger.info('New conversation started', { phone });
    }

    return context;
  }

  /**
   * Update customer context
   */
  updateContext(phone: string, updates: Partial<CustomerContext>): CustomerContext {
    const context = this.getOrCreateContext(phone);

    // Track state changes
    if (updates.state && updates.state !== context.state) {
      context.previousState = context.state;
    }

    Object.assign(context, updates, { updatedAt: new Date() });
    this.conversations.set(phone, context);

    logger.debug('Context updated', { phone, state: context.state });
    return context;
  }

  /**
   * Add message to history
   */
  addMessage(phone: string, message: ConversationMessage): void {
    const history = this.messageHistory.get(phone) || [];
    history.push(message);

    // Keep last 50 messages
    if (history.length > 50) {
      history.shift();
    }

    this.messageHistory.set(phone, history);
  }

  /**
   * Get conversation history
   */
  getHistory(phone: string, limit: number = 20): ConversationMessage[] {
    const history = this.messageHistory.get(phone) || [];
    return history.slice(-limit);
  }

  /**
   * Get device setup instructions
   */
  getSetupInstructions(device: DeviceType): string {
    switch (device) {
      case 'firestick':
        return DEVICE_SETUP_INSTRUCTIONS.firestick;
      case 'android_phone':
        return DEVICE_SETUP_INSTRUCTIONS.android_phone;
      case 'smart_tv':
        return DEVICE_SETUP_INSTRUCTIONS.smart_tv;
      case 'android_box':
        return DEVICE_SETUP_INSTRUCTIONS.android_box;
      case 'tivimate':
        return `No problem! TiviMate works great.

I'll send you the login details once we get your trial set up:
- Username
- Password
- Server URL

First, which content do you want?
🇮🇪 English only (IE/UK/USA/CA/AU)
🌍 Europe
🌎 Worldwide (everything)`;
      default:
        return `What device are you using exactly?

I support:
📱 Android Phone/Tablet
📺 Smart TV (Samsung, LG, Android TV)
🔥 Fire Stick
📦 Android Box

Let me know and I'll send the right instructions!`;
    }
  }

  /**
   * Get payment instructions
   */
  getPaymentInstructions(method?: 'revolut' | 'paypal'): string {
    if (method === 'revolut') {
      return PAYMENT_TEMPLATES.revolut;
    } else if (method === 'paypal') {
      return PAYMENT_TEMPLATES.paypal;
    }
    return PAYMENT_TEMPLATES.both;
  }

  /**
   * Get pricing message with upsell
   */
  getPricingMessage(currentInterest?: PlanType): string {
    const baseMessage = `🔥 BUY 2, GET 1 FREE deal active!

**Lifetime: €250** (Best seller!)
- 6 years GUARANTEED
- Pay €150 now + €100 next month
- One payment, stream forever

**2 Years: €139** + 4 FREE months
**Yearly: €80** + 2 FREE months
**Monthly: €35** - No commitment

✅ 4.8⭐ on Trustpilot
✅ 90-day money-back guarantee
✅ 20,000+ happy customers`;

    if (currentInterest === 'yearly') {
      return `${baseMessage}

I'd recommend Lifetime though - it's our best seller. €250 for 6+ years vs €80/year... you'd save hundreds!

And you can split the payment: €150 now, €100 next month.

Which one works for you?`;
    }

    return `${baseMessage}

Which plan interests you?`;
  }

  /**
   * Get follow-up message based on type
   */
  getFollowUpMessage(type: string, context: CustomerContext): string {
    const template = FOLLOW_UP_TEMPLATES[type as keyof typeof FOLLOW_UP_TEMPLATES];

    if (!template) {
      return '';
    }

    // Replace placeholders
    let message = template;
    if (context.plan) {
      message = message.replace('{plan}', this.formatPlanName(context.plan));
    }

    return message;
  }

  /**
   * Format plan name for display
   */
  formatPlanName(plan: PlanType): string {
    const names: Record<PlanType, string> = {
      monthly: 'Monthly Plan',
      yearly: 'Yearly Plan',
      '2years': '2-Year Plan',
      '3years': '3-Year Plan',
      lifetime: 'Lifetime Plan',
    };
    return names[plan] || plan;
  }

  /**
   * Check if message needs human escalation
   */
  shouldEscalateToHuman(context: CustomerContext, message: string, intent?: string): boolean {
    // Explicit request for human
    if (intent === 'human_request') return true;

    // Frustrated sentiment
    if (context.sentiment === 'frustrated') return true;

    // Keywords indicating need for human
    const escalationKeywords = [
      'speak to someone',
      'real person',
      'human',
      'manager',
      'supervisor',
      'complaint',
      'refund',
      'scam',
      'fraud',
      'not working for days',
      'still not fixed',
    ];

    const lowerMessage = message.toLowerCase();
    if (escalationKeywords.some(kw => lowerMessage.includes(kw))) {
      return true;
    }

    // Too many follow-ups without response
    if (context.followUpsSent >= 3 && context.state === 'trial_expired') {
      return false; // Don't escalate ghosters, just stop following up
    }

    return false;
  }

  /**
   * Generate admin notification for trial activation
   */
  createTrialNotification(context: CustomerContext): string {
    return `🆕 NEW TRIAL REQUEST

📱 Device: ${context.device || 'Unknown'}
📍 MAC Address: ${context.macAddress || 'N/A'}
🔑 Device Key: ${context.deviceKey || 'N/A'}
🌍 Content: ${context.contentPreference || 'Not specified'}
${context.wantsAdultContent ? '🔞 Adult content: YES' : ''}

📞 Customer WhatsApp: ${context.phone}

Reply with credentials to activate:
Username:
Password:
URL:`;
  }

  /**
   * Generate admin notification for payment
   */
  createPaymentNotification(context: CustomerContext): string {
    return `💰 PAYMENT NOTIFICATION

📞 Customer: ${context.phone}
📦 Plan: ${context.plan ? this.formatPlanName(context.plan) : 'Unknown'}
💳 Method: ${context.paymentMethod || 'Unknown'}

⚠️ Please verify payment and confirm activation.

Reply with "CONFIRMED" to activate subscription.`;
  }

  /**
   * Calculate when to send follow-up
   */
  calculateFollowUpTime(context: CustomerContext): { type: string; sendAt: Date } | null {
    const now = new Date();

    // Trial follow-ups
    if (context.state === 'trial_active' && context.trialStartedAt) {
      const trialStart = new Date(context.trialStartedAt);
      const hoursSinceStart = (now.getTime() - trialStart.getTime()) / (1000 * 60 * 60);

      if (hoursSinceStart < 18 && context.followUpsSent === 0) {
        const sendAt = new Date(trialStart.getTime() + 18 * 60 * 60 * 1000);
        return { type: 'trial_18h', sendAt };
      }

      if (hoursSinceStart < 23 && context.followUpsSent <= 1) {
        const sendAt = new Date(trialStart.getTime() + 23 * 60 * 60 * 1000);
        return { type: 'trial_23h', sendAt };
      }
    }

    // Ghoster follow-ups
    if (context.state === 'awaiting_mac' && context.lastMessageAt) {
      const lastMsg = new Date(context.lastMessageAt);
      const hoursSinceLastMsg = (now.getTime() - lastMsg.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastMsg >= 4 && context.followUpsSent === 0) {
        return { type: 'ghoster_4h', sendAt: now };
      }

      if (hoursSinceLastMsg >= 24 && context.followUpsSent === 1) {
        return { type: 'ghoster_nextday', sendAt: now };
      }
    }

    // Post-trial follow-ups
    if (context.state === 'trial_expired' && context.trialExpiresAt) {
      const expiry = new Date(context.trialExpiresAt);
      const daysSinceExpiry = (now.getTime() - expiry.getTime()) / (1000 * 60 * 60 * 24);

      if (daysSinceExpiry >= 1 && context.followUpsSent <= 2) {
        return { type: 'day1_followup', sendAt: now };
      }

      if (daysSinceExpiry >= 3 && context.followUpsSent <= 3) {
        return { type: 'day3_followup', sendAt: now };
      }

      if (daysSinceExpiry >= 7 && context.followUpsSent <= 4) {
        return { type: 'day7_final', sendAt: now };
      }
    }

    return null;
  }

  /**
   * Parse MAC address from message
   */
  extractMacAddress(message: string): string | null {
    // Common MAC address formats
    const macPatterns = [
      /([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})/,  // AA:BB:CC:DD:EE:FF
      /([0-9A-Fa-f]{12})/,                          // AABBCCDDEEFF
    ];

    for (const pattern of macPatterns) {
      const match = message.match(pattern);
      if (match) {
        return match[0].toUpperCase();
      }
    }

    return null;
  }

  /**
   * Parse device type from message
   */
  extractDeviceType(message: string): DeviceType | null {
    const lower = message.toLowerCase();

    if (lower.includes('fire') || lower.includes('firestick') || lower.includes('amazon')) {
      return 'firestick';
    }
    if (lower.includes('android phone') || lower.includes('phone') || lower.includes('mobile') || lower.includes('tablet')) {
      return 'android_phone';
    }
    if (lower.includes('smart tv') || lower.includes('samsung') || lower.includes('lg') || lower.includes('sony') || lower.includes('philips')) {
      return 'smart_tv';
    }
    if (lower.includes('android box') || lower.includes('box') || lower.includes('xiaomi')) {
      return 'android_box';
    }
    if (lower.includes('tivimate') || lower.includes('tivi mate')) {
      return 'tivimate';
    }

    return null;
  }

  /**
   * Parse content preference from message
   */
  extractContentPreference(message: string): ContentPreference | null {
    const lower = message.toLowerCase();

    if (lower.includes('english') || lower.includes('uk') || lower.includes('irish') || lower.includes('ireland')) {
      return 'english';
    }
    if (lower.includes('europe') || lower.includes('european')) {
      return 'europe';
    }
    if (lower.includes('worldwide') || lower.includes('world') || lower.includes('everything') || lower.includes('all')) {
      return 'worldwide';
    }

    return null;
  }

  /**
   * Check if message contains payment confirmation
   */
  isPaymentConfirmation(message: string): boolean {
    const lower = message.toLowerCase();
    const paymentKeywords = [
      'paid',
      'sent',
      'payment',
      'transferred',
      'receipt',
      'done',
      'money sent',
      'just paid',
    ];

    return paymentKeywords.some(kw => lower.includes(kw));
  }

  /**
   * Get all active trials that need follow-up
   */
  getTrialsNeedingFollowUp(): CustomerContext[] {
    const results: CustomerContext[] = [];

    this.conversations.forEach((context) => {
      const followUp = this.calculateFollowUpTime(context);
      if (followUp && followUp.sendAt <= new Date()) {
        results.push(context);
      }
    });

    return results;
  }

  /**
   * Export context for persistence (e.g., to Redis/DB)
   */
  exportContext(phone: string): string | null {
    const context = this.conversations.get(phone);
    if (!context) return null;

    return JSON.stringify(context, (_key, value) => {
      if (value instanceof Date) {
        return value.toISOString();
      }
      return value;
    });
  }

  /**
   * Import context from persistence
   */
  importContext(phone: string, data: string): CustomerContext {
    const parsed = JSON.parse(data);

    // Convert date strings back to Date objects
    const dateFields = ['trialStartedAt', 'trialExpiresAt', 'subscribedAt', 'expiresAt', 'lastMessageAt', 'createdAt', 'updatedAt'];
    dateFields.forEach(field => {
      if (parsed[field]) {
        parsed[field] = new Date(parsed[field]);
      }
    });

    this.conversations.set(phone, parsed);
    return parsed;
  }
}

// Export singleton instance
export const conversationService = new ConversationService();
export default conversationService;
