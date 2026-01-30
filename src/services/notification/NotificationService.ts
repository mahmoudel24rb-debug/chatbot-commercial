import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { watiService } from '../wati/WatiService.js';
import { CustomerContext } from '../conversation/ConversationService.js';

// ===========================================
// TYPES
// ===========================================

export interface AdminNotification {
  type: 'trial_request' | 'payment_received' | 'technical_issue' | 'escalation';
  message: string;
}

export interface TrialRequestData {
  phone: string;
  device?: string;
  macAddress?: string;
  contentPreference?: string;
  wantsAdultContent?: boolean;
}

// ===========================================
// NOTIFICATION SERVICE
// ===========================================

class NotificationService {
  private adminPhone: string;

  constructor() {
    this.adminPhone = config.admin?.phone || '';

    if (this.adminPhone) {
      logger.info('NotificationService initialise', { adminPhone: this.adminPhone });
    } else {
      logger.warn('NotificationService: Numero admin non configure (ADMIN_PHONE)');
    }
  }

  /**
   * Check if notification service is configured
   */
  isConfigured(): boolean {
    return !!(this.adminPhone && watiService.isConfigured());
  }

  /**
   * Send admin notification based on type
   */
  async sendAdminNotification(
    notification: AdminNotification,
    context?: CustomerContext
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn('NotificationService non configure, notification ignoree');
      return false;
    }

    try {
      let message = '';

      switch (notification.type) {
        case 'trial_request':
          message = this.formatTrialRequest(notification, context);
          break;
        case 'payment_received':
          message = this.formatPaymentReceived(notification, context);
          break;
        case 'technical_issue':
          message = this.formatTechnicalIssue(notification, context);
          break;
        case 'escalation':
          message = this.formatEscalation(notification, context);
          break;
        default:
          message = notification.message;
      }

      await watiService.sendMessage(this.adminPhone,message);

      logger.info('Notification admin envoyee', {
        type: notification.type,
        adminPhone: this.adminPhone,
      });

      return true;
    } catch (error) {
      logger.error('Erreur envoi notification admin', { error, notification });
      return false;
    }
  }

  /**
   * Format trial request notification
   */
  private formatTrialRequest(_notification: AdminNotification, context?: CustomerContext): string {
    const lines = [
      '🔔 *NOUVEAU TRIAL DEMANDE*',
      '',
      `📱 *Client:* ${context?.phone || 'N/A'}`,
    ];

    if (context?.device) {
      lines.push(`📺 *Device:* ${context.device}`);
    }

    if (context?.macAddress) {
      lines.push(`🔑 *MAC:* ${context.macAddress}`);
    }

    if (context?.deviceKey) {
      lines.push(`🔑 *Device Key:* ${context.deviceKey}`);
    }

    if (context?.contentPreference) {
      lines.push(`🎬 *Contenu:* ${context.contentPreference}`);
    }

    if (context?.wantsAdultContent) {
      lines.push(`🔞 *Adult:* Oui`);
    }

    lines.push('');
    lines.push('---');
    lines.push('*Action requise:*');
    lines.push('1. Creer le compte trial sur ton panel');
    lines.push('2. Envoyer les credentials via:');
    lines.push(`   POST /api/chatbot/admin/activate-trial`);
    lines.push(`   phone: ${context?.phone}`);

    return lines.join('\n');
  }

  /**
   * Format payment received notification
   */
  private formatPaymentReceived(notification: AdminNotification, context?: CustomerContext): string {
    const lines = [
      '💰 *PAIEMENT RECU*',
      '',
      `📱 *Client:* ${context?.phone || 'N/A'}`,
    ];

    if (context?.plan) {
      lines.push(`📋 *Plan:* ${context.plan}`);
    }

    if (context?.device) {
      lines.push(`📺 *Device:* ${context.device}`);
    }

    lines.push('');
    lines.push(notification.message);
    lines.push('');
    lines.push('---');
    lines.push('*Action requise:*');
    lines.push('1. Verifier le paiement');
    lines.push('2. Activer l\'abonnement via:');
    lines.push(`   POST /api/chatbot/admin/activate-subscription`);

    return lines.join('\n');
  }

  /**
   * Format technical issue notification
   */
  private formatTechnicalIssue(notification: AdminNotification, context?: CustomerContext): string {
    const lines = [
      '🔧 *PROBLEME TECHNIQUE*',
      '',
      `📱 *Client:* ${context?.phone || 'N/A'}`,
      '',
      notification.message,
      '',
      '---',
      'Le client a besoin d\'aide technique.',
    ];

    return lines.join('\n');
  }

  /**
   * Format escalation notification
   */
  private formatEscalation(notification: AdminNotification, context?: CustomerContext): string {
    const lines = [
      '🚨 *ESCALATION - HUMAIN REQUIS*',
      '',
      `📱 *Client:* ${context?.phone || 'N/A'}`,
    ];

    if (context?.state) {
      lines.push(`📊 *Etat:* ${context.state}`);
    }

    lines.push('');
    lines.push(`*Raison:* ${notification.message}`);
    lines.push('');
    lines.push('---');
    lines.push('Le chatbot a besoin d\'aide humaine pour ce client.');

    return lines.join('\n');
  }

  /**
   * Send a direct message to admin
   */
  async sendDirectMessage(message: string): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn('NotificationService non configure');
      return false;
    }

    try {
      await watiService.sendMessage(this.adminPhone,message);
      return true;
    } catch (error) {
      logger.error('Erreur envoi message direct admin', { error });
      return false;
    }
  }
}

// Export singleton
export const notificationService = new NotificationService();
export default notificationService;
