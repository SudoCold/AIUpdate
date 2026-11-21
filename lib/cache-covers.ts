import { access, mkdir, writeFile, rename } from 'node:fs/promises';
import type { Catalog } from './types';

/** Keep a small local thumbnail cache so the bundled page needs no image service. */
export async function cacheCovers(catalog: Catalog): Promise<Catalog> {
  await mkdir('public/covers', { recursive: true });
  for (const book of catalog.books) {
    const original = book.originalCover || book.cover;
    if (!original?.startsWith('https://') || !/^[a-zA-Z0-9-]+$/.test(book.id)) continue;
    const file = `public/covers/${book.id}.jpg`;
    try {
      try { await access(file); }
      catch {
        const response = await fetch(original, { signal: AbortSignal.timeout(20_000) });
        if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length < 500) continue;
        await writeFile(`${file}.tmp`, bytes);
        await rename(`${file}.tmp`, file);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      book.originalCover = original;
      book.cover = `/covers/${book.id}.jpg`;
    } catch { /* A failed image fetch never prevents a metadata refresh. */ }
  }
  return catalog;
}
