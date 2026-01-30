import { Pool, PoolConfig } from 'pg';
import { config } from './index.js';
import { logger } from '../utils/logger.js';

// Configuration du pool de connexions PostgreSQL
const poolConfig: PoolConfig = {
  connectionString: config.database.url,
  min: config.database.poolMin,
  max: config.database.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Instance du pool de connexions
export const pool = new Pool(poolConfig);

// Gestion des erreurs du pool
pool.on('error', (err) => {
  logger.error('Erreur inattendue du pool PostgreSQL', { error: err.message });
});

pool.on('connect', () => {
  logger.debug('Nouvelle connexion PostgreSQL etablie');
});

/**
 * Execute une requete SQL avec gestion automatique de la connexion
 */
export async function query<T>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    logger.debug('Requete SQL executee', {
      query: text.substring(0, 100),
      duration: `${duration}ms`,
      rowCount: result.rowCount,
    });

    return { rows: result.rows as T[], rowCount: result.rowCount };
  } catch (error) {
    logger.error('Erreur SQL', {
      query: text.substring(0, 100),
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Execute une transaction avec plusieurs requetes
 */
export async function transaction<T>(
  callback: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Verifie la connexion a la base de donnees
 */
export async function checkConnection(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT NOW()');
    logger.info('Connexion PostgreSQL etablie', {
      timestamp: result.rows[0].now,
    });
    return true;
  } catch (error) {
    logger.error('Impossible de se connecter a PostgreSQL', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Ferme proprement le pool de connexions
 */
export async function closePool(): Promise<void> {
  await pool.end();
  logger.info('Pool PostgreSQL ferme');
}

export default { pool, query, transaction, checkConnection, closePool };
