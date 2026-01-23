import winston from 'winston';

// Determiner le niveau de log depuis l'environnement
const level = process.env.LOG_LEVEL || 'info';

// Format personnalise pour les logs
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}] ${message}`;

    // Ajouter les metadonnees si presentes
    if (Object.keys(metadata).length > 0) {
      // Filtrer les donnees sensibles
      const safeMetadata = filterSensitiveData(metadata);
      msg += ` ${JSON.stringify(safeMetadata)}`;
    }

    return msg;
  })
);

// Format JSON pour la production
const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Filtrer les donnees sensibles des logs
function filterSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = [
    'password',
    'token',
    'accessToken',
    'apiKey',
    'secret',
    'authorization',
    'phone',
    'email',
  ];

  const filtered: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
      filtered[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      filtered[key] = filterSensitiveData(value as Record<string, unknown>);
    } else {
      filtered[key] = value;
    }
  }

  return filtered;
}

// Creer le logger
export const logger = winston.createLogger({
  level,
  format: process.env.NODE_ENV === 'production' ? jsonFormat : customFormat,
  defaultMeta: { service: 'chatbot-iptv' },
  transports: [
    // Console pour tous les environnements
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
});

// Ajouter un fichier de log en production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );

  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    })
  );
}

// Logger specifique pour les requetes HTTP
export const httpLogger = {
  request: (req: { method: string; url: string; ip?: string }) => {
    logger.info(`${req.method} ${req.url}`, { ip: req.ip });
  },

  response: (req: { method: string; url: string }, statusCode: number, duration: number) => {
    const level = statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.url} ${statusCode}`, {
      duration: `${duration}ms`,
    });
  },
};

// Logger specifique pour les webhooks
export const webhookLogger = {
  received: (source: string, eventType?: string) => {
    logger.info(`Webhook recu: ${source}`, { eventType });
  },

  processed: (source: string, success: boolean, details?: Record<string, unknown>) => {
    const level = success ? 'info' : 'error';
    logger[level](`Webhook traite: ${source}`, { success, ...details });
  },
};

// Logger specifique pour l'IA
export const aiLogger = {
  request: (provider: string, prompt: string) => {
    logger.debug(`Requete IA: ${provider}`, {
      promptLength: prompt.length,
    });
  },

  response: (provider: string, tokensUsed: number, duration: number) => {
    logger.info(`Reponse IA: ${provider}`, {
      tokensUsed,
      duration: `${duration}ms`,
    });
  },

  error: (provider: string, error: string) => {
    logger.error(`Erreur IA: ${provider}`, { error });
  },
};

export default logger;
