export type Topic = 'AI fundamentals' | 'Machine learning' | 'Deep learning' | 'Generative AI' | 'Ethics & society' | 'Applied AI';
export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  year: number | null;
  cover: string | null;
  originalCover?: string;
  sourceUrl: string;
  source: 'annas-archive' | 'open-library';
  language: string;
  topics: Topic[];
  discoveredAt?: string;
  lastSeenAt?: string;
  descriptionCheckedAt?: string;
}
export interface SyncState {
  nextArchivePage: number;
  nextOpenLibraryPage: number;
  lastAttemptAt?: string;
  lastError?: string;
  newBooks: number;
  leaseId?: string;
  runningUntil?: string;
}
export interface Catalog {
  books: Book[];
  updatedAt: string;
  source: 'annas-archive' | 'open-library' | 'mixed';
  archiveAvailable: boolean;
  note: string;
  sync?: SyncState;
  automation?: { enabled: boolean; intervalHours: number; schedule: string };
}
export interface CatalogPage extends Catalog {
  totalBooks: number;
  nextOffset: number | null;
}
