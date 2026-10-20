require('dotenv').config({ quiet: true });
const { z } = require('zod');
const config = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1), REDIS_URL: z.string().min(1),
  CORS_ORIGINS: z.string().min(1),
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  TOW_BASE_TOMAN: z.coerce.number().int().nonnegative().default(200000),
  TOW_PER_KM_TOMAN: z.coerce.number().int().positive().default(20000),
  PRICING_VERSION: z.string().default('v1'),
  DISTANCE_MODE: z.enum(['road', 'geodesic']).default('road'),
  OSRM_URL: z.string().url().default('https://router.project-osrm.org'),
  LOCATION_MAX_AGE_SECONDS: z.coerce.number().int().min(10).max(600).default(120),
  UPLOAD_DIR: z.string().default('./uploads'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
}).parse(process.env);
module.exports = { ...config, origins: config.CORS_ORIGINS.split(',').map(v => v.trim()) };
