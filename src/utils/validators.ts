import { z } from 'zod';

/**
 * Normalise un numero de telephone au format E.164
 * Supporte les formats francais et internationaux
 */
export function normalizePhoneNumber(phone: string): string {
  // Supprimer tous les caracteres non numeriques sauf le +
  let normalized = phone.replace(/[^\d+]/g, '');

  // Si le numero commence par 0 (format francais local)
  if (normalized.startsWith('0') && normalized.length === 10) {
    normalized = '+33' + normalized.substring(1);
  }

  // Si le numero ne commence pas par +, ajouter +
  if (!normalized.startsWith('+')) {
    // Assumer format francais si 9 chiffres
    if (normalized.length === 9 && (normalized.startsWith('6') || normalized.startsWith('7'))) {
      normalized = '+33' + normalized;
    } else if (normalized.startsWith('33')) {
      normalized = '+' + normalized;
    }
  }

  return normalized;
}

/**
 * Valide un numero de telephone au format E.164
 */
export function isValidPhoneNumber(phone: string): boolean {
  const e164Regex = /^\+[1-9]\d{6,14}$/;
  return e164Regex.test(phone);
}

/**
 * Valide une adresse email
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Sanitize une chaine de caracteres pour eviter les injections
 */
export function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/[<>]/g, '') // Supprimer les chevrons (XSS basique)
    .substring(0, 1000); // Limiter la longueur
}

/**
 * Schema Zod pour un lead entrant de Meta Ads
 */
export const metaLeadSchema = z.object({
  id: z.string(),
  created_time: z.string(),
  field_data: z.array(
    z.object({
      name: z.string(),
      values: z.array(z.string()),
    })
  ),
  ad_id: z.string().optional(),
  ad_name: z.string().optional(),
  form_id: z.string().optional(),
  page_id: z.string().optional(),
});

export type MetaLeadData = z.infer<typeof metaLeadSchema>;

/**
 * Schema Zod pour un message WhatsApp entrant
 */
export const whatsappMessageSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(
        z.object({
          value: z.object({
            messaging_product: z.literal('whatsapp'),
            metadata: z.object({
              display_phone_number: z.string(),
              phone_number_id: z.string(),
            }),
            contacts: z
              .array(
                z.object({
                  profile: z.object({
                    name: z.string(),
                  }),
                  wa_id: z.string(),
                })
              )
              .optional(),
            messages: z
              .array(
                z.object({
                  from: z.string(),
                  id: z.string(),
                  timestamp: z.string(),
                  type: z.enum(['text', 'image', 'video', 'audio', 'document', 'button', 'interactive']),
                  text: z
                    .object({
                      body: z.string(),
                    })
                    .optional(),
                  image: z
                    .object({
                      id: z.string(),
                      mime_type: z.string().optional(),
                      sha256: z.string().optional(),
                    })
                    .optional(),
                  button: z
                    .object({
                      payload: z.string(),
                      text: z.string(),
                    })
                    .optional(),
                  interactive: z
                    .object({
                      type: z.string(),
                      button_reply: z
                        .object({
                          id: z.string(),
                          title: z.string(),
                        })
                        .optional(),
                      list_reply: z
                        .object({
                          id: z.string(),
                          title: z.string(),
                          description: z.string().optional(),
                        })
                        .optional(),
                    })
                    .optional(),
                })
              )
              .optional(),
            statuses: z
              .array(
                z.object({
                  id: z.string(),
                  status: z.enum(['sent', 'delivered', 'read', 'failed']),
                  timestamp: z.string(),
                  recipient_id: z.string(),
                  errors: z
                    .array(
                      z.object({
                        code: z.number(),
                        title: z.string(),
                        message: z.string().optional(),
                      })
                    )
                    .optional(),
                })
              )
              .optional(),
          }),
          field: z.string(),
        })
      ),
    })
  ),
});

export type WhatsAppWebhookPayload = z.infer<typeof whatsappMessageSchema>;

/**
 * Schema pour la creation d'un lead via API
 */
export const createLeadSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().max(100).optional(),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional(),
  source: z.string().max(50).default('manual'),
  metadata: z.record(z.unknown()).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

/**
 * Schema pour la mise a jour d'un lead
 */
export const updateLeadSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: z.string().email().optional(),
  status: z
    .enum(['new', 'contacted', 'qualified', 'trial_setup', 'converted', 'lost'])
    .optional(),
  score: z.number().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
