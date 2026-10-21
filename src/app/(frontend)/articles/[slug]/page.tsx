import { cache } from 'react';
import { APIError, getPayload } from 'payload';
import { notFound } from 'next/navigation';
import config from '@payload-config';
import { publicArticle } from '@/modules/public-reading';
import { Reader } from '@/components/Reader';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ version?: string | string[] }> };
const getArticle = cache(async (slug: string, version?: string | string[]) => {
  try { return await publicArticle(await getPayload({ config }), slug, version); }
  catch (error) { if (error instanceof APIError && error.status === 404) notFound(); throw error; }
});
export async function generateMetadata({ params, searchParams }: Props) {
  const { slug } = await params, { version } = await searchParams;
  const data = await getArticle(slug, version);
  return { title: data.snapshot.title, description: `${data.snapshot.metadata.demo ? '演示文章，非作者原话。' : ''}${data.snapshot.summary || '子非秋月非官方阅读站收录文章，来源见正文。'}`.slice(0, 160), alternates: { canonical: `/articles/${slug}` }, ...(version ? { robots: { index: false, follow: true } } : {}) };
}
export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params, { version } = await searchParams;
  const data = await getArticle(slug, version);
  return <div className="shell article-page"><Reader key={data.snapshot.stableId} contentId={String(data.content.id)} initialData={data} articleSlug={slug} version={typeof version === 'string' ? version : undefined} />
    <details className="version-menu"><summary>发布版本（{data.versions.length}）</summary><ul>{data.versions.map(v => <li key={v.stableId}><a href={`/articles/${slug}?version=${encodeURIComponent(v.stableId)}`} aria-current={data.snapshot.stableId === v.stableId ? 'page' : undefined}><time dateTime={v.publishedAt}>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(new Date(v.publishedAt))}</time>（北京时间）{data.snapshot.stableId === v.stableId && ' · 正在阅读'}</a></li>)}</ul></details>
  </div>;
}
