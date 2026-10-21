import { APIError, getPayload } from 'payload';
import { notFound } from 'next/navigation';
import config from '@payload-config';
import { publicArchive } from '@/modules/public-reading';
export const dynamic = 'force-dynamic';
export const metadata = { title: '社区来信', description: '读者写下的故事与思考。' };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  let result; try { result = await publicArchive(await getPayload({ config }), (await searchParams).page, 'post'); } catch (error) { if (error instanceof APIError && [400, 404].includes(error.status)) notFound(); throw error; }
  return <div className="shell page-shell"><header className="page-heading"><span className="section-kicker">纸短情长</span><h1>社区来信</h1><p>读者写下的故事与思考，按本站发布时间排列。</p><a href="/workspace">写一封来信 ↗</a></header><section className="archive-list" aria-label="帖子列表">{result.items.map(item => <a key={item.stableId} className="archive-item" href={`/posts/${item.slug}`}><div className="archive-content"><span className="article-label">社区帖子{item.metadata.demo !== false && ' · 演示'}</span><h2>{item.title}</h2></div><time className="archive-date" dateTime={item.publishedAt}>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium' }).format(new Date(item.publishedAt))} · 本站发布</time></a>)}</section>{!result.items.length && <p className="empty-state">还没有公开来信，期待第一段故事。</p>}<nav className="pagination" aria-label="帖子分页">{result.page > 1 && <a href={`/community?page=${result.page - 1}`}>← 上一页</a>}<span>第 {result.page}/{result.pages} 页 · 共 {result.total} 篇</span>{result.page < result.pages && <a href={`/community?page=${result.page + 1}`}>下一页 →</a>}</nav></div>;
}
