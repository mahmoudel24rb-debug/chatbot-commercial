import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';

// Types pour les messages WhatsApp
export interface WhatsAppTextMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text';
  text: {
    preview_url?: boolean;
    body: string;
  };
}

export interface WhatsAppTemplateMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: {
      code: string;
    };
    components?: TemplateComponent[];
  };
}

export interface TemplateComponent {
  type: 'header' | 'body' | 'button';
  parameters: TemplateParameter[];
}

export interface TemplateParameter {
  type: 'text' | 'image' | 'video' | 'document';
  text?: string;
  image?: { link: string };
  video?: { link: string };
  document?: { link: string };
}

export interface WhatsAppInteractiveMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button' | 'list';
    header?: {
      type: 'text';
      text: string;
    };
    body: {
      text: string;
    };
    footer?: {
      text: string;
    };
    action: InteractiveAction;
  };
}

export interface InteractiveAction {
  buttons?: InteractiveButton[];
  button?: string;
  sections?: ListSection[];
}

export interface InteractiveButton {
  type: 'reply';
  reply: {
    id: string;
    title: string;
  };
}

export interface ListSection {
  title: string;
  rows: ListRow[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}

export interface WhatsAppMediaMessage {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'image' | 'video' | 'document';
  image?: { link: string; caption?: string };
  video?: { link: string; caption?: string };
  document?: { link: string; caption?: string; filename?: string };
}

export interface SendMessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface WhatsAppError {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string;
  };
}

/**
 * Service pour interagir avec l'API WhatsApp Cloud
 */
class WhatsAppService {
  private baseUrl: string;
  private phoneNumberId: string;
  private accessToken: string;

  constructor() {
    this.baseUrl = config.whatsapp.apiUrl;
    this.phoneNumberId = config.whatsapp.phoneNumberId || '';
    this.accessToken = config.whatsapp.accessToken || '';
  }

  /**
   * Verifie si le service est configure
   */
  isConfigured(): boolean {
    return !!(this.phoneNumberId && this.accessToken);
  }

  /**
   * Envoie une requete a l'API WhatsApp
   */
  private async sendRequest<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'POST',
    body?: object
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;

    logger.debug('WhatsApp API Request', { url, method });

    const response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data as WhatsAppError;
      logger.error('WhatsApp API Error', {
        status: response.status,
        error: error.error,
      });
      throw new Error(`WhatsApp API Error: ${error.error?.message || 'Unknown error'}`);
    }

    logger.debug('WhatsApp API Response', { data });
    return data as T;
  }

  /**
   * Envoie un message texte simple
   */
  async sendTextMessage(to: string, text: string): Promise<SendMessageResponse> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp service not configured');
    }

    const message: WhatsAppTextMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhoneNumber(to),
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    logger.info('Envoi message WhatsApp', { to, textLength: text.length });

    return this.sendRequest<SendMessageResponse>(
      `${this.phoneNumberId}/messages`,
      'POST',
      message
    );
  }

  /**
   * Envoie un message template (pour le premier contact)
   */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string = 'fr',
    components?: TemplateComponent[]
  ): Promise<SendMessageResponse> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp service not configured');
    }

    const message: WhatsAppTemplateMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhoneNumber(to),
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components,
      },
    };

    logger.info('Envoi template WhatsApp', { to, templateName });

    return this.sendRequest<SendMessageResponse>(
      `${this.phoneNumberId}/messages`,
      'POST',
      message
    );
  }

  /**
   * Envoie un message avec boutons interactifs
   */
  async sendButtonMessage(
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>,
    headerText?: string,
    footerText?: string
  ): Promise<SendMessageResponse> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp service not configured');
    }

    const message: WhatsAppInteractiveMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhoneNumber(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: bodyText,
        },
        action: {
          buttons: buttons.slice(0, 3).map((btn) => ({
            type: 'reply' as const,
            reply: {
              id: btn.id,
              title: btn.title.substring(0, 20), // Max 20 caracteres
            },
          })),
        },
      },
    };

    if (headerText) {
      message.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      message.interactive.footer = { text: footerText };
    }

    logger.info('Envoi message boutons WhatsApp', { to, buttonCount: buttons.length });

    return this.sendRequest<SendMessageResponse>(
      `${this.phoneNumberId}/messages`,
      'POST',
      message
    );
  }

  /**
   * Envoie un message avec liste deroulante
   */
  async sendListMessage(
    to: string,
    bodyText: string,
    buttonText: string,
    sections: ListSection[],
    headerText?: string,
    footerText?: string
  ): Promise<SendMessageResponse> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp service not configured');
    }

    const message: WhatsAppInteractiveMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhoneNumber(to),
      type: 'interactive',
      interactive: {
        type: 'list',
        body: {
          text: bodyText,
        },
        action: {
          button: buttonText,
          sections,
        },
      },
    };

    if (headerText) {
      message.interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      message.interactive.footer = { text: footerText };
    }

    logger.info('Envoi message liste WhatsApp', { to, sectionCount: sections.length });

    return this.sendRequest<SendMessageResponse>(
      `${this.phoneNumberId}/messages`,
      'POST',
      message
    );
  }

  /**
   * Envoie une image
   */
  async sendImage(
    to: string,
    imageUrl: string,
    caption?: string
  ): Promise<SendMessageResponse> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp service not configured');
    }

    const message: WhatsAppMediaMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhoneNumber(to),
      type: 'image',
      image: {
        link: imageUrl,
        caption,
      },
    };

    logger.info('Envoi image WhatsApp', { to, imageUrl });

    return this.sendRequest<SendMessageResponse>(
      `${this.phoneNumberId}/messages`,
      'POST',
      message
    );
  }

  /**
   * Envoie une video
   */
  async sendVideo(
    to: string,
    videoUrl: string,
    caption?: string
  ): Promise<SendMessageResponse> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp service not configured');
    }

    const message: WhatsAppMediaMessage = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.normalizePhoneNumber(to),
      type: 'video',
      video: {
        link: videoUrl,
        caption,
      },
    };

    logger.info('Envoi video WhatsApp', { to, videoUrl });

    return this.sendRequest<SendMessageResponse>(
      `${this.phoneNumberId}/messages`,
      'POST',
      message
    );
  }

  /**
   * Marque un message comme lu
   */
  async markAsRead(messageId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('WhatsApp service not configured');
    }

    await this.sendRequest(
      `${this.phoneNumberId}/messages`,
      'POST',
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }
    );

    logger.debug('Message marque comme lu', { messageId });
  }

  /**
   * Normalise un numero de telephone au format international
   */
  private normalizePhoneNumber(phone: string): string {
    // Supprimer tous les caracteres non numeriques sauf le +
    let normalized = phone.replace(/[^\d+]/g, '');

    // Supprimer le + si present
    normalized = normalized.replace(/^\+/, '');

    // Supprimer le 00 au debut (format international)
    if (normalized.startsWith('00')) {
      normalized = normalized.substring(2);
    }

    // Si le numero commence par 0 (format francais local)
    if (normalized.startsWith('0') && normalized.length === 10) {
      normalized = '33' + normalized.substring(1);
    }

    return normalized;
  }

  /**
   * Valide la signature d'un webhook WhatsApp
   */
  validateWebhookSignature(
    payload: string,
    signature: string,
    appSecret: string
  ): boolean {
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');

    return `sha256=${expectedSignature}` === signature;
  }
}

// Export une instance singleton
export const whatsappService = new WhatsAppService();
export default whatsappService;
