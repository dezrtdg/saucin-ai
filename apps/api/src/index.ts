import Fastify from 'fastify';
import { env } from './env.js';
import { db, runMigrations } from './db.js';
import { redis } from './redis.js';
import { startDiscord, discord } from './discord/client.js';
import { healthRoutes } from './routes/health.js';
import { adminRoutes } from './routes/admin.js';
import { backfillKnowledgeEmbeddings } from './services/knowledge.js';
import { backfillIssueEmbeddings } from './services/issues.js';

const app = Fastify({ logger: true });
await runMigrations();
await redis.connect();

await app.register(healthRoutes);
await app.register(adminRoutes);

app.get('/', async () => ({ service: 'Saucin AI API', version: '1.3.0' }));

await app.listen({ host: '0.0.0.0', port: env.PORT });
startDiscord().catch((error) => app.log.error(error, 'Discord startup failed'));
backfillKnowledgeEmbeddings(200).catch((error) => app.log.error(error, 'Knowledge embedding backfill failed'));
backfillIssueEmbeddings(100).catch((error) => app.log.error(error, 'Issue embedding backfill failed'));

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  await discord.destroy();
  await redis.quit().catch(() => undefined);
  await db.end();
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
