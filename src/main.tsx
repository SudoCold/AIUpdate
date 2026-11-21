import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowDownUp, ArrowRight, ArrowUpRight, BookOpen, Bookmark, BrainCircuit, Check, ChevronDown, CircleHelp, Code2, Cpu, ExternalLink, Globe2, Grid2X2, Layers3, List, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Sparkles, Sprout, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Book, Catalog, Topic } from '../lib/types';
import initialCatalog from './data/catalog.json';
import { completeCatalog } from './catalog-client';
import './styles.css';

const topics: { name: Topic; icon: LucideIcon }[] = [
  { name: 'AI fundamentals', icon: BrainCircuit },
  { name: 'Machine learning', icon: Cpu },
  { name: 'Deep learning', icon: Layers3 },
  { name: 'Generative AI', icon: Sparkles },
  { name: 'Ethics & society', icon: ShieldCheck },
  { name: 'Applied AI', icon: Code2 },
];
const preferredAuthors = ['Melanie Mitchell', 'Stuart J. Russell', 'Tom Taulli', 'Max Tegmark', 'John Paul Mueller', 'N. P. Padhy', 'Peter Norvig', 'Kevin D. Ashley', 'Eric J. Topol'];
const PAGE_SIZE = 12;
const initialBookIds = new Set(initialCatalog.books.map((book) => book.id));
const isNewArrival = (book: Book) => !initialBookIds.has(book.id) && Boolean(book.discoveredAt) && Date.now() - Date.parse(book.discoveredAt!) < 7 * 86400_000;
const emptyDescription = 'A description is not available in the source metadata. Visit the original record for more bibliographic details.';
const formatDate = (date: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date));
const sourceName = (book: Book) => book.source === 'annas-archive' ? 'Anna’s Archive' : 'Open Library';

function readSaved(): string[] {
  try { const saved: unknown = JSON.parse(localStorage.getItem('aiupdate-saved') || '[]'); return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []; }
  catch { return []; }
}

function Cover({ book, className = '' }: { book: Book; className?: string }) {
  const [failed, setFailed] = useState(false);
  return book.cover && !failed
    ? <img className={`book-cover ${className}`} src={book.cover} alt={`${book.title} book cover`} onError={() => setFailed(true)} loading="lazy" referrerPolicy="no-referrer" />
    : <div className={`book-cover fallback-cover ${className}`}><BookOpen size={27} strokeWidth={1.2} /><strong>{book.title}</strong><span>{book.author}</span></div>;
}

