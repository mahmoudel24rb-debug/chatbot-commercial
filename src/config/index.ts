import dotenv from 'dotenv';
import { z } from 'zod';

// Charger les variables d'environnement
dotenv.config();

// Schema de validation pour les variables d'environnement
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  API_BASE_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MIN: z.string().transform(Number).default('2'),
  DATABASE_POOL_MAX: z.string().transform(Number).default('10'),

  // Redis
  REDIS_URL: z.string().url(),

  // Meta / Facebook
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),

  // WhatsApp
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  // IA
  AI_PROVIDER: z.enum(['claude', 'openai']).default('claude'),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // Securite
  JWT_SECRET: z.string().min(32).optional(),
  ENCRYPTION_KEY: z.string().min(32).optional(),

  // Notifications
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  NOTIFICATION_EMAIL: z.string().email().optional(),

  // Feature flags
  ENABLE_AI_FALLBACK: z.string().transform((v) => v === 'true').default('true'),
  DEBUG_WEBHOOKS: z.string().transform((v) => v === 'true').default('false'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

// Parser et valider les variables d'environnement
const parseEnv = () => {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((e) => e.path.join('.')).join(', ');
      console.error(`Variables d'environnement manquantes ou invalides: ${missingVars}`);
      console.error('Voir .env.example pour la configuration requise');
    }
    throw error;
  }
};

const env = parseEnv();

// Configuration exportee
export const config = {
  // Application
  env: env.NODE_ENV,
  port: env.PORT,
  apiBaseUrl: env.API_BASE_URL,
  isDevelopment: env.NODE_ENV === 'development',
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  // Database
  database: {
    url: env.DATABASE_URL,
    poolMin: env.DATABASE_POOL_MIN,
    poolMax: env.DATABASE_POOL_MAX,
  },

  // Redis
  redis: {
    url: env.REDIS_URL,
  },

  // Meta
  meta: {
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    webhookVerifyToken: env.META_WEBHOOK_VERIFY_TOKEN,
  },

  // WhatsApp
  whatsapp: {
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    verifyToken: env.WHATSAPP_VERIFY_TOKEN,
    apiUrl: 'https://graph.facebook.com/v18.0',
  },

  // IA
  ai: {
    provider: env.AI_PROVIDER,
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY,
      model: 'claude-3-5-sonnet-20241022',
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      model: 'gpt-4-turbo-preview',
    },
    enableFallback: env.ENABLE_AI_FALLBACK,
  },

  // Securite
  security: {
    jwtSecret: env.JWT_SECRET,
    encryptionKey: env.ENCRYPTION_KEY,
  },

  // Notifications
  notifications: {
    slackWebhookUrl: env.SLACK_WEBHOOK_URL,
    email: env.NOTIFICATION_EMAIL,
  },

  // Feature flags
  features: {
    debugWebhooks: env.DEBUG_WEBHOOKS,
  },

  // Logging
  logging: {
    level: env.LOG_LEVEL,
  },
} as const;

export type Config = typeof config;
export default config;
