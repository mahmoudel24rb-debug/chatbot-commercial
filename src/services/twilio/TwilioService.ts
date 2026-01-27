import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

export interface TwilioMessageResponse {
  sid: string;
  status: string;
  to: string;
  from: string;
}

export interface TwilioWebhookPayload {
  MessageSid: string;
  AccountSid: string;
  From: string;        // Format: whatsapp:+33612345678
  To: string;          // Format: whatsapp:+14155238886
  Body: string;        // Le message texte
  NumMedia?: string;   // Nombre de medias
  ProfileName?: string; // Nom du profil WhatsApp
}

// ===========================================
// TWILIO SERVICE
// ===========================================

class TwilioService {
  private accountSid: string;
  private authToken: string;
  private whatsappNumber: string;
  private baseUrl: string = 'https://api.twilio.com/2010-04-01';

  constructor() {
    this.accountSid = config.twilio?.accountSid || '';
    this.authToken = config.twilio?.authToken || '';
    this.whatsappNumber = config.twilio?.whatsappNumber || '';

    if (this.isConfigured()) {
      logger.info('TwilioService initialise', {
        whatsappNumber: this.whatsappNumber
      });
    } else {
      logger.warn('TwilioService: Configuration incomplete (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN ou TWILIO_WHATSAPP_NUMBER manquant)');
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.whatsappNumber);
  }

  /**
   * Format phone number for WhatsApp
   * Input: 33612345678 or +33612345678
   * Output: whatsapp:+33612345678
   */
  private formatWhatsAppNumber(phone: string): string {
    // Nettoyer le numero
    let cleaned = phone.replace(/\s/g, '');

    // S'assurer qu'il commence par +
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    // Ajouter le prefix whatsapp:
    if (!cleaned.startsWith('whatsapp:')) {
      cleaned = 'whatsapp:' + cleaned;
    }

    return cleaned;
  }

  /**
   * Extract phone number from WhatsApp format
   * Input: whatsapp:+33612345678
   * Output: 33612345678
   */
  extractPhoneNumber(whatsappFormat: string): string {
    return whatsappFormat
      .replace('whatsapp:', '')
      .replace('+', '');
  }

  /**
   * Send a WhatsApp message via Twilio
   */
  async sendMessage(to: string, message: string): Promise<TwilioMessageResponse | null> {
    if (!this.isConfigured()) {
      logger.error('TwilioService non configure');
      return null;
    }

    try {
      const url = `${this.baseUrl}/Accounts/${this.accountSid}/Messages.json`;

      // Preparer les donnees en format URL-encoded
      const formData = new URLSearchParams();
      formData.append('To', this.formatWhatsAppNumber(to));
      formData.append('From', this.formatWhatsAppNumber(this.whatsappNumber));
      formData.append('Body', message);

      // Auth Basic avec Account SID et Auth Token
      const authHeader = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

      logger.debug('Twilio API Request', {
        url,
        to: this.formatWhatsAppNumber(to),
        messageLength: message.length
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        logger.error('Twilio API Error', {
          status: response.status,
          code: data.code,
          message: data.message,
          moreInfo: data.more_info,
        });
        return null;
      }

      logger.info('Message Twilio envoye', {
        sid: data.sid,
        to: to,
        status: data.status,
      });

      return {
        sid: data.sid as string,
        status: data.status as string,
        to: data.to as string,
        from: data.from as string,
      };
    } catch (error) {
      logger.error('Erreur envoi message Twilio', { error, to });
      return null;
    }
  }

  /**
   * Validate webhook payload from Twilio
   */
  validateWebhookPayload(payload: unknown): payload is TwilioWebhookPayload {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const p = payload as Record<string, unknown>;

    // Minimum required fields
    if (!p.From || !p.Body || !p.MessageSid) {
      logger.warn('Twilio Webhook payload incomplet', {
        hasFrom: !!p.From,
        hasBody: !!p.Body,
        hasMessageSid: !!p.MessageSid
      });
      return false;
    }

    return true;
  }

  /**
   * Validate Twilio webhook signature (optional but recommended for production)
   */
  validateSignature(
    _signature: string,
    _url: string,
    _params: Record<string, string>
  ): boolean {
    // Pour l'instant, on skip la validation en dev
    // En production, utiliser twilio.validateRequest()
    if (config.isDevelopment) {
      return true;
    }

    // TODO: Implementer la validation de signature Twilio
    // https://www.twilio.com/docs/usage/security#validating-requests
    logger.warn('Twilio signature validation not implemented');
    return true;
  }
}

// Export singleton
export const twilioService = new TwilioService();
export default twilioService;
