import Fastify from 'fastify';
import { env } from './env.js';
import { db, runMigrations } from './db.js';
import { redis } from './redis.js';
import { startDiscord, discord, startTicketMaintenanceWorker, stopTicketMaintenanceWorker } from './discord/client.js';
import { healthRoutes } from './routes/health.js';
import { adminRoutes } from './routes/admin.js';
import { liveModerationRoutes } from './routes/liveModeration.js';
import { suggestionRoutes } from './routes/suggestions.js';
import { backfillKnowledgeEmbeddings } from './services/knowledge.js';
import { backfillIssueEmbeddings } from './services/issues.js';
import { backfillSuggestionEmbeddings } from './services/suggestions.js';
import { startLiveModerationWorker, stopLiveModerationWorker } from './services/liveModeration.js';
import { startModerationNoticeEnricher } from './services/moderationNoticeEnricher.js';

const app = Fastify({ logger: true });
await runMigrations();
await redis.connect();

await app.register(healthRoutes);
await app.register(adminRoutes);
await app.register(liveModerationRoutes);
await app.register(suggestionRoutes);

app.get('/', async () => ({ service: 'Saucin AI API', version: '1.6.2' }));

await app.listen({ host: '0.0.0.0', port: env.PORT });
startModerationNoticeEnricher();
startDiscord()
  .then(() => { startLiveModerationWorker(); startTicketMaintenanceWorker(); })
  .catch((error) => app.log.error(error, 'Discord startup failed'));
backfillKnowledgeEmbeddings(200).catch((error) => app.log.error(error, 'Knowledge embedding backfill failed'));
backfillIssueEmbeddings(100).catch((error) => app.log.error(error, 'Issue embedding backfill failed'));
backfillSuggestionEmbeddings(100).catch((error) => app.log.error(error, 'Suggestion embedding backfill failed'));

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  stopLiveModerationWorker();
  stopTicketMaintenanceWorker();
  await discord.destroy();
  await redis.quit().catch(() => undefined);
  await db.end();
  await app.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
