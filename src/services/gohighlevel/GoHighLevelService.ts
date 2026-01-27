import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

export interface GHLWebhookPayload {
  phone: string;
  message: string;
  contactId: string;
  contactName?: string;
  // GHL peut envoyer d'autres champs dans le standard data
  [key: string]: unknown;
}

export interface GHLSendMessageRequest {
  type: 'WhatsApp' | 'SMS' | 'Email';
  message: string;
  contactId?: string;
  phone?: string;
}

export interface GHLSendMessageResponse {
  conversationId: string;
  messageId: string;
  message?: string;
}

export interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  tags?: string[];
}

// ===========================================
// GOHIGHLEVEL SERVICE
// ===========================================

class GoHighLevelService {
  private apiKey: string;
  private locationId: string;
  private baseUrl: string = 'https://services.leadconnectorhq.com';

  constructor() {
    this.apiKey = config.gohighlevel?.apiKey || '';
    this.locationId = config.gohighlevel?.locationId || '';

    if (this.apiKey && this.locationId) {
      logger.info('GoHighLevelService initialise', { locationId: this.locationId });
    } else {
      logger.warn('GoHighLevelService: Configuration incomplete (GHL_API_KEY ou GHL_LOCATION_ID manquant)');
    }
  }

  /**
   * Check if service is configured
   */
  isConfigured(): boolean {
    return !!(this.apiKey && this.locationId);
  }

  /**
   * Send a message via GoHighLevel API
   */
  async sendMessage(
    contactId: string,
    message: string,
    type: 'WhatsApp' | 'SMS' = 'WhatsApp'
  ): Promise<GHLSendMessageResponse | null> {
    if (!this.isConfigured()) {
      logger.error('GoHighLevelService non configure');
      return null;
    }

    try {
      const url = `${this.baseUrl}/conversations/messages`;

      const body = {
        type: type,
        contactId: contactId,
        message: message,
      };

      logger.debug('GHL API Request', { url, contactId, messageLength: message.length });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        logger.error('GHL API Error', {
          status: response.status,
          error: data,
        });
        return null;
      }

      logger.info('Message GHL envoye', {
        contactId,
        messageId: data.messageId || data.id,
      });

      return data as unknown as GHLSendMessageResponse;
    } catch (error) {
      logger.error('Erreur envoi message GHL', { error, contactId });
      return null;
    }
  }

  /**
   * Send a message by phone number (will lookup or create contact)
   */
  async sendMessageByPhone(
    phone: string,
    message: string,
    type: 'WhatsApp' | 'SMS' = 'WhatsApp'
  ): Promise<GHLSendMessageResponse | null> {
    if (!this.isConfigured()) {
      logger.error('GoHighLevelService non configure');
      return null;
    }

    try {
      // First, try to find the contact by phone
      const contact = await this.findContactByPhone(phone);

      if (contact) {
        return this.sendMessage(contact.id, message, type);
      }

      // If no contact found, try sending with phone directly
      const url = `${this.baseUrl}/conversations/messages`;

      const body = {
        type: type,
        phone: phone,
        message: message,
        locationId: this.locationId,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error('GHL API Error (by phone)', {
          status: response.status,
          error: data,
        });
        return null;
      }

      return data as GHLSendMessageResponse;
    } catch (error) {
      logger.error('Erreur envoi message GHL par phone', { error, phone });
      return null;
    }
  }

  /**
   * Find a contact by phone number
   */
  async findContactByPhone(phone: string): Promise<GHLContact | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const url = `${this.baseUrl}/contacts/search/duplicate?locationId=${this.locationId}&phone=${encodeURIComponent(phone)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Version': '2021-07-28',
        },
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok || !data.contact) {
        return null;
      }

      return data.contact as GHLContact;
    } catch (error) {
      logger.error('Erreur recherche contact GHL', { error, phone });
      return null;
    }
  }

  /**
   * Get contact by ID
   */
  async getContact(contactId: string): Promise<GHLContact | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const url = `${this.baseUrl}/contacts/${contactId}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Version': '2021-07-28',
        },
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        return null;
      }

      return data.contact as GHLContact;
    } catch (error) {
      logger.error('Erreur get contact GHL', { error, contactId });
      return null;
    }
  }

  /**
   * Add a tag to a contact
   */
  async addTagToContact(contactId: string, tag: string): Promise<boolean> {
    if (!this.isConfigured()) {
      return false;
    }

    try {
      const url = `${this.baseUrl}/contacts/${contactId}/tags`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28',
        },
        body: JSON.stringify({ tags: [tag] }),
      });

      return response.ok;
    } catch (error) {
      logger.error('Erreur ajout tag GHL', { error, contactId, tag });
      return false;
    }
  }

  /**
   * Validate webhook payload from GHL
   */
  validateWebhookPayload(payload: unknown): payload is GHLWebhookPayload {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const p = payload as Record<string, unknown>;

    // Minimum required fields
    if (!p.phone || !p.message || !p.contactId) {
      logger.warn('GHL Webhook payload incomplet', { payload });
      return false;
    }

    return true;
  }
}

// Export singleton
export const ghlService = new GoHighLevelService();
export default ghlService;
