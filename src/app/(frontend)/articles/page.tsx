import { APIError, getPayload } from 'payload';
import { notFound } from 'next/navigation';
import config from '@payload-config';
import { pageNumber, publicArchive } from '@/modules/public-reading';
import { ArticleDate } from '@/components/ArticleDate';
export const dynamic = 'force-dynamic';
export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  let page;
  try { page = pageNumber((await searchParams).page); } catch { notFound(); }
  return { title: page === 1 ? '全部文章' : `全部文章 · 第 ${page} 页`, description: '公开站方文章目录。优先按已核验视频日期排序，无视频日期时按本站发布日期排序。', alternates: { canonical: page === 1 ? '/articles' : `/articles?page=${page}` } };
}
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  let archive;
  try { archive = await publicArchive(await getPayload({ config }), (await searchParams).page); }
  catch (error) { if (error instanceof APIError && [400, 404].includes(error.status)) notFound(); throw error; }
  return <div className="shell page-shell"><header className="page-heading"><span className="section-kicker">篇章有序</span><h1>全部文章</h1><p>一篇文字，一段相逢。按已核验视频日期由近到远排列；尚无视频日期时，以本站发布日期为准。</p></header>
    <p className="demo-note">演示内容另行标注，不作为作者原话。共 {archive.total} 篇公开文章。</p>
    {archive.items.length ? <section className="archive-list" aria-label="文章列表">{archive.items.map(item => <a key={item.stableId} href={`/articles/${item.slug}`} className="archive-item"><div className="archive-content"><span className="article-label">{item.metadata.category || '站方文章'}</span><h2>{item.title}</h2>{item.summary && <p className="archive-description">{item.summary}</p>}</div><span className="archive-date"><ArticleDate metadata={item.metadata} publishedAt={item.publishedAt} /></span><span className="archive-arrow" aria-hidden="true">↗</span></a>)}</section> : <p className="empty-state">尚无公开文章，篇章正在整理中。<br /><a href="/">返回首页</a></p>}
    {archive.pages > 1 && <nav className="pagination" aria-label="文章分页">{archive.page > 1 && <a rel="prev" href={`/articles?page=${archive.page - 1}`}>← 上一页</a>}<span aria-current="page">第 {archive.page} / {archive.pages} 页</span>{archive.page < archive.pages && <a rel="next" href={`/articles?page=${archive.page + 1}`}>下一页 →</a>}</nav>}
  </div>;
}
