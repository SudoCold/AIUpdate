import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { catalogService, SyncBusy, SyncCooldown } from './sync-service';
import { hasBlobStorage } from './catalog-store';
import type { Catalog, CatalogPage } from './types';

const automation = () => ({ enabled: !process.env.VERCEL || (hasBlobStorage() && Boolean(process.env.CRON_SECRET)),
  intervalHours: 24, schedule: process.env.VERCEL ? 'Daily, around 9 AM Asia/Manila' : 'Every 24 hours while the local server is running' });
export function publicCatalog(catalog: Catalog, offset = 0, limit = 200): CatalogPage {
  const copy = { ...catalog, sync: catalog.sync ? { ...catalog.sync } : undefined, automation: automation() };
  if (copy.sync) { delete copy.sync.leaseId; delete copy.sync.runningUntil; }
  return { ...copy, books: copy.books.slice(offset, offset + limit), totalBooks: copy.books.length,
    nextOffset: offset + limit < copy.books.length ? offset + limit : null };
}
function authorized(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function createApiApp(service = catalogService) {
  const app = new Hono();
  app.get('/api/books', async (c) => {
    const offset = Number(c.req.query('offset') || 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return c.json({ error: 'Invalid catalog offset.' }, 400);
    try {
      const catalog = await service.read();
      if (c.req.query('revision') && c.req.query('revision') !== catalog.updatedAt) return c.json({ error: 'The library changed while loading. Please retry.' }, 409);
      return c.json(publicCatalog(catalog, offset), 200, { 'Cache-Control': 'public, max-age=30, s-maxage=60' });
    }
    catch { return c.json({ error: 'The library is temporarily unavailable. Your bundled catalog is still available.' }, 503); }
  });
  app.post('/api/refresh', async (c) => {
    if (c.req.header('Sec-Fetch-Site') === 'cross-site') return c.json({ error: 'Use the refresh button on AIUpdate.' }, 403);
    if (process.env.VERCEL && !hasBlobStorage()) return c.json({ error: 'Automatic updates need a connected private Vercel Blob store. The existing catalog is still available.' }, 503);
    try { return c.json(publicCatalog(await service.run()), 200, { 'Cache-Control': 'no-store' }); }
    catch (error) {
      if (error instanceof SyncCooldown) return c.json({ error: error.message }, 429, { 'Retry-After': '600' });
      if (error instanceof SyncBusy) return c.json({ error: error.message }, 409);
      return c.json({ error: 'Metadata sources are unavailable. Your existing library has been preserved.' }, 503);
    }
  });
  app.get('/api/cron/sync', async (c) => {
    if (!authorized(c.req.header('Authorization'))) return c.json({ error: 'Unauthorized' }, 401);
    if (process.env.VERCEL && !hasBlobStorage()) return c.json({ error: 'Private Blob storage is not configured.' }, 503);
    try {
      const catalog = await service.run();
      return c.json({ ok: true, total: catalog.books.length, added: catalog.sync?.newBooks || 0, checkedAt: catalog.updatedAt, sourceWarnings: catalog.sync?.lastError || null });
    } catch (error) {
      if (error instanceof SyncBusy || error instanceof SyncCooldown) return c.json({ ok: true, skipped: true, reason: error.message });
      console.error('Scheduled sync failed:', error instanceof Error ? error.message : 'unknown');
      return c.json({ ok: false, error: 'Sync failed. Existing books have been preserved.' }, 503);
    }
  });
  app.get('/api/health', (c) => c.json({ ok: true, automaticUpdates: automation() }));
  app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));
  return app;
}
export const apiApp = createApiApp();
