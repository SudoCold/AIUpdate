import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCatalog } from '../lib/merge-catalog';
import { syncCatalog } from '../lib/catalog';
import { createSyncService, SyncBusy, SyncCooldown } from '../lib/sync-service';
import { CatalogConflict } from '../lib/catalog-store';
import type { CatalogStore } from '../lib/catalog-store';
import { createApiApp, publicCatalog } from '../lib/api';
import type { Book, Catalog } from '../lib/types';
import { completeCatalog } from '../src/catalog-client';

const oldTime = '2026-01-01T00:00:00.000Z';
const newTime = '2026-01-02T01:00:00.000Z';
const book = (id: string, changes: Partial<Book> = {}): Book => ({ id, title: `AI book ${id}`, author: 'An Author',
  description: 'An introduction to artificial intelligence.', year: 2026, cover: null,
  source: 'open-library', sourceUrl: `https://openlibrary.org/works/${id}`, language: 'Not listed', topics: ['AI fundamentals'], ...changes });
const initial = (): Catalog => ({ books: [book('old')], updatedAt: oldTime, source: 'open-library', archiveAvailable: false, note: 'Test seed' });

function memoryStore(): CatalogStore {
  let catalog = initial(); let version = 0;
  return {
    async load() { return { catalog: structuredClone(catalog), revision: String(version) }; },
    async save(next, expected) { if (expected !== String(version)) throw new CatalogConflict(); catalog = structuredClone(next); version++; },
  };
}

test('adds discoveries, retains earlier books and stable IDs, and enriches duplicate records', () => {
  const previous = initial();
  previous.books[0].cover = '/covers/old.jpg';
  const result = mergeCatalog(previous, [book('different-source-id', { title: 'AI book old', description: 'A longer description about artificial intelligence and learning.' }), book('new')], newTime);
  assert.equal(result.books.length, 2);
  assert.equal(result.sync?.newBooks, 1);
  assert.equal(result.books[0].id, 'old');
  assert.equal(result.books[0].cover, '/covers/old.jpg');
  assert.equal(result.books[0].discoveredAt, oldTime);
  assert.equal(result.books[1].discoveredAt, newTime);
  assert.equal(previous.books.length, 1);
});

test('does not erase a catalog when a later source returns fewer records', () => {
  const previous = initial(); previous.books.push(book('retained'));
  const result = mergeCatalog(previous, [book('new')], newTime);
  assert.deepEqual(result.books.map((item) => item.id), ['old', 'retained', 'new']);
  assert.equal(mergeCatalog(result, [book('new')], newTime).sync?.newBooks, 0);
});

test('discovers recent records, includes coverless books, deduplicates queries and advances the backfill cursor', async () => {
  const calls: URL[] = [];
  const request: typeof fetch = async (input) => {
    const url = new URL(String(input)); calls.push(url);
    if (url.hostname !== 'openlibrary.org') return new Response('Blocked', { status: 403 });
    if (url.searchParams.has('sort') && !url.searchParams.get('sort')) return new Response('Invalid sort', { status: 422 });
    if (url.pathname.startsWith('/works/')) return Response.json({ description: 'A book about AI.' });
    const page = Number(url.searchParams.get('page'));
    return Response.json({ numFound: 500, docs: [{ key: `/works/OL${page}W`, title: page === 1 ? 'New AI book' : `Older AI handbook ${page}`, author_name: ['Test Author'], first_publish_year: 2026 }] });
  };
  const result = await syncCatalog(initial(), { request, pause: async () => {}, now: newTime });
  assert.equal(result.books.length, 3);
  assert.equal(result.sync?.newBooks, 2);
  assert.equal(result.sync?.nextOpenLibraryPage, 3);
  assert.equal(result.archiveAvailable, false);
  assert.ok(result.sync?.lastError?.includes('403'));
  assert.equal(result.books.find((item) => item.id === 'ol-OL1W')?.cover, null);
  assert.ok(calls.some((url) => url.searchParams.get('sort') === 'new'));
  const second = await syncCatalog(result, { request, pause: async () => {}, now: newTime });
  assert.equal(second.sync?.nextOpenLibraryPage, 4);
  assert.ok(second.books.some((item) => item.id === 'ol-OL3W'));
  assert.ok(second.books.some((item) => item.id === 'ol-OL2W'));
});

test('a failed discovery pass never mutates the previous catalog', async () => {
  const previous = initial();
  await assert.rejects(syncCatalog(previous, { request: async () => new Response('', { status: 503 }), pause: async () => {} }), /Both metadata sources/);
  assert.deepEqual(previous, initial());
});

