/**
 * Classe de base pour les erreurs personnalisees
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    details?: Record<string, unknown>
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Erreur de validation des donnees
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 400, 'VALIDATION_ERROR', details);
  }
}

/**
 * Erreur d'authentification
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Non authentifie') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Erreur d'autorisation
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Acces refuse') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Ressource non trouvee
 */
export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    const message = id ? `${resource} avec l'id ${id} non trouve` : `${resource} non trouve`;
    super(message, 404, 'NOT_FOUND', { resource, id });
  }
}

/**
 * Conflit (ex: doublon)
 */
export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 409, 'CONFLICT', details);
  }
}

/**
 * Rate limit atteint
 */
export class RateLimitError extends AppError {
  constructor(retryAfter?: number) {
    super('Trop de requetes, veuillez reessayer plus tard', 429, 'RATE_LIMIT', {
      retryAfter,
    });
  }
}

/**
 * Erreur de service externe (WhatsApp, IA, etc.)
 */
export class ExternalServiceError extends AppError {
  public readonly service: string;

  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`Erreur ${service}: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR', details);
    this.service = service;
  }
}

/**
 * Erreur WhatsApp specifique
 */
export class WhatsAppError extends ExternalServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('WhatsApp', message, details);
  }
}

/**
 * Erreur IA specifique
 */
export class AIError extends ExternalServiceError {
  constructor(provider: string, message: string, details?: Record<string, unknown>) {
    super(`IA/${provider}`, message, details);
  }
}

/**
 * Erreur de webhook
 */
export class WebhookError extends AppError {
  constructor(source: string, message: string, details?: Record<string, unknown>) {
    super(`Webhook ${source}: ${message}`, 400, 'WEBHOOK_ERROR', {
      source,
      ...details,
    });
  }
}

/**
 * Erreur de base de donnees
 */
export class DatabaseError extends AppError {
  constructor(operation: string, message: string, details?: Record<string, unknown>) {
    super(`Erreur DB (${operation}): ${message}`, 500, 'DATABASE_ERROR', details);
  }
}

/**
 * Verifie si une erreur est operationnelle (prevue) ou non
 */
export function isOperationalError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Convertit une erreur inconnue en AppError
 */
export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(error.message, 500, 'INTERNAL_ERROR', {
      originalError: error.name,
    });
  }

  return new AppError('Erreur inconnue', 500, 'UNKNOWN_ERROR', {
    originalError: String(error),
  });
}

/**
 * Formatte une erreur pour la reponse API
 */
export function formatErrorResponse(error: AppError): {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
} {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details && { details: error.details }),
    },
  };
}