function App() {
  const [catalog, setCatalog] = useState<Catalog>(initialCatalog as Catalog);
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState<Topic | 'All books'>('All books');
  const [year, setYear] = useState('all');
  const [sort, setSort] = useState('recently-added');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [saved, setSaved] = useState<string[]>(readSaved);
  const [savedOnly, setSavedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Book | null>(null);
  const [about, setAbout] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const aboutRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    async function checkForUpdates() {
      if (checking || document.visibilityState === 'hidden') return;
      checking = true;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
        const response = await fetch('/api/books', { signal });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return;
        const data = await response.json();
        if (Array.isArray(data?.books) && data.books.length) setCatalog(await completeCatalog(data, signal));
      } catch { /* Preserve the last working catalog while offline. */ }
      finally { checking = false; }
    }
    void checkForUpdates();
    const timer = window.setInterval(() => { void checkForUpdates(); }, 5 * 60_000);
    const onFocus = () => { void checkForUpdates(); };
    window.addEventListener('focus', onFocus);
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);
  useEffect(() => { try { localStorage.setItem('aiupdate-saved', JSON.stringify(saved)); } catch { /* In-memory reading list still works. */ } }, [saved]);
  useEffect(() => { setLimit(PAGE_SIZE); }, [query, topic, year, savedOnly, sort]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4200); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && !dialogRef.current?.open && !aboutRef.current?.open) {
        event.preventDefault(); searchRef.current?.focus(); searchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, []);
  useEffect(() => { if (selected) dialogRef.current?.showModal(); else dialogRef.current?.close(); }, [selected]);
  useEffect(() => { if (about) aboutRef.current?.showModal(); else aboutRef.current?.close(); }, [about]);
  useEffect(() => {
    if (selected || about) { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }
  }, [selected, about]);

  const counts = useMemo(() => Object.fromEntries(topics.map(({ name }) => [name, catalog.books.filter((book) => book.topics.includes(name)).length])), [catalog]);
  const books = useMemo(() => {
    const normalized = query.toLowerCase().trim();
    const result = catalog.books.filter((book) =>
      (!savedOnly || saved.includes(book.id)) &&
      (topic === 'All books' || book.topics.includes(topic)) &&
      (year === 'all' || (book.year !== null && (year === '2020' ? book.year >= 2020 : year === '2010' ? book.year >= 2010 && book.year < 2020 : book.year < 2010))) &&
      (!normalized || `${book.title} ${book.author} ${book.description} ${book.topics.join(' ')}`.toLowerCase().includes(normalized)),
    );
    return result.sort((a, b) => {
      if (sort === 'recently-added') {
        const delta = Date.parse(b.discoveredAt || initialCatalog.updatedAt) - Date.parse(a.discoveredAt || initialCatalog.updatedAt);
        if (delta) return delta;
      }
      if (sort === 'newest') return (b.year || 0) - (a.year || 0);
      if (sort === 'oldest') return (a.year || 9999) - (b.year || 9999);
      if (sort === 'title') return a.title.localeCompare(b.title);
      const rank = (book: Book) => { const index = preferredAuthors.findIndex((author) => book.author.includes(author)); return index === -1 ? 100 : index; };
      return rank(a) - rank(b) || (b.year || 0) - (a.year || 0);
    });
  }, [catalog, query, topic, year, sort, saved, savedOnly]);
  const heroBooks = useMemo(() => [
    catalog.books.find((book) => book.author.includes('Stuart J. Russell')),
    catalog.books.find((book) => book.author.includes('Melanie Mitchell')),
    catalog.books.find((book) => book.author.includes('Max Tegmark')),
  ].map((book, index) => book || catalog.books[index]).filter(Boolean), [catalog]);
  const activeFilters = topic !== 'All books' || year !== 'all' || !!query;

  function toggleSaved(book: Book) {
    const exists = saved.includes(book.id);
    setSaved((previous) => exists ? previous.filter((id) => id !== book.id) : [...previous, book.id]);
    setToast(exists ? 'Book removed from your reading list.' : 'A good read, saved for later.');
  }
  function clearFilters() { setQuery(''); setTopic('All books'); setYear('all'); }
  function goToLibrary(readingList = false) { setSavedOnly(readingList); clearFilters(); document.getElementById('library')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  async function refreshCatalog() {
    setRefreshing(true);
    try {
      const signal = AbortSignal.timeout(275_000);
      const response = await fetch('/api/refresh', { method: 'POST', signal });
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Run the AIUpdate server to refresh the catalog. Your saved snapshot is available.');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not refresh the catalog. Please try again.');
      if (!Array.isArray(data.books) || !data.books.length) throw new Error('No metadata returned. Your existing library is still available.');
      setCatalog(await completeCatalog(data, signal));
      const count = data.sync?.newBooks || 0;
      setToast(count ? `${count} new ${count === 1 ? 'book' : 'books'} added to the library.` : 'Library checked. You’re up to date with the latest discovered records.');
    } catch (error) { setToast(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'The metadata source took too long. Your existing library is still available.'); }
    finally { setRefreshing(false); }
  }

  return <>
    <a className="skip-link" href="#library">Skip to library</a>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href="#" aria-label="AIUpdate home"><span className="brand-mark"><BookOpen size={21} strokeWidth={1.8} /></span><span>AI<span className="brand-light">Update</span><span className="brand-dot">.</span></span></a>
        <nav className="desktop-nav" aria-label="Main navigation">
          <button className={!savedOnly ? 'nav-link active' : 'nav-link'} onClick={() => goToLibrary()}>The library</button>
          <button className={savedOnly ? 'nav-link active' : 'nav-link'} onClick={() => goToLibrary(true)}>Reading list<span className="nav-count">{saved.length}</span></button>
          <button className="nav-link" onClick={() => setAbout(true)}>About</button>
        </nav>
        <div className="header-note"><span className="status-dot" />A little more curious, every day.</div>
        <button className="mobile-saved icon-button" onClick={() => goToLibrary(true)} aria-label={`Reading list, ${saved.length} saved books`}><Bookmark size={20} /><span>{saved.length}</span></button>
      </div>
    </header>

    <main>
      <section className="hero shell" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" />THE AI READING ROOM</div>
          <h1 id="hero-title">Big ideas.<br />Better <span>understanding.</span></h1>
          <p>Your next chapter in artificial intelligence starts here.<br className="desktop-break" /> Discover the books behind the breakthroughs.</p>
          <button className="primary-button hero-cta" onClick={() => goToLibrary()}>Explore the library <ArrowDown size={17} /></button>
          <div className="hero-caption"><span className="tiny-book"><BookOpen size={13} /></span> For the builders, the thinkers, and the simply curious.</div>
        </div>
        <div className="hero-art">
          <div className="orbit orbit-one" /><div className="orbit orbit-two" />
          <span className="art-cross cross-one">+</span><span className="art-cross cross-two">+</span><span className="art-spark"><Sparkles size={23} strokeWidth={1} /></span>
          <span className="art-dot dot-one" /><span className="art-dot dot-two" />
          <div className="book-pedestal" />
          {heroBooks.map((book, index) => <button key={book.id} className={`hero-book hero-book-${index}`} onClick={() => setSelected(book)} aria-label={`Discover ${book.title} by ${book.author}`}><Cover book={book} /><span className="book-spine" /></button>)}
          <div className="floating-note"><span className="floating-icon"><Sprout size={18} /></span><span>A new perspective<br /><strong>is a few pages away.</strong></span></div>
          <div className="art-label">A SMALL LIBRARY. A WORLD OF IDEAS.</div>
        </div>
      </section>

      <div className="library-intro shell">
        <div><span className="intro-icon"><Globe2 size={18} strokeWidth={1.5} /></span><span>Open knowledge.<strong> Endless possibility.</strong></span></div>
        <div className="intro-stats"><span><strong>{catalog.books.length}</strong> books to explore</span><span className="stat-divider" /><span><strong>{topics.filter(({ name }) => counts[name] > 0).length}</strong> areas of curiosity</span><span className="stat-divider" /><span>One place to start <ArrowDownRight /></span></div>
      </div>

      <section className="library shell" id="library" aria-labelledby="library-title">
        <div className="library-heading">
          <div><div className="section-overline">FIND YOUR NEXT READ</div><h2 id="library-title">{savedOnly ? 'Your reading list' : 'Explore the library'}<span className="heading-count">{savedOnly ? catalog.books.filter((book) => saved.includes(book.id)).length : catalog.books.length}</span></h2></div>
          <button className="refresh-button" onClick={refreshCatalog} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'spin' : ''} /><span>{refreshing ? 'Checking sources…' : 'Refresh library'}</span></button>
        </div>
        <div className="library-toolbar">
          <div className="search-wrap"><Search size={19} strokeWidth={1.7} /><input ref={searchRef} aria-label="Search books, authors, or ideas" placeholder="Search books, authors, or ideas…" value={query} onChange={(event) => setQuery(event.target.value)} />{query ? <button className="search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button> : <kbd>/</kbd>}</div>
          <div className="sort-wrap"><ArrowDownUp size={15} /><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort books"><option value="recently-added">Recently added</option><option value="recommended">Recommended</option><option value="newest">Newest published</option><option value="oldest">Oldest published</option><option value="title">Title: A–Z</option></select><ChevronDown size={14} /></div>
          <div className="view-switch" aria-label="View options"><button aria-label="Grid view" aria-pressed={view === 'grid'} className={view === 'grid' ? 'selected' : ''} onClick={() => setView('grid')}><Grid2X2 size={17} /></button><button aria-label="List view" aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}><List size={19} /></button></div>
          <button className="mobile-filter-button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={18} />Filters</button>
        </div>
        <div className="automation-status" role="status"><span className={catalog.automation?.enabled ? 'status-dot' : 'status-dot inactive'} /><span>{catalog.automation?.enabled ? 'Automatic discovery is on · checks daily' : 'Daily automatic discovery · awaiting server setup'}</span><span className="automation-detail">{catalog.sync?.newBooks ? `${catalog.sync.newBooks} new books in the last check · ` : ''}This page checks for changes every 5 minutes.</span></div>
        <div className="library-layout">
          <aside className={`filters ${filtersOpen ? 'filters-open' : ''}`} aria-label="Filter library">
            <div className="filter-heading">BROWSE BY TOPIC<SlidersHorizontal size={13} /></div>
            <div className="topic-list"><button className={topic === 'All books' ? 'topic-button selected' : 'topic-button'} onClick={() => setTopic('All books')} aria-pressed={topic === 'All books'}><BookOpen size={17} /><span>All books</span><span className="topic-count">{catalog.books.length}</span></button>
            {topics.map(({ name, icon: Icon }) => <button key={name} className={topic === name ? 'topic-button selected' : 'topic-button'} onClick={() => setTopic(name)} aria-pressed={topic === name}><Icon size={17} strokeWidth={1.6} /><span>{name}</span><span className="topic-count">{counts[name] || 0}</span></button>)}</div>
            <div className="filter-divider" />
            <label className="filter-label" htmlFor="year-filter">PUBLICATION YEAR</label>
            <div className="filter-select"><select id="year-filter" value={year} onChange={(event) => setYear(event.target.value)}><option value="all">All years</option><option value="2020">2020 & later</option><option value="2010">2010–2019</option><option value="before2010">Before 2010</option></select><ChevronDown size={14} /></div>
            {activeFilters && <button className="clear-filters" onClick={clearFilters}><X size={13} />Clear filters</button>}
            <div className="sidebar-note"><span className="note-icon"><BookOpen size={20} strokeWidth={1.5} /></span><h3>Knowledge, connected.</h3><p>{catalog.archiveAvailable ? 'Book metadata from Anna’s Archive, brought together for your next big idea.' : 'Discover AI books with open bibliographic metadata. A starting point for your next big idea.'}</p><button onClick={() => setAbout(true)}>A note on our sources <ArrowUpRight size={13} /></button></div>
          </aside>
          <div className="results">
            <div className="results-meta"><span aria-live="polite">{savedOnly ? 'Your shelf' : topic === 'All books' ? 'A whole world of AI' : topic}<span className="results-separator">/</span><strong>{books.length} {books.length === 1 ? 'book' : 'books'}</strong></span><span className="metadata-label"><span className="small-status-dot" />{catalog.source === 'annas-archive' ? 'Anna’s Archive metadata' : catalog.source === 'mixed' ? 'Open metadata' : 'Open Library metadata'}</span></div>
            {activeFilters && <div className="active-filters">{query && <button onClick={() => setQuery('')}>“{query}”<X size={12} /></button>}{topic !== 'All books' && <button onClick={() => setTopic('All books')}>{topic}<X size={12} /></button>}{year !== 'all' && <button onClick={() => setYear('all')}>{year === '2020' ? '2020 & later' : year === '2010' ? '2010–2019' : 'Before 2010'}<X size={12} /></button>}</div>}
            {books.length ? <div className={`book-grid ${view === 'list' ? 'list-view' : ''}`}>
              {books.slice(0, limit).map((book, index) => <article className={`book-card palette-${index % 6}`} key={book.id}>
                <div className="cover-stage"><button className="cover-open" aria-label={`Read about ${book.title} by ${book.author}`} onClick={() => setSelected(book)}><Cover book={book} /></button><button className={`save-button ${saved.includes(book.id) ? 'is-saved' : ''}`} onClick={() => toggleSaved(book)} aria-label={`${saved.includes(book.id) ? 'Remove' : 'Save'} ${book.title}${saved.includes(book.id) ? ' from' : ' to'} reading list`} aria-pressed={saved.includes(book.id)}><Bookmark size={17} fill={saved.includes(book.id) ? 'currentColor' : 'none'} strokeWidth={1.7} /></button><span className="cover-open-hint">Take a closer look <ArrowUpRight size={13} /></span></div>
                <div className="book-info"><div className="book-category">{book.topics[0]}{isNewArrival(book) && <span className="new-arrival">New arrival</span>}</div><button className="book-title" onClick={() => setSelected(book)}>{book.title}</button><p className="book-author">{book.author}</p><p className="book-description">{book.description || emptyDescription}</p><div className="book-bottom"><span>{book.year || 'Year not listed'}<span className="book-meta-dot">·</span>{sourceName(book)}</span><button className="details-arrow" onClick={() => setSelected(book)} aria-label={`View details for ${book.title}`}><ArrowUpRight size={17} /></button></div></div>
              </article>)}
            </div> : <div className="empty-state">{savedOnly ? <Bookmark size={32} strokeWidth={1.2} /> : <Search size={32} strokeWidth={1.2} />}<h3>{savedOnly && !activeFilters ? 'Your next chapter starts with a bookmark.' : 'No books on this shelf. Yet.'}</h3><p>{savedOnly && !activeFilters ? 'Save the books that catch your eye. They’ll be waiting right here.' : 'Try a different author, idea, or a little less filtering.'}</p><button className="primary-button" onClick={() => { clearFilters(); if (savedOnly) setSavedOnly(false); }}>{savedOnly ? 'Explore the library' : 'Clear filters'}<ArrowRight size={16} /></button></div>}
            {!!books.length && <div className="load-more-area"><div className="progress-track"><span style={{ width: `${Math.min(limit / books.length, 1) * 100}%` }} /></div><p>You’ve explored {Math.min(limit, books.length)} of {books.length} books</p>{limit < books.length && <button className="load-more-button" onClick={() => setLimit((previous) => previous + PAGE_SIZE)}>A few more good reads<ArrowDown size={16} /></button>}{limit >= books.length && <span className="end-note">A good place to start. An even better place to return.</span>}</div>}
          </div>
        </div>
      </section>
      <section className="closing-note shell"><div className="closing-symbol"><Sprout size={29} strokeWidth={1.3} /></div><div><h2>Stay curious. Keep turning pages.</h2><p>The future is being written. Read a little closer.</p></div><button onClick={() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Back to the beginning <ArrowUpRight size={16} /></button></section>
    </main>
    <footer className="site-footer shell"><a className="brand footer-brand" href="#"><BookOpen size={18} /><span>AIUpdate<span className="brand-dot">.</span></span></a><p>An independent library for a world of intelligence.</p><div><span>Catalog checked {formatDate(catalog.updatedAt)}</span><button onClick={() => setAbout(true)} aria-label="About the catalog and data sources"><CircleHelp size={16} /></button></div></footer>

    <dialog ref={dialogRef} className="book-dialog" onCancel={() => setSelected(null)} onClick={(event) => { if (event.target === event.currentTarget) setSelected(null); }} onClose={() => setSelected(null)}>
      {selected && <><button className="dialog-close icon-button" onClick={() => setSelected(null)} aria-label="Close book details"><X size={20} /></button><div className="dialog-book-art"><Cover book={selected} /><span className="dialog-art-label">A LITTLE MORE UNDERSTANDING.</span></div><div className="dialog-book-copy"><div className="eyebrow">ON THE BOOKSHELF</div><h2>{selected.title}</h2><p className="dialog-author">by {selected.author}</p><div className="dialog-tags">{selected.topics.map((tag) => <button key={tag} onClick={() => { setTopic(tag); setSelected(null); setSavedOnly(false); document.getElementById('library')?.scrollIntoView({ behavior: 'smooth' }); }}>{tag}</button>)}</div><div className="book-facts"><span><strong>FIRST PUBLISHED</strong>{selected.year || 'Not listed'}</span><span><strong>METADATA SOURCE</strong>{sourceName(selected)}</span></div><h3>Between the covers</h3><p className="full-description">{selected.description || emptyDescription}</p><div className="dialog-actions"><a className="primary-button" href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">View original record <ExternalLink size={15} /></a><button className={`secondary-button ${saved.includes(selected.id) ? 'saved' : ''}`} onClick={() => toggleSaved(selected)}>{saved.includes(selected.id) ? <Check size={16} /> : <Bookmark size={16} />}{saved.includes(selected.id) ? 'Saved to your list' : 'Save for later'}</button></div><p className="source-footnote">Bibliographic metadata only. Book access is managed by the source website.</p></div></>}
    </dialog>
    <dialog ref={aboutRef} className="about-dialog" onCancel={() => setAbout(false)} onClose={() => setAbout(false)} onClick={(event) => { if (event.target === event.currentTarget) setAbout(false); }}><button className="dialog-close icon-button" onClick={() => setAbout(false)} aria-label="Close about"><X size={20} /></button><span className="about-icon"><BookOpen size={27} /></span><div className="eyebrow">A NOTE FROM THE READING ROOM</div><h2>Good books.<br />Open knowledge.</h2><p>AIUpdate is a small, independent discovery space for books about artificial intelligence. One page, a little less noise, and plenty to think about.</p><h3>Where the books come from</h3><p>Our parser looks for <strong>Artificial Intelligence</strong>, <strong>Artificial-Intelligence</strong>, or the whole word <strong>AI</strong> in book titles and descriptions. Records are deduplicated by title and author.</p><div className="source-status"><Globe2 size={19} /><div><strong>{catalog.archiveAvailable ? 'Anna’s Archive is connected' : 'Currently using Open Library'}</strong><p>{catalog.note}</p></div></div><h3>A growing library</h3><p>{catalog.automation?.enabled ? `Automatic checks run ${catalog.automation.schedule.toLowerCase()}.` : 'Daily automatic discovery becomes active when the deployed server and persistent storage are configured.'} Each check adds newly discovered books, keeps earlier entries, and continues through older results. This page checks for saved changes every five minutes and when you return to it. New arrivals appear first and carry a label for seven days.</p><p>Discovery depends on the sources indexing a book and allowing access. It cannot guarantee every new AI publication or immediate updates. Topics are inferred from metadata; years refer to first publication when available.</p>{catalog.sync?.lastError && <p className="sync-warning">Latest source note: {catalog.sync.lastError}</p>}<p className="about-small">Last successful check {formatDate(catalog.updatedAt)} · Saved books stay in this browser.</p><div className="about-links"><a href="https://annas-archive.gl/datasets" target="_blank" rel="noopener noreferrer">Anna’s Archive datasets<ArrowUpRight size={14} /></a><a href="https://openlibrary.org" target="_blank" rel="noopener noreferrer">Open Library<ArrowUpRight size={14} /></a></div></dialog>
    <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite"><Check size={16} /><span>{toast}</span><button onClick={() => setToast('')} aria-label="Dismiss notification"><X size={14} /></button></div>
  </>;
}

function ArrowDownRight() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 5l14 14m0-11v11H8" stroke="currentColor" strokeWidth="1.5" /></svg>; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
