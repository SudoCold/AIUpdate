import { test, expect } from '@playwright/test';
import snapshot from '../src/data/catalog.json' with { type: 'json' };
import type { Catalog } from '../lib/types';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/books', (route) => route.fulfill({ json: { ...snapshot,
    automation: { enabled: true, intervalHours: 24, schedule: 'Every 24 hours while the local server is running' } } }));
});

test('catalog search, filters, details, reading-list persistence, sorting and pagination work', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.book-card')).toHaveCount(12);
  await expect(page.getByRole('heading', { name: 'Big ideas. Better understanding.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/aiupdate-desktop.png', fullPage: true });
  const search = page.getByRole('textbox', { name: 'Search books, authors, or ideas' });
  await search.fill('Melanie Mitchell');
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.locator('.book-card .book-title').click();
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Artificial Intelligence', exact: true }) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'View original record' })).toHaveAttribute('href', /openlibrary.org\/works\//);
  await dialog.getByRole('button', { name: 'Save for later' }).click();
  await expect(dialog.getByRole('button', { name: 'Saved to your list' })).toBeVisible();
  await page.screenshot({ path: 'test-results/aiupdate-details.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: /^Reading list/ }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Your reading list' })).toBeVisible();
  await page.getByRole('button', { name: 'Remove Artificial Intelligence from reading list', exact: true }).click();
  await expect(page.getByText('Your next chapter starts with a bookmark.')).toBeVisible();
  await page.getByRole('button', { name: 'Explore the library', exact: true }).last().click();
  await page.getByRole('button', { name: /^Ethics & society/ }).click();
  await expect(page.locator('.book-card').first()).toBeVisible();
  const ethicsCount = await page.locator('.book-card').count();
  expect(ethicsCount).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sort books' }).selectOption('newest');
  const years = await page.locator('.book-bottom>span').allTextContents();
  const parsed = years.map((text) => Number(text.match(/\d{4}/)?.[0] || 0));
  expect(parsed).toEqual([...parsed].sort((a, b) => b - a));
  await page.getByRole('button', { name: 'A few more good reads' }).click();
  await expect(page.locator('.book-card')).toHaveCount(24);
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.locator('.book-grid')).toHaveClass(/list-view/);
  await search.fill('no-book-with-this-name-987');
  await expect(page.getByText('No books on this shelf. Yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByText('Currently using Open Library')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('mobile layout fits the viewport and exposes filtering and saved books', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.book-card')).toHaveCount(12);
  await expect(page.locator('.hero-book img').first()).toBeVisible();
  await expect(page.locator('.hero-book img').first()).toHaveJSProperty('complete', true);
  await page.screenshot({ path: 'test-results/aiupdate-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const headline = await page.locator('#hero-title').boundingBox();
  expect(headline!.x + headline!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByLabel('PUBLICATION YEAR')).toBeVisible();
  await page.getByLabel('PUBLICATION YEAR').selectOption('2020');
  const years = await page.locator('.book-bottom>span').allTextContents();
  expect(years.length).toBeGreaterThan(0);
  for (const text of years) expect(Number(text.match(/\d{4}/)?.[0])).toBeGreaterThanOrEqual(2020);
  await page.getByRole('button', { name: 'Reading list, 0 saved books' }).click();
  await expect(page.getByText('Your next chapter starts with a bookmark.')).toBeVisible();
});

test('an open page receives discoveries automatically, puts new books first, and retains saved books', async ({ page }) => {
  await page.clock.install();
  let latest = structuredClone(snapshot) as Catalog;
  latest.automation = { enabled: true, intervalHours: 24, schedule: 'Daily, around 9 AM Asia/Manila' };
  await page.route('**/api/books', (route) => route.fulfill({ json: latest }));
  await page.goto('/');
  await expect(page.getByText('Automatic discovery is on · checks daily')).toBeVisible();
  await page.locator('.book-card .save-button').first().click();
  const savedTitle = await page.locator('.book-card .book-title').first().textContent();
  latest.books.push({ ...latest.books[0], id: 'ol-new-test-book', title: 'AI from tomorrow', author: 'A New Author',
    discoveredAt: new Date().toISOString(), cover: null });
  latest.sync = { nextArchivePage: 2, nextOpenLibraryPage: 3, newBooks: 1 };
  await page.clock.fastForward(5 * 60_000);
  await expect(page.locator('.book-card .book-title').first()).toHaveText('AI from tomorrow');
  await expect(page.locator('.new-arrival')).toHaveText('New arrival');
  latest.books.push({ ...latest.books[0], id: 'ol-focus-test-book', title: 'AI when you return', author: 'Another Author',
    discoveredAt: new Date(Date.now() + 1000).toISOString(), cover: null });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.book-card .book-title').first()).toHaveText('AI when you return');
  await page.getByRole('navigation').getByRole('button', { name: /^Reading list/ }).click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await expect(page.locator('.book-card .book-title')).toHaveText(savedTitle!);
});
