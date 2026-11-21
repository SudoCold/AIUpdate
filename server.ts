import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { apiApp } from './lib/api';
import { catalogService } from './lib/sync-service';

const app = new Hono();
app.route('/', apiApp);
app.use('/covers/*', serveStatic({ root: './public' }));
app.use('*', serveStatic({ root: './dist' }));
app.get('*', serveStatic({ path: './dist/index.html' }));

// Local equivalent of the production Vercel Cron. No visitor is needed.
let checking = false;
async function checkSchedule() {
  if (checking) return;
  checking = true;
  try {
    const catalog = await catalogService.read();
    const lastCheck = catalog.sync?.lastAttemptAt || catalog.updatedAt;
    if (Date.now() - Date.parse(lastCheck) >= 24 * 60 * 60_000) await catalogService.run();
  } catch (error) { console.error('Scheduled library check:', error instanceof Error ? error.message : 'failed'); }
  finally { checking = false; }
}
const timer = setInterval(() => { void checkSchedule(); }, 60_000);
timer.unref();
void checkSchedule();
serve({ fetch: app.fetch, port: Number(process.env.PORT || 3001), hostname: '0.0.0.0' },
  (info) => console.info(`AIUpdate server: http://localhost:${info.port} (automatic daily discovery enabled)`));
