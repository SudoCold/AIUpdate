import { cleanText, isAIRecord } from './metadata.js';
import type { Book, Catalog } from './types';

export function bookIdentity(book: Pick<Book, 'title' | 'author'>): string {
  return cleanText(`${book.title} ${book.author}`).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** Keep stable IDs and first-discovery dates, even across source changes. */
export function mergeBooks(previous: Book[], incoming: Book[], now: string, baseline: string): { books: Book[]; added: number } {
  const books = previous.map((book) => ({ ...book, discoveredAt: book.discoveredAt || baseline }));
  const identities = new Map(books.map((book, index) => [bookIdentity(book), index]));
  const ids = new Map(books.map((book, index) => [book.id, index]));
  let added = 0;
  for (const book of incoming) {
    if (!isAIRecord(book.title, book.description)) continue;
    const position = ids.get(book.id) ?? identities.get(bookIdentity(book));
    if (position === undefined) {
      identities.set(bookIdentity(book), books.length);
      ids.set(book.id, books.length);
      books.push({ ...book, discoveredAt: now, lastSeenAt: now });
      added++;
      continue;
    }
    const existing = books[position];
    const preferred = existing.source === 'annas-archive' && book.source !== 'annas-archive' ? existing : book;
    books[position] = {
      ...existing, ...preferred, id: existing.id,
      description: book.description.length > existing.description.length ? book.description : existing.description,
      cover: existing.cover?.startsWith('/covers/') ? existing.cover : preferred.cover || existing.cover,
      originalCover: existing.originalCover || book.originalCover,
      year: preferred.year ?? existing.year,
      topics: [...new Set([...existing.topics, ...book.topics])],
      discoveredAt: existing.discoveredAt || baseline, lastSeenAt: now,
      descriptionCheckedAt: book.descriptionCheckedAt || existing.descriptionCheckedAt,
    };
    ids.set(book.id, position);
    identities.set(bookIdentity(book), position);
  }
  return { books, added };
}

export function mergeCatalog(previous: Catalog, incoming: Book[], now: string): Catalog {
  const { books, added } = mergeBooks(previous.books, incoming, now, previous.updatedAt);
  const sources = new Set(books.map((book) => book.source));
  return {
    ...previous, books, updatedAt: now,
    source: sources.size > 1 ? 'mixed' : books[0]?.source || previous.source,
    sync: { nextArchivePage: 2, nextOpenLibraryPage: 2, ...previous.sync, newBooks: added },
  };
}
