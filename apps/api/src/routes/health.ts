import type { FastifyInstance } from 'fastify';
import { dbHealth } from '../db.js';
import { redis } from '../redis.js';
import { discord } from '../discord/client.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    const dbTime = await dbHealth();
    return {
      ok: true,
      database: 'ok',
      databaseTime: dbTime,
      redis: redis.isReady ? 'ok' : 'not-ready',
      discord: discord.isReady() ? 'connected' : 'not-connected',
      now: new Date().toISOString()
    };
  });
}
