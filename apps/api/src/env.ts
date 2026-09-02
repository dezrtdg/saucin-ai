import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3100),
  SERVER_NAME: z.string().default('Saucin RP'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://redis:6379'),
  DASHBOARD_API_KEY: z.string().min(16),
  DASHBOARD_AUTH_REQUIRED: z.string().default('true').transform(v => v.toLowerCase() === 'true'),
  DASHBOARD_ALLOWED_USER_IDS: z.string().optional().default(''),
  DASHBOARD_ALLOWED_ROLE_IDS: z.string().optional().default(''),
  DISCORD_TOKEN: z.string().optional().default(''),
  DISCORD_CLIENT_ID: z.string().optional().default(''),
  DISCORD_GUILD_ID: z.string().optional().default(''),
  DEFAULT_CHANNEL_MODE: z.enum(['monitor','questions','issues','suggestions','full','ignored']).default('ignored'),
  OPENAI_API_KEY: z.string().optional().default(''),
  AI_CLASSIFIER_MODEL: z.string().default('gpt-5.4-nano'),
  AI_REPLY_MODEL: z.string().default('gpt-5.4-mini'),
  AI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  AI_ENABLED: z.string().default('true').transform(v => v.toLowerCase() === 'true'),
  AI_REPLY_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.78)
});

export const env = schema.parse(process.env);
