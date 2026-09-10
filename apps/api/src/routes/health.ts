import type { FastifyInstance } from 'fastify';
import { dbHealth } from '../db.js';
import { redis } from '../redis.js';
import { discord } from '../discord/client.js';
import { getAiRuntimeHealth } from '../services/aiRuntime.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const [dbTime,ai] = await Promise.all([dbHealth(),getAiRuntimeHealth()]);
    return {
      ok: true,
      database: 'ok',
      databaseTime: dbTime,
      redis: redis.isReady ? 'ok' : 'not-ready',
      discord: discord.isReady() ? 'connected' : 'not-connected',
      ai: { status:ai.status,configured:ai.configured,enabled:ai.enabled },
      now: new Date().toISOString()
    };
  });
}
