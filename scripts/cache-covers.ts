import { readFile, writeFile, rename } from 'node:fs/promises';
import { cacheCovers } from '../lib/cache-covers';
import type { Catalog } from '../lib/types';
const catalog = JSON.parse(await readFile('src/data/catalog.json', 'utf8')) as Catalog;
await cacheCovers(catalog);
await writeFile('src/data/catalog.json.tmp', JSON.stringify(catalog, null, 2) + '\n');
await rename('src/data/catalog.json.tmp', 'src/data/catalog.json');
console.info(`Cached covers for ${catalog.books.filter((book) => book.cover?.startsWith('/covers/')).length} books.`);
