import MarkdownIt from 'markdown-it';
import { APIError } from 'payload';
import { defaultMetadata, type Metadata } from './content-types';
export { defaultMetadata, type Metadata } from './content-types';

export function webURL(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) throw new APIError('来源链接无效。', 400);
  if (!value) return '';
  try { if (['http:', 'https:'].includes(new URL(value).protocol)) return value; } catch {}
  throw new APIError('来源只允许 HTTP(S) 链接。', 400);
}

export function metadata(value: unknown, previous: unknown = defaultMetadata): Metadata {
  if (value === undefined) value = previous;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new APIError('文章元数据无效。', 400);
  const input = { ...defaultMetadata, ...value } as Metadata;
  if (typeof input.category !== 'string' || input.category.length > 100 || typeof input.demo !== 'boolean') throw new APIError('栏目或演示标识无效。', 400);
  if (typeof input.intro !== 'string' || input.intro.length > 1000) throw new APIError('文章简介最多 1000 字符。', 400);
  if (typeof input.afterword !== 'string' || input.afterword.length > 5000) throw new APIError('文章后记最多 5000 字符。', 400);
  for (const date of [input.originalVideoDate, input.legacyDate]) {
    if (typeof date !== 'string' || date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new APIError('日期必须是有效的 YYYY-MM-DD。', 400);
  }
  return { category: input.category, demo: input.demo, sourceUrl: webURL(input.sourceUrl), originalVideoDate: input.originalVideoDate, legacyDate: input.legacyDate, intro: input.intro, afterword: input.afterword };
}

// Existing four-section publications retain their legacy summary; new articles have no fixed chapter headings.
export function articleFormat(markdown: string, intro = '') {
  const issues: string[] = [];
  if (typeof markdown !== 'string' || !markdown.trim()) issues.push('文章正文不能为空。');
  const legacy = !intro.trim() ? /(?:^|\n)## 开头\s*\n[\s\S]*?\n## 简介\s*\n([\s\S]*?)\n## 正文\s*\n[\s\S]*?\n## 后记(?:\s*\n|$)/.exec(markdown) : null;
  const source = intro.trim() || legacy?.[1] || '';
  const tokens = new MarkdownIt({ html: false }).parse(source, {});
  const summary = tokens.flatMap(t => t.children || []).filter(t => ['text', 'code_inline', 'softbreak', 'hardbreak'].includes(t.type)).map(t => t.type.endsWith('break') ? ' ' : t.content).join(' ').replace(/\s+/g, ' ').trim();
  return { issues, summary };
}

export function requireArticle(markdown: string, intro = '') {
  const result = articleFormat(markdown, intro);
  if (result.issues.length) throw new APIError(result.issues.join(' '), 400);
  return result.summary;
}
