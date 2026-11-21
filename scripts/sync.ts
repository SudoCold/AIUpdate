import { catalogService } from '../lib/sync-service.js';
const catalog = await catalogService.run();
console.info(`Added ${catalog.sync?.newBooks || 0} books; ${catalog.books.length} books retained in the persistent catalog.`);
