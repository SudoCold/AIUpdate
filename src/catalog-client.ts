import type { Catalog, CatalogPage } from '../lib/types';

/** Fetch all pages of one consistent catalog revision as the collection grows. */
export async function completeCatalog(first: Catalog | CatalogPage, signal: AbortSignal): Promise<Catalog> {
  const books = [...first.books];
  let nextOffset = (first as Partial<CatalogPage>).nextOffset;
  let previousOffset = 0;
  while (typeof nextOffset === 'number') {
    if (nextOffset <= previousOffset) throw new Error('Invalid catalog pagination.');
    previousOffset = nextOffset;
    const query = new URLSearchParams({ offset: String(nextOffset), revision: first.updatedAt });
    const response = await fetch(`/api/books?${query}`, { signal });
    if (!response.ok) throw new Error('The library changed while loading. Your current library is still available.');
    const page = await response.json() as CatalogPage;
    if (page.updatedAt !== first.updatedAt || !Array.isArray(page.books)) throw new Error('Inconsistent catalog response.');
    books.push(...page.books);
    nextOffset = page.nextOffset;
  }
  return { ...first, books };
}
