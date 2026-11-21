import { classify, cleanText, deduplicate, isAIRecord, parseArchiveDetail, parseArchiveSearch } from './metadata.js';
import { mergeCatalog } from './merge-catalog.js';
import type { Book, Catalog } from './types';

const QUERIES = ['Artificial Intelligence', 'AI', 'Artificial-Intelligence'];
const PAGE_SIZE = 50;
interface Context { request: typeof fetch; pause: (ms: number) => Promise<void>; deadline: number; now: string }
interface Batch { books: Book[]; nextPage: number; available: boolean; warning?: string }
export interface SyncOptions { request?: typeof fetch; pause?: (ms: number) => Promise<void>; budgetMs?: number; now?: string }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const withinBudget = (context: Context) => Date.now() < context.deadline - 1500;

async function get(url: string, context: Context): Promise<Response> {
  const remaining = context.deadline - Date.now();
  if (remaining < 1500) throw new Error('Metadata time budget reached; remaining pages will be checked on a later run.');
  const response = await context.request(url, {
    headers: { 'User-Agent': 'AIUpdate/1.0 (AI book metadata discovery)', Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(Math.min(12_000, remaining)),
  });
  if (!response.ok) throw new Error(`Metadata source returned HTTP ${response.status}`);
  return response;
}

async function archiveBatch(previous: Catalog, context: Context): Promise<Batch> {
  const base = process.env.ANNAS_ARCHIVE_BASE_URL || 'https://annas-archive.gl';
  if (!base.startsWith('https://')) throw new Error('Archive base URL must use HTTPS.');
  const page = previous.sync?.nextArchivePage || 2;
  const collected: Book[] = [];
  let completedBackfill = true;
  let hasMore = false;
  let available = false;
  let warning: string | undefined;
  for (const query of QUERIES) {
    for (const entry of [{ page: 1, sort: 'newest', backfill: false }, { page, sort: '', backfill: true }]) {
      if (!withinBudget(context)) { completedBackfill = false; break; }
      const url = new URL('/search', base);
      url.search = new URLSearchParams({ q: query, content: 'book_nonfiction', page: String(entry.page), sort: entry.sort }).toString();
      if (!entry.sort) url.searchParams.delete('sort');
      try {
        const html = await (await get(url.href, context)).text();
        const books = parseArchiveSearch(html, base);
        if (!books.length && !/no (?:results|files|matches)|nothing found/i.test(html)) throw new Error('Search access is blocked or its page format changed.');
        available = true;
        collected.push(...books);
        if (entry.backfill && books.length) hasMore = true;
      } catch (error) {
        warning = `Anna’s Archive: ${error instanceof Error ? error.message : 'unavailable'}`;
        if (!available) return { books: [], nextPage: page, available: false, warning };
        completedBackfill = false;
        break;
      }
      await context.pause(600);
    }
  }
  const books = deduplicate(collected);
  const known = new Map(previous.books.map((book) => [book.id, book]));
  let detailRequests = 0;
  for (const book of books) {
    const existing = known.get(book.id);
    if (existing?.description) book.description = existing.description;
    if (book.description.length >= 100 || detailRequests >= 20 || !withinBudget(context)) continue;
    if (existing?.descriptionCheckedAt && Date.parse(context.now) - Date.parse(existing.descriptionCheckedAt) < 7 * 86400_000) continue;
    detailRequests++;
    try {
      const details = parseArchiveDetail(await (await get(book.sourceUrl, context)).text());
      if (details.description) book.description = details.description;
      if (details.cover) book.cover = details.cover;
      book.descriptionCheckedAt = context.now;
      book.topics = classify(book.title, book.description);
    } catch { /* Preserve independently usable search metadata. */ }
    await context.pause(600);
  }
  return { books, nextPage: completedBackfill ? hasMore ? page + 1 : 2 : page, available, warning };
}

interface OpenLibrarySearchBook {
  key: string; title: string; author_name?: string[]; first_publish_year?: number;
  cover_i?: number; subject?: string[];
}
async function openLibraryBatch(previous: Catalog, context: Context): Promise<Batch> {
  const page = previous.sync?.nextOpenLibraryPage || 2;
  const records = new Map<string, OpenLibrarySearchBook>();
  let hasMore = false;
  let completedBackfill = true;
  let available = false;
  let warning: string | undefined;
  for (const query of QUERIES) {
    for (const entry of [{ page: 1, sort: 'new', backfill: false }, { page, sort: '', backfill: true }]) {
      if (!withinBudget(context)) { completedBackfill = false; break; }
      const url = new URL('https://openlibrary.org/search.json');
      url.search = new URLSearchParams({ q: query, limit: String(PAGE_SIZE), page: String(entry.page), sort: entry.sort,
        fields: 'key,title,author_name,first_publish_year,cover_i,subject' }).toString();
      if (!entry.sort) url.searchParams.delete('sort');
      try {
        const data = await (await get(url.href, context)).json() as { docs: OpenLibrarySearchBook[]; numFound?: number; num_found?: number };
        if (!Array.isArray(data.docs)) throw new Error('Invalid metadata response.');
        available = true;
        for (const record of data.docs) if (/^\/works\/OL\d+W$/.test(record.key) && record.title) records.set(record.key, record);
        if (entry.backfill && (data.numFound ?? data.num_found ?? Infinity) > page * PAGE_SIZE && data.docs.length) hasMore = true;
      } catch (error) {
        warning = `Open Library: ${error instanceof Error ? error.message : 'unavailable'}`;
        completedBackfill = false;
        if (!available) return { books: [], nextPage: page, available, warning };
      }
      await context.pause(400);
    }
  }
  const known = new Map(previous.books.map((book) => [book.id, book]));
  const books: Book[] = [];
  let detailRequests = 0;
  for (const record of records.values()) {
    const id = `ol-${record.key.split('/').pop()}`;
    const existing = known.get(id);
    let description = existing?.description || '';
    let descriptionCheckedAt = existing?.descriptionCheckedAt;
    const recentlyChecked = descriptionCheckedAt && Date.parse(context.now) - Date.parse(descriptionCheckedAt) < 7 * 86400_000;
    if (!description && !recentlyChecked && detailRequests < 30 && withinBudget(context)) {
      detailRequests++;
      try {
        const work = await (await get(`https://openlibrary.org${record.key}.json`, context)).json() as { description?: string | { value: string } };
        description = typeof work.description === 'string' ? work.description : work.description?.value || '';
        description = cleanText(description.replace(/<[^>]*>/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
        descriptionCheckedAt = context.now;
      } catch { /* A matching title remains a valid record without a description. */ }
      await context.pause(400);
    }
    if (isAIRecord(record.title, description)) books.push({
      id, title: record.title, author: [...new Set(record.author_name || ['Author not listed'])].join(', '),
      description, descriptionCheckedAt, year: record.first_publish_year || null,
      cover: record.cover_i ? `https://covers.openlibrary.org/b/id/${record.cover_i}-L.jpg` : null,
      sourceUrl: `https://openlibrary.org${record.key}`, source: 'open-library', language: 'Not listed',
      topics: classify(record.title, description, record.subject),
    });
  }
  return { books: deduplicate(books), nextPage: completedBackfill ? hasMore ? page + 1 : 2 : page, available, warning };
}

/** A cumulative pass: recent records plus a resumable historical page. */
export async function syncCatalog(previous: Catalog, options: SyncOptions = {}): Promise<Catalog> {
  const context: Context = { request: options.request || fetch, pause: options.pause || sleep,
    deadline: Date.now() + (options.budgetMs ?? 230_000), now: options.now || new Date().toISOString() };
  const archive = await archiveBatch(previous, context).catch((error) => ({ books: [] as Book[], nextPage: previous.sync?.nextArchivePage || 2,
    available: false, warning: `Anna’s Archive: ${error instanceof Error ? error.message : 'unavailable'}` }));
  const open = await openLibraryBatch(previous, context);
  if (!archive.available && !open.available) throw new Error('Both metadata sources are unavailable. The existing library has been preserved.');
  const next = mergeCatalog(previous, [...archive.books, ...open.books], context.now);
  next.archiveAvailable = archive.available;
  next.note = archive.available
    ? 'Accumulating matching metadata from Anna’s Archive and Open Library. Each check revisits recent records and continues through older results. Source coverage is not exhaustive.'
    : 'Anna’s Archive could not be reached. Matching Open Library records are being added to the existing library. Discovery depends on source indexing and availability.';
  next.sync = { ...next.sync!, nextArchivePage: archive.nextPage, nextOpenLibraryPage: open.nextPage,
    lastAttemptAt: context.now, lastError: [archive.warning, open.warning].filter(Boolean).join(' ') || undefined };
  return next;
}
