import Redis from 'ioredis';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

// Instance Redis principale
export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  reconnectOnError(err) {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
    return targetErrors.some((e) => err.message.includes(e));
  },
});

// Gestion des evenements Redis
redis.on('connect', () => {
  logger.info('Connexion Redis etablie');
});

redis.on('ready', () => {
  logger.debug('Redis pret a recevoir des commandes');
});

redis.on('error', (err) => {
  logger.error('Erreur Redis', { error: err.message });
});

redis.on('close', () => {
  logger.warn('Connexion Redis fermee');
});

redis.on('reconnecting', () => {
  logger.info('Tentative de reconnexion Redis...');
});

/**
 * Verifie la connexion a Redis
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const pong = await redis.ping();
    logger.info('Redis PING reussi', { response: pong });
    return pong === 'PONG';
  } catch (error) {
    logger.error('Impossible de se connecter a Redis', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Stocke une valeur avec expiration optionnelle
 */
export async function set(
  key: string,
  value: string | object,
  ttlSeconds?: number
): Promise<void> {
  const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;

  if (ttlSeconds) {
    await redis.setex(key, ttlSeconds, stringValue);
  } else {
    await redis.set(key, stringValue);
  }
}

/**
 * Recupere une valeur
 */
export async function get<T = string>(key: string, parseJson = false): Promise<T | null> {
  const value = await redis.get(key);
  if (value === null) return null;

  if (parseJson) {
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as T;
    }
  }

  return value as T;
}

/**
 * Supprime une ou plusieurs cles
 */
export async function del(...keys: string[]): Promise<number> {
  return redis.del(...keys);
}

/**
 * Verifie si une cle existe
 */
export async function exists(key: string): Promise<boolean> {
  const result = await redis.exists(key);
  return result === 1;
}

/**
 * Incremente un compteur
 */
export async function incr(key: string): Promise<number> {
  return redis.incr(key);
}

/**
 * Stocke une valeur dans un hash
 */
export async function hset(
  key: string,
  field: string,
  value: string | object
): Promise<void> {
  const stringValue = typeof value === 'object' ? JSON.stringify(value) : value;
  await redis.hset(key, field, stringValue);
}

/**
 * Recupere une valeur d'un hash
 */
export async function hget(key: string, field: string): Promise<string | null> {
  return redis.hget(key, field);
}

/**
 * Recupere toutes les valeurs d'un hash
 */
export async function hgetall(key: string): Promise<Record<string, string>> {
  return redis.hgetall(key);
}

/**
 * Ferme proprement la connexion Redis
 */
export async function closeConnection(): Promise<void> {
  await redis.quit();
  logger.info('Connexion Redis fermee proprement');
}

export default {
  redis,
  checkConnection,
  set,
  get,
  del,
  exists,
  incr,
  hset,
  hget,
  hgetall,
  closeConnection,
};
