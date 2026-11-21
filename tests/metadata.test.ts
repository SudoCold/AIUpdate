import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deduplicate, isAIRecord, parseArchiveDetail, parseArchiveSearch, safeUrl } from '../lib/metadata';
import type { Catalog } from '../lib/types';
import snapshot from '../src/data/catalog.json';

test('matches requested title and description keywords without matching substrings', () => {
  for (const title of ['Artificial Intelligence', 'artificial-intelligence basics', 'AI for everyone', 'Artificial‑Intelligence']) assert.equal(isAIRecord(title), true, title);
  assert.equal(isAIRecord('The future', 'An introduction to artificial intelligence.'), true);
  for (const title of ['Railway design', 'Email systems', 'Raising children']) assert.equal(isAIRecord(title), false, title);
});

test('parses original archive rows, including results inside HTML comments', () => {
  const row = (id: string, title: string, author: string) => `<a href="/md5/${id}"><div><img src="/covers/${id}.jpg"><div>English [en], PDF, 2021</div><h3>${title}</h3><div class="italic">${author}</div></div></a>`;
  const html = row('abc', 'AI for everyone', 'First Author') + `<!--${row('def', 'Artificial-Intelligence', 'Second Author')}-->` + row('ghi', 'Railway construction', 'Other Author');
  const books = parseArchiveSearch(html, 'https://annas-archive.gl');
  assert.equal(books.length, 2);
  assert.equal(books[0].author, 'First Author');
  assert.equal(books[1].author, 'Second Author');
  assert.equal(books[0].year, 2021);
  assert.equal(books[0].language, 'English');
  assert.equal(books[0].cover, 'https://annas-archive.gl/covers/abc.jpg');
});

test('parses separate title, author, and description links without retaining source scripts', () => {
  const books = parseArchiveSearch(`<div class="flex"><img src="https://covers.example/book.jpg"><div><a class="js-vim-focus" href="/book/future">The future</a><a href="/search?q=Author">An Author</a><div class="text-gray-600">A guide to AI. <script>malicious()</script></div><div>English [en] · 2024</div></div></div>`, 'https://annas-archive.gl');
  assert.equal(books.length, 1);
  assert.equal(books[0].description, 'A guide to AI.');
  assert.equal(books[0].author, 'An Author');
});

test('rejects executable and off-origin record URLs', () => {
  assert.equal(safeUrl('javascript:alert(1)', 'https://annas-archive.gl'), null);
  assert.equal(safeUrl('http://example.com', 'https://annas-archive.gl'), null);
  const books = parseArchiveSearch('<a href="https://other.example/md5/abc"><h3>Artificial Intelligence</h3></a>', 'https://annas-archive.gl');
  assert.equal(books.length, 0);
});

test('extracts the description without mixing in alternative filenames', () => {
  const details = parseArchiveDetail('<div class="js-md5-top-box-description"><div>description</div><div class="mb-1">An AI handbook.</div><div>alternative filename</div><div class="mb-1">file.pdf</div></div>');
  assert.equal(details.description, 'An AI handbook.');
});

test('the bundled catalog contains real matching unique bibliographic records', () => {
  const catalog = snapshot as Catalog;
  assert.ok(catalog.books.length >= 20);
  assert.ok(Number.isFinite(Date.parse(catalog.updatedAt)));
  assert.equal(deduplicate(catalog.books).length, catalog.books.length);
  for (const book of catalog.books) {
    assert.equal(isAIRecord(book.title, book.description), true, book.title);
    assert.ok(book.sourceUrl.startsWith('https://'));
    assert.ok(book.topics.length);
  }
});
