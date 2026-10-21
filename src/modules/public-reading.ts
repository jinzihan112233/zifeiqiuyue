import { APIError, type Payload } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { metadata, type Metadata } from './content-format';
import { annotationList, type AnnotationItem } from './annotations';

export type ArticleCard = { stableId: string; slug: string; title: string; summary: string; metadata: Metadata; publishedAt: string };
export type PublicArticle = {
  content: { id: number; slug: string; kind: 'article' | 'post'; discussion: 'open' | 'locked'; currentSnapshot: number; visibility: string };
  snapshot: { id: number; stableId: string; title: string; summary: string; html: string; plainText: string; rendererVersion: string; publishedAt: string; metadata: Metadata };
  annotations: AnnotationItem[];
  annotationPagination: { page: number; pages: number; total: number };
  versions: { stableId: string; publishedAt: string; annotations: number }[];
};
type Row = Record<string, any>;
async function query(payload: Payload, statement: ReturnType<typeof sql>): Promise<Row[]> {
  // Fixed SQL targets the pinned community schema; filters are repeated at each public read boundary.
  const db = payload.db as typeof payload.db & { drizzle: { execute: (s: ReturnType<typeof sql>) => Promise<{ rows: Row[] }> } };
  return (await db.drizzle.execute(statement)).rows;
}
const columns = sql`c.stable_id AS "stableId", c.slug, s.title, s.summary, s.metadata, s.published_at AS "publishedAt"`;
const publicArticleWhere = sql`c.kind = 'article' AND c.visibility = 'public'`;
const card = (r: Row): ArticleCard => ({ stableId: r.stableId, slug: r.slug, title: r.title, summary: r.summary || '', metadata: metadata(r.metadata), publishedAt: new Date(r.publishedAt).toISOString() });
export function pageNumber(value: unknown) {
  if (value === undefined || value === null) return 1;
  if (typeof value !== 'string' || !/^[1-9]\d{0,7}$/.test(value)) throw new APIError('页码无效。', 400);
  return Number(value);
}
export async function publicArchive(payload: Payload, value?: unknown, kind: 'article' | 'post' = 'article') {
  const page = pageNumber(value), limit = 12;
  const where = sql`c.kind = ${kind} AND c.visibility = 'public'`;
  const order = kind === 'post' ? sql`s.published_at DESC` : sql`COALESCE(NULLIF(s.metadata->>'originalVideoDate', ''), to_char(s.published_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')) DESC`;
  const [count] = await query(payload, sql`SELECT count(*)::int AS total FROM community.contents c JOIN community.snapshots s ON s.id = c.current_snapshot_id AND s.content_id = c.id WHERE ${where}`);
  const total = Number(count.total), pages = Math.max(1, Math.ceil(total / limit));
  if (page > pages) throw new APIError('该页不存在。', 404);
  const rows = await query(payload, sql`SELECT ${columns} FROM community.contents c JOIN community.snapshots s ON s.id = c.current_snapshot_id AND s.content_id = c.id WHERE ${where}
    ORDER BY ${order}, c.stable_id ASC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  return { items: rows.map(card), page, pages, total };
}
export async function readHome(payload: Payload) {
  const [home] = await query(payload, sql`SELECT id, introduction FROM community.home WHERE key = 'home' LIMIT 1`);
  const featured = await query(payload, sql`SELECT ${columns} FROM community.contents c JOIN community.snapshots s ON s.id = c.current_snapshot_id AND s.content_id = c.id
    WHERE ${publicArticleWhere} ORDER BY s.published_at DESC, c.stable_id ASC LIMIT 4`);
  const quotes = await query(payload, sql`SELECT q.stable_id AS "stableId", q.text, q.attribution, q.source_url AS "sourceUrl", q.demo,
    c.slug, c.kind, s.stable_id AS "snapshotStableId"
    FROM community.quotes q LEFT JOIN community.contents c ON c.id = q.content_id LEFT JOIN community.snapshots s ON s.id = q.snapshot_id AND s.content_id = c.id
    WHERE q.enabled = true AND (q.content_id IS NULL OR (c.visibility = 'public' AND s.id IS NOT NULL)) ORDER BY q."order" ASC, q.stable_id ASC LIMIT 100`);
  return {
    introduction: home?.introduction || '为你讲述打动人心的故事，每个人物，都可以成为主角。',
    featured: featured.map(card),
    quotes: quotes.map(q => ({ stableId: q.stableId, text: q.text, attribution: q.attribution, sourceUrl: q.sourceUrl || '', demo: q.demo,
      href: q.slug ? `/${q.kind === 'article' ? 'articles' : 'posts'}/${encodeURIComponent(q.slug)}?version=${encodeURIComponent(q.snapshotStableId)}` : q.sourceUrl || null })),
  };
}
export async function publicArticle(payload: Payload, slug: unknown, version?: unknown, kind: 'article' | 'post' = 'article'): Promise<PublicArticle> {
  const where = sql`c.kind = ${kind} AND c.visibility = 'public'`;
  if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || version !== undefined && (typeof version !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(version))) throw new APIError('文章不可用。', 404);
  const versionWhere = version ? sql`s.stable_id = ${version}` : sql`s.id = c.current_snapshot_id`;
  const [row] = await query(payload, sql`SELECT c.id AS "contentId", c.slug, c.discussion, c.current_snapshot_id AS "currentSnapshot", s.id, s.stable_id AS "stableId", s.title, s.summary, s.html, s.plain_text AS "plainText", s.renderer_version AS "rendererVersion", s.metadata, s.published_at AS "publishedAt"
    FROM community.contents c JOIN community.snapshots s ON s.content_id = c.id WHERE ${where} AND c.slug = ${slug} AND ${versionWhere} LIMIT 1`);
  if (!row) throw new APIError('文章或版本不可用。', 404);
  const annotations = await annotationList(payload, Number(row.contentId), Number(row.id));
  const versions = await query(payload, sql`SELECT s.stable_id AS "stableId", s.published_at AS "publishedAt", (SELECT count(*)::int FROM community.annotations a JOIN community.comments m ON m.id=a.comment_id AND m.content_id=c.id WHERE a.snapshot_id=s.id AND a.content_id=c.id AND m.deleted=false AND m.moderation='visible') AS annotations FROM community.snapshots s JOIN community.contents c ON c.id = s.content_id WHERE ${where} AND c.id = ${Number(row.contentId)} ORDER BY s.published_at DESC, s.stable_id ASC`);
  return { content: { id: Number(row.contentId), slug: row.slug, kind, discussion: row.discussion, currentSnapshot: Number(row.currentSnapshot), visibility: 'public' },
    snapshot: { id: Number(row.id), stableId: row.stableId, title: row.title, summary: row.summary || '', html: row.html, plainText: row.plainText, rendererVersion: row.rendererVersion, metadata: metadata(row.metadata), publishedAt: new Date(row.publishedAt).toISOString() },
    annotations: annotations.items, annotationPagination: { page: 1, pages: annotations.pages, total: annotations.total },
    versions: versions.map(v => ({ stableId: v.stableId, publishedAt: new Date(v.publishedAt).toISOString(), annotations: Number(v.annotations) })) };
}