test('two independent workers cannot overwrite each other during a discovery pass', async () => {
  const store = memoryStore();
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  const first = createSyncService({ store, now: () => new Date(newTime), discover: async (previous) => { await gate; return mergeCatalog(previous, [book('new')], newTime); } });
  const second = createSyncService({ store, now: () => new Date(newTime), discover: async (previous) => previous });
  const running = first.run();
  while (!(await store.load()).catalog.sync?.leaseId) await new Promise((resolve) => setTimeout(resolve, 0));
  await assert.rejects(second.run(), SyncBusy);
  unblock(); await running;
  assert.equal((await store.load()).catalog.books.length, 2);
  assert.equal((await store.load()).catalog.sync?.leaseId, undefined);
});

test('failures are recorded, locks are released and the last working timestamp is preserved', async () => {
  const store = memoryStore();
  const service = createSyncService({ store, now: () => new Date(newTime), discover: async () => { throw new Error('Source offline'); } });
  await assert.rejects(service.run(), /Source offline/);
  const result = (await store.load()).catalog;
  assert.equal(result.updatedAt, oldTime);
  assert.equal(result.books.length, 1);
  assert.equal(result.sync?.leaseId, undefined);
  assert.equal(result.sync?.lastError, 'Source offline');
  await assert.rejects(service.run(), SyncCooldown);
});

test('an expired worker lease is recoverable and successful updates survive a fresh service instance', async () => {
  const store = memoryStore();
  const stored = await store.load();
  stored.catalog.sync = { nextArchivePage: 2, nextOpenLibraryPage: 2, newBooks: 0, leaseId: 'dead-worker', runningUntil: oldTime, lastAttemptAt: oldTime };
  await store.save(stored.catalog, stored.revision);
  const first = createSyncService({ store, now: () => new Date(newTime), discover: async (previous) => mergeCatalog(previous, [book('new')], newTime) });
  await first.run();
  const reloaded = createSyncService({ store });
  assert.equal((await reloaded.read()).books.length, 2);
});

test('the cron endpoint requires a secret and public responses hide worker lease identifiers', async () => {
  const original = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-secret-for-cron-endpoint';
  try {
    let runs = 0;
    const app = createApiApp({ read: async () => initial(), run: async () => { runs++; return initial(); } });
    assert.equal((await app.request('/api/cron/sync')).status, 401);
    assert.equal((await app.request('/api/cron/sync', { headers: { Authorization: 'Bearer incorrect' } })).status, 401);
    assert.equal(runs, 0);
    assert.equal((await app.request('/api/cron/sync', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })).status, 200);
    assert.equal(runs, 1);
    const catalog = initial(); catalog.sync = { nextArchivePage: 2, nextOpenLibraryPage: 2, newBooks: 0, leaseId: 'private-worker-id', runningUntil: newTime };
    assert.equal(publicCatalog(catalog).sync?.leaseId, undefined);
    assert.equal(catalog.sync.leaseId, 'private-worker-id');
    assert.equal((await app.request('/api/refresh', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  } finally { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original; }
});

test('large catalogs are paginated without losing books or mixing revisions', async () => {
  const catalog = initial();
  catalog.books = Array.from({ length: 250 }, (_, index) => book(String(index)));
  const app = createApiApp({ read: async () => catalog, run: async () => catalog });
  const first = await (await app.request('/api/books')).json();
  assert.equal(first.books.length, 200);
  assert.equal(first.totalBooks, 250);
  assert.equal(first.nextOffset, 200);
  const last = await (await app.request(`/api/books?offset=200&revision=${encodeURIComponent(catalog.updatedAt)}`)).json();
  assert.equal(last.books.length, 50);
  assert.equal(last.nextOffset, null);
  assert.equal(last.books[0].id, '200');
  assert.equal((await app.request('/api/books?offset=-1')).status, 400);
  assert.equal((await app.request('/api/books?offset=200&revision=old-revision')).status, 409);
});

test('the browser combines every catalog page and rejects mixed revisions', async () => {
  const catalog = initial();
  catalog.books = Array.from({ length: 450 }, (_, index) => book(String(index)));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input), 'https://aiupdate.example');
      return Response.json(publicCatalog(catalog, Number(url.searchParams.get('offset'))));
    };
    const result = await completeCatalog(publicCatalog(catalog), new AbortController().signal);
    assert.equal(result.books.length, 450);
    assert.equal(result.books[449].id, '449');
    globalThis.fetch = async () => Response.json({ ...publicCatalog(catalog, 200), updatedAt: newTime });
    await assert.rejects(completeCatalog(publicCatalog(catalog), new AbortController().signal), /Inconsistent catalog/);
  } finally { globalThis.fetch = original; }
});
