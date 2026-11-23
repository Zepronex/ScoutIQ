import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { DatabaseConfig, readDatabaseConfig } from './config';

export type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<T>>;
};

export function createDbPool(config: DatabaseConfig = readDatabaseConfig(), overrides?: PoolConfig): Pool {
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    ssl: config.ssl ? { rejectUnauthorized: true } : undefined,
    ...overrides
  };

  return new Pool(poolConfig);
}

let serverPool: Pool | undefined;

export function getServerPool(): Pool {
  if (!serverPool) {
    serverPool = createDbPool(undefined, { connectionTimeoutMillis: 3000, statement_timeout: 5000 });
    serverPool.on('error', error => {
      console.error('PostgreSQL idle connection failed', 'code' in error ? error.code : 'unknown');
    });
  }
  return serverPool;
}

export async function withTransaction<T>(
  pool: Pool,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
