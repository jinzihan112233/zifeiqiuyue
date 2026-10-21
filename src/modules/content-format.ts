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
  for (const date of [input.originalVideoDate, input.legacyDate]) {
    if (typeof date !== 'string' || date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) throw new APIError('日期必须是有效的 YYYY-MM-DD。', 400);
  }
  return { category: input.category, demo: input.demo, sourceUrl: webURL(input.sourceUrl), originalVideoDate: input.originalVideoDate, legacyDate: input.legacyDate };
}
const sections = ['开头', '简介', '正文', '后记'];
export function articleFormat(markdown: string) {
  const md = new MarkdownIt({ html: false });
  const tokens = md.parse(markdown, {});
  const headings = tokens.flatMap((token, i) => token.type === 'heading_open' && token.tag === 'h2' ? [{ title: tokens[i + 1].content, start: token.map![0], end: token.map![1], index: i }] : []);
  const issues: string[] = [];
  if (tokens.some(t => t.type === 'heading_open' && t.tag === 'h2' && t.level !== 0)) issues.push('四段章节须为顶层标题，不能嵌入引用或列表。');
  if (tokens.some(t => t.type === 'heading_open' && t.tag === 'h1')) issues.push('章节内部请使用三级或更低级标题，文章标题由元数据提供。');
  if (headings.map(h => h.title).join('|') !== sections.join('|')) issues.push('站方文章须依次且各一次包含：## 开头、## 简介、## 正文、## 后记。');
  const lines = markdown.split('\n');
  if (headings[0] && lines.slice(0, headings[0].start).join('\n').trim()) issues.push('开头章节之前不能有正文。');
  for (let i = 0; i < headings.length; i++) if (!lines.slice(headings[i].end, headings[i + 1]?.start).join('\n').trim()) issues.push(`${headings[i].title}章节不能为空。`);
  const intro = headings.find(h => h.title === '简介');
  const end = intro ? headings[headings.indexOf(intro) + 1]?.start : undefined;
  const introMarkdown = intro ? lines.slice(intro.end, end).join('\n') : '';
  const summary = md.parse(introMarkdown, {}).flatMap(t => t.children || []).filter(t => ['text', 'code_inline', 'softbreak', 'hardbreak'].includes(t.type)).map(t => t.type.endsWith('break') ? ' ' : t.content).join(' ').replace(/\s+/g, ' ').trim();
  if (intro && !summary) issues.push('简介须包含可生成摘要的文字。');
  return { issues, summary };
}
export function requireArticle(markdown: string) {
  const result = articleFormat(markdown);
  if (result.issues.length) throw new APIError(result.issues.join(' '), 400);
  return result.summary;
}
