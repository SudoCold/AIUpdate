import { load } from 'cheerio';
import type { Book, Topic } from './types';

export const AI_PATTERN = /\bartificial[\s‐‑–—-]+intelligence\b|\bai\b/i;
export const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim();
export const isAIRecord = (title: string, description = '') => AI_PATTERN.test(`${title} ${description}`);

export function classify(title: string, description = '', subjects: string[] = []): Topic[] {
  const text = `${title} ${description} ${subjects.join(' ')}`.toLowerCase();
  const topics: Topic[] = [];
  if (/machine learning|statistical learning|pattern recognition|data mining/.test(text)) topics.push('Machine learning');
  if (/deep learning|neural network/.test(text)) topics.push('Deep learning');
  if (/generative|language model|\bllm\b|chatgpt|transformer/.test(text)) topics.push('Generative AI');
  if (/ethic|societ|humanity|human compatible|life 3|philosoph|superintelligence|future of|risk|resisting|scary smart/.test(text)) topics.push('Ethics & society');
  if (/appli|business|practical|python|medicine|legal|games|robot|prediction|analytics/.test(text)) topics.push('Applied AI');
  if (!topics.length || /introduction|fundamental|beginner|modern approach|basics|guide/.test(text)) topics.push('AI fundamentals');
  return [...new Set(topics)];
}

export function safeUrl(value: string | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function deduplicate(books: Book[]): Book[] {
  const result = new Map<string, Book>();
  for (const book of books) {
    const key = cleanText(`${book.title} ${book.author}`).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    const existing = result.get(key);
    if (!existing || book.description.length > existing.description.length) result.set(key, book);
  }
  return [...result.values()];
}

/** Only extracts bibliographic metadata. Source HTML is never sent to the UI. */
export function parseArchiveSearch(html: string, base: string): Book[] {
  // The original archive puts some of its search results inside HTML comments.
  const comments = [...html.matchAll(/<!--([\s\S]*?)-->/g)]
    .map((match) => match[1]).filter((comment) => /href=["'][^"']*\/(?:md5|book)\//.test(comment));
  const $ = load([html, ...comments].join('\n'));
  $('script, style, noscript').remove();
  const books: Book[] = [];
  $('a[href*="/md5/"], a[href*="/book/"]').each((_, element) => {
    const link = $(element);
    const title = cleanText(link.find('h3').first().text() || link.attr('title') || link.text());
    if (!title || title.length < 3 || /technical details|download|read more/i.test(title)) return;
    const url = safeUrl(link.attr('href'), base);
    if (!url || new URL(url).origin !== new URL(base).origin || !/^\/(?:md5|book)\//.test(new URL(url).pathname)) return;
    let row = link.find('img, h3').length ? link : link.parent();
    for (let level = 0; level < 5 && row.parent().length; level++) {
      if (row.find('img').length || row.text().includes('MB')) break;
      row = row.parent();
    }
    const text = cleanText(row.clone().find('div, p, h3, span').append(' ').end().text());
    const description = cleanText(row.find('[class*="text-gray-600"], .description, [data-description]').first().text());
    if (!isAIRecord(title, description)) return;
    const author = cleanText(row.find('a[href*="/search?q="], a[href*="/author/"], .author, .italic').first().text()) || 'Author not listed';
    const year = text.match(/\b((?:19|20)\d{2})\b/);
    const language = text.match(/([\p{L} ]+)\s*\[([a-z]{2,3})\]/u)?.[1]?.trim() || 'Not listed';
    books.push({
      id: `aa-${new URL(url).pathname.split('/').pop()}`, title, author, description,
      year: year ? Number(year[1]) : null,
      cover: safeUrl(row.find('img').first().attr('data-src') || row.find('img').first().attr('src'), base),
      sourceUrl: url, source: 'annas-archive', language, topics: classify(title, description),
    });
  });
  return deduplicate(books);
}

export function parseArchiveDetail(html: string): { description: string; cover: string | null } {
  const $ = load(html);
  $('script, style').remove();
  const section = $('.js-md5-top-box-description');
  const label = section.children().filter((_, element) => cleanText($(element).text()).toLowerCase() === 'description').first();
  const description = cleanText(label.next().text() || section.find('.mb-1').first().text());
  const rawCover = $('meta[property="og:image"]').attr('content');
  return { description, cover: rawCover?.startsWith('https://') ? rawCover : null };
}
