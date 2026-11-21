import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BlobNotFoundError, BlobPreconditionFailedError, get, put } from '@vercel/blob';
import snapshot from '../src/data/catalog.json' with { type: 'json' };
import type { Catalog } from './types';

export class CatalogConflict extends Error {}
export interface StoredCatalog { catalog: Catalog; revision?: string }
export interface CatalogStore {
  load(): Promise<StoredCatalog>;
  save(catalog: Catalog, expectedRevision?: string): Promise<void>;
}
export const seedCatalog = () => structuredClone(snapshot) as Catalog;
export const hasBlobStorage = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
const pathname = () => process.env.VERCEL_ENV === 'preview' ? 'aiupdate/preview-catalog.json' : 'aiupdate/catalog.json';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export function createCatalogStore(): CatalogStore {
  if (hasBlobStorage()) return {
    async load() {
      try {
        const result = await get(pathname(), { access: 'private', useCache: false });
        if (!result) return { catalog: seedCatalog() };
        if (result.statusCode !== 200) throw new Error('Could not read the catalog.');
        return { catalog: await new Response(result.stream).json() as Catalog, revision: result.blob.etag };
      } catch (error) {
        if (error instanceof BlobNotFoundError) return { catalog: seedCatalog() };
        throw error;
      }
    },
    async save(catalog, expectedRevision) {
      try {
        await put(pathname(), JSON.stringify(catalog), {
          access: 'private', contentType: 'application/json', addRandomSuffix: false,
          allowOverwrite: Boolean(expectedRevision), ifMatch: expectedRevision, cacheControlMaxAge: 60,
        });
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists/i.test(error.message))) throw new CatalogConflict('The catalog changed during this update.');
        throw error;
      }
    },
  };
  if (process.env.VERCEL) return {
    async load() { return { catalog: seedCatalog() }; },
    async save() { throw new Error('Connect a private Vercel Blob store to enable persistent updates.'); },
  };
  const file = process.env.CATALOG_PATH || '.data/catalog.json';
  return {
    async load() {
      try { const text = await readFile(file, 'utf8'); return { catalog: JSON.parse(text) as Catalog, revision: digest(text) }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { catalog: seedCatalog() }; throw error; }
    },
    async save(catalog, expectedRevision) {
      let actual: string | undefined;
      try { actual = digest(await readFile(file, 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (actual !== expectedRevision) throw new CatalogConflict('The catalog changed during this update.');
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(catalog, null, 2) + '\n');
      await rename(temporary, file);
    },
  };
}
