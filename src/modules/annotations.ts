import { APIError, type Payload } from 'payload';
import { sql } from '@payloadcms/db-postgres';
import { positiveId } from './community';
import { pageNumber } from './public-reading';

export type AnnotationItem = { id: number; comment: number; snapshot: number; version: string; start: number; end: number; quote: string; prefix: string; suffix: string; body: string; createdAt: string };
type Row = Record<string, any>;
const projection = (row: Row): AnnotationItem => ({ id: Number(row.id), comment: Number(row.comment_id), snapshot: Number(row.snapshot_id), version: row.version, start: Number(row.start), end: Number(row.end), quote: row.quote, prefix: row.prefix || '', suffix: row.suffix || '', body: row.body, createdAt: new Date(row.created_at).toISOString() });
async function query(payload: Payload, statement: ReturnType<typeof sql>): Promise<Row[]> {
  const db = payload.db as typeof payload.db & { drizzle: { execute: (s: ReturnType<typeof sql>) => Promise<{ rows: Row[] }> } };
  return (await db.drizzle.execute(statement)).rows;
}
const from = sql`FROM community.annotations a JOIN community.contents c ON c.id=a.content_id
  JOIN community.snapshots s ON s.id=a.snapshot_id AND s.content_id=c.id
  JOIN community.comments m ON m.id=a.comment_id AND m.content_id=c.id AND m.parent_id IS NULL
  WHERE c.visibility='public' AND m.deleted=false AND m.moderation='visible'`;
const columns = sql`a.*,m.body,s.stable_id AS version`;
export async function annotationList(payload: Payload, content: number, snapshot: number, pageValue?: unknown) {
  const page = pageNumber(pageValue), limit = 20;
  const [parent] = await query(payload, sql`SELECT s.id FROM community.snapshots s JOIN community.contents c ON c.id=s.content_id WHERE c.id=${content} AND s.id=${snapshot} AND c.visibility='public'`);
  if (!parent) throw new APIError('内容或版本不可用。', 404);
  const [count] = await query(payload, sql`SELECT count(*)::int AS total ${from} AND c.id=${content} AND s.id=${snapshot}`);
  const pages = Math.max(1, Math.ceil(count.total / limit));
  if (page > pages) throw new APIError('该页不存在。', 404);
  const rows = await query(payload, sql`SELECT ${columns} ${from} AND c.id=${content} AND s.id=${snapshot} ORDER BY a.created_at,a.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  return { items: rows.map(projection), page, pages, total: Number(count.total) };
}
export async function annotationDetail(payload: Payload, content: number, snapshot: number, idValue: unknown) {
  const id = positiveId(idValue);
  const [row] = await query(payload, sql`SELECT ${columns} ${from} AND c.id=${content} AND s.id=${snapshot} AND a.id=${id}`);
  if (!row) throw new APIError('批注不可用，可能已被删除或隐藏。', 404);
  return projection(row);
}
