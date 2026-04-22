type RuntimeEnv = Record<string, string | undefined>;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);
const VALID_NODE_ENVS = new Set(['development', 'test', 'production']);

function parseInteger(name: string, value: string | undefined, fallback: number): number {
  const resolved = value ?? `${fallback}`;
  const parsed = Number.parseInt(resolved, 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a valid integer`);
  }

  return parsed;
}

function parseBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }

  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  throw new Error(`${name} must be a boolean value`);
}

function parseOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/**
 * Parse a PostgreSQL connection string (e.g., Railway's DATABASE_URL)
 * Format: postgresql://user:password@host:port/database?sslmode=require
 */
function parseDatabaseUrl(url: string): {
  host: string;
  port: number;
  username: string;
  password: string;
  name: string;
  ssl: boolean;
} {
  try {
    const parsed = new URL(url);
    const sslmode = parsed.searchParams.get('sslmode');

    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 5432,
      username: decodeURIComponent(parsed.username || 'postgres'),
      password: decodeURIComponent(parsed.password || 'postgres'),
      name: parsed.pathname?.slice(1) || 'payment_engine',
      ssl: sslmode === 'require' || sslmode === 'require_or_prefer',
    };
  } catch (err) {
    throw new Error(`Invalid DATABASE_URL format: ${err.message}`);
  }
}

/**
 * Parse a Redis connection string (e.g., Railway's REDIS_URL)
 * Format: redis://:password@host:port or redis://host:port
 */
function parseRedisUrl(url: string): {
  host: string;
  port: number;
  password: string | undefined;
} {
  try {
    const parsed = new URL(url);

    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch (err) {
    throw new Error(`Invalid REDIS_URL format: ${err.message}`);
  }
}

function resolveNodeEnv(env: RuntimeEnv): 'development' | 'test' | 'production' {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';

  if (!VALID_NODE_ENVS.has(nodeEnv)) {
    throw new Error('NODE_ENV must be one of: development, test, production');
  }

  return nodeEnv as 'development' | 'test' | 'production';
}

function requireNonEmpty(env: RuntimeEnv, key: string, errors: string[]): void {
  if (!env[key]?.trim()) {
    errors.push(`${key} is required in production`);
  }
}

export function isProductionEnv(env: RuntimeEnv = process.env): boolean {
  return resolveNodeEnv(env) === 'production';
}

export function isQueueDashboardEnabled(env: RuntimeEnv = process.env): boolean {
  return parseBoolean('APP_ENABLE_QUEUE_DASHBOARD', env.APP_ENABLE_QUEUE_DASHBOARD, !isProductionEnv(env));
}

export function validateDatabaseEnvironment(env: RuntimeEnv): RuntimeEnv {
  const nodeEnv = resolveNodeEnv(env);

  parseInteger('PORT', env.PORT, 3000);
  parseInteger('DB_PORT', env.DB_PORT, 5432);
  parseInteger('REDIS_PORT', env.REDIS_PORT, 6379);
  parseBoolean('DB_SSL', env.DB_SSL, nodeEnv === 'production');
  parseBoolean('DB_SSL_REJECT_UNAUTHORIZED', env.DB_SSL_REJECT_UNAUTHORIZED, true);

  return env;
}

export function validateEnvironment(env: RuntimeEnv): RuntimeEnv {
  const nodeEnv = resolveNodeEnv(env);
  const errors: string[] = [];

  validateDatabaseEnvironment(env);

  parseBoolean('APP_ENABLE_DOCS', env.APP_ENABLE_DOCS, nodeEnv !== 'production');
  parseBoolean('APP_ENABLE_QUEUE_DASHBOARD', env.APP_ENABLE_QUEUE_DASHBOARD, nodeEnv !== 'production');
  parseBoolean('TRUST_PROXY', env.TRUST_PROXY, nodeEnv === 'production');

  if (nodeEnv === 'production') {
    requireNonEmpty(env, 'APP_SECRET', errors);
    requireNonEmpty(env, 'WEBHOOK_SIGNING_SECRET', errors);

    if ((env.WEBHOOK_SIGNING_SECRET ?? '').trim() === 'fallback-secret-change-in-prod') {
      errors.push('WEBHOOK_SIGNING_SECRET must not use the default fallback value');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }

  return env;
}

export default () => {
  validateEnvironment(process.env);

  const nodeEnv = resolveNodeEnv(process.env);
  const isProduction = nodeEnv === 'production';

  // Parse Railway connection strings if available
  let dbConfig = {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInteger('DB_PORT', process.env.DB_PORT, 5432),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    name: process.env.DB_NAME ?? 'payment_engine',
    ssl: parseBoolean('DB_SSL', process.env.DB_SSL, isProduction),
    sslRejectUnauthorized: parseBoolean(
      'DB_SSL_REJECT_UNAUTHORIZED',
      process.env.DB_SSL_REJECT_UNAUTHORIZED,
      true,
    ),
  };

  if (process.env.DATABASE_URL) {
    const parsed = parseDatabaseUrl(process.env.DATABASE_URL);
    dbConfig = {
      ...parsed,
      sslRejectUnauthorized: parseBoolean(
        'DB_SSL_REJECT_UNAUTHORIZED',
        process.env.DB_SSL_REJECT_UNAUTHORIZED,
        true,
      ),
    };
  }

  let redisConfig = {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInteger('REDIS_PORT', process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD ?? undefined,
  };

  if (process.env.REDIS_URL) {
    redisConfig = parseRedisUrl(process.env.REDIS_URL);
  }

  return {
    nodeEnv,
    isProduction,
    port: parseInteger('PORT', process.env.PORT, 3000),
    appSecret: process.env.APP_SECRET ?? '',

    http: {
      enableDocs: parseBoolean('APP_ENABLE_DOCS', process.env.APP_ENABLE_DOCS, !isProduction),
      enableQueueDashboard: parseBoolean(
        'APP_ENABLE_QUEUE_DASHBOARD',
        process.env.APP_ENABLE_QUEUE_DASHBOARD,
        !isProduction,
      ),
      trustProxy: parseBoolean('TRUST_PROXY', process.env.TRUST_PROXY, isProduction),
      corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
    },

    database: dbConfig,

    redis: redisConfig,

    lenco: {
      baseUrl: process.env.LENCO_BASE_URL ?? 'https://api.lenco.co/access/v1',
      secretKey: process.env.LENCO_SECRET_KEY ?? '',
    },

    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    },

    webhook: {
      signingSecret: process.env.WEBHOOK_SIGNING_SECRET ?? '',
    },
  };
};
