import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

// ===========================================
// TYPES
// ===========================================

export interface WatiMessageResponse {
  result: boolean;
  phone_number?: string;
}

export interface WatiWebhookPayload {
  waId: string;           // Numero WhatsApp (ex: 33685343973)
  senderName?: string;    // Nom du contact
  text: string;           // Message texte
  timestamp?: string;
  type?: string;
  listReply?: unknown;
  replyContextId?: string;
}

// ===========================================
// WATI SERVICE
// ===========================================

class WatiService {
  private apiToken: string;
  private apiEndpoint: string;

  constructor() {
    this.apiToken = config.wati?.apiToken || '';
    this.apiEndpoint = config.wati?.apiEndpoint || '';

    // Enlever le trailing slash
    if (this.apiEndpoint.endsWith('/')) {
      this.apiEndpoint = this.apiEndpoint.slice(0, -1);
    }

    if (this.isConfigured()) {
      logger.info('WatiService initialise', {
        apiEndpoint: this.apiEndpoint,
      });
    } else {
      logger.warn('WatiService: Configuration incomplete (WATI_API_TOKEN ou WATI_API_ENDPOINT manquant)');
    }
  }

  isConfigured(): boolean {
    return !!(this.apiToken && this.apiEndpoint);
  }

  /**
   * Send a WhatsApp session message via WATI
   */
  async sendMessage(whatsappNumber: string, message: string): Promise<WatiMessageResponse | null> {
    if (!this.isConfigured()) {
      logger.error('WatiService non configure');
      return null;
    }

    try {
      // Nettoyer le numero (enlever + et espaces)
      const cleanNumber = whatsappNumber.replace(/[+\s]/g, '');

      const url = `${this.apiEndpoint}/api/v1/sendSessionMessage/${cleanNumber}?messageText=${encodeURIComponent(message)}`;

      logger.debug('WATI API Request', {
        url: `${this.apiEndpoint}/api/v1/sendSessionMessage/${cleanNumber}`,
        to: cleanNumber,
        messageLength: message.length,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      const data = await response.json() as Record<string, unknown>;

      if (!response.ok) {
        logger.error('WATI API Error', {
          status: response.status,
          data,
        });
        return null;
      }

      logger.info('Message WATI envoye', {
        to: cleanNumber,
        result: data.result,
        data: JSON.stringify(data),
      });

      return {
        result: data.result as boolean,
        phone_number: cleanNumber,
      };
    } catch (error) {
      logger.error('Erreur envoi message WATI', { error: error instanceof Error ? error.message : String(error), whatsappNumber });
      return null;
    }
  }

  /**
   * Fetch recent messages from WATI for a given phone number
   */
  async getRecentMessages(whatsappNumber: string, limit: number = 5): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
    if (!this.isConfigured()) return [];

    try {
      const cleanNumber = whatsappNumber.replace(/[+\s]/g, '');
      const url = `${this.apiEndpoint}/api/v1/getMessages/${cleanNumber}?pageSize=${limit}&pageNumber=0`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      if (!response.ok) {
        logger.error('WATI getMessages failed', { status: response.status });
        return [];
      }

      const data = await response.json() as {
        messages?: {
          items?: Array<{
            text?: string;
            owner?: boolean;    // true = bot/agent, false = customer
            type?: string;
          }>;
        };
      };

      const items = data?.messages?.items || [];

      // WATI returns newest first, reverse to get chronological order
      return items
        .filter(m => m.text && m.type === 'text')
        .reverse()
        .map(m => ({
          role: (m.owner ? 'assistant' : 'user') as 'user' | 'assistant',
          content: m.text!,
        }));
    } catch (error) {
      logger.error('Erreur getMessages WATI', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Download media file from WATI and return as base64
   */
  async downloadMedia(mediaUrl: string): Promise<{ base64: string; mediaType: string } | null> {
    try {
      const response = await fetch(mediaUrl, {
        headers: {
          'Authorization': `Bearer ${this.apiToken}`,
        },
      });

      if (!response.ok) {
        logger.error('WATI media download failed', { status: response.status, mediaUrl });
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await response.arrayBuffer());
      const base64 = buffer.toString('base64');

      logger.info('WATI media downloaded', { mediaUrl, contentType, sizeKB: Math.round(buffer.length / 1024) });

      return { base64, mediaType: contentType };
    } catch (error) {
      logger.error('Erreur download media WATI', { error: error instanceof Error ? error.message : String(error), mediaUrl });
      return null;
    }
  }

  /**
   * Validate incoming webhook payload from WATI
   */
  validateWebhookPayload(payload: unknown): payload is WatiWebhookPayload {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const p = payload as Record<string, unknown>;

    if (!p.waId || !p.text) {
      logger.warn('WATI Webhook payload incomplet', {
        hasWaId: !!p.waId,
        hasText: !!p.text,
      });
      return false;
    }

    return true;
  }
}

export const watiService = new WatiService();
export default watiService;
