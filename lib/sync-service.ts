import { randomUUID } from 'node:crypto';
import { syncCatalog } from './catalog.js';
import { CatalogConflict, createCatalogStore } from './catalog-store.js';
import type { CatalogStore } from './catalog-store';
import type { Catalog } from './types';

export class SyncBusy extends Error {}
export class SyncCooldown extends Error {}
interface Dependencies { store?: CatalogStore; discover?: (previous: Catalog) => Promise<Catalog>; now?: () => Date }

export function createSyncService(dependencies: Dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const discover = dependencies.discover || syncCatalog;
  const store = () => dependencies.store || createCatalogStore();
  let inFlight: Promise<Catalog> | undefined;

  async function execute(): Promise<Catalog> {
    const storage = store();
    const leaseId = randomUUID();
    let previous: Catalog | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await storage.load();
      const time = now();
      if (current.catalog.sync?.runningUntil && Date.parse(current.catalog.sync.runningUntil) > time.getTime()) throw new SyncBusy('A library update is already running. Check back shortly.');
      if (current.catalog.sync?.lastAttemptAt && time.getTime() - Date.parse(current.catalog.sync.lastAttemptAt) < 10 * 60_000) throw new SyncCooldown('The library was recently checked. Please wait ten minutes before checking again.');
      const locked: Catalog = { ...current.catalog, sync: {
        nextArchivePage: 2, nextOpenLibraryPage: 2, newBooks: 0, ...current.catalog.sync,
        leaseId, runningUntil: new Date(time.getTime() + 290_000).toISOString(), lastAttemptAt: time.toISOString(),
      } };
      try { await storage.save(locked, current.revision); previous = locked; break; }
      catch (error) { if (!(error instanceof CatalogConflict) || attempt === 2) throw error; }
    }
    if (!previous) throw new SyncBusy('Another update started. Please check back shortly.');
    try {
      const result = await discover(previous);
      const current = await storage.load();
      if (current.catalog.sync?.leaseId !== leaseId) throw new SyncBusy('A newer update has taken over.');
      delete result.automation;
      result.sync = { ...result.sync!, leaseId: undefined, runningUntil: undefined };
      await storage.save(result, current.revision);
      return result;
    } catch (error) {
      // Preserve all books and the last successful timestamp on failure.
      try {
        const current = await storage.load();
        if (current.catalog.sync?.leaseId === leaseId) {
          current.catalog.sync = { ...current.catalog.sync, leaseId: undefined, runningUntil: undefined,
            newBooks: 0, lastError: error instanceof Error ? error.message : 'Metadata update failed.' };
          await storage.save(current.catalog, current.revision);
        }
      } catch (saveError) { console.error('Could not save sync failure status:', saveError instanceof Error ? saveError.name : 'unknown'); }
      throw error;
    }
  }
  return {
    read: () => store().load().then((result) => result.catalog),
    run(): Promise<Catalog> {
      if (!inFlight) inFlight = execute().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
}
export const catalogService = createSyncService();
