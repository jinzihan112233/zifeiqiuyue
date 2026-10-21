import { cache } from 'react';
import { APIError, getPayload } from 'payload';
import { notFound } from 'next/navigation';
import config from '@payload-config';
import { publicArticle } from '@/modules/public-reading';
import { Reader } from '@/components/Reader';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ version?: string | string[] }> };
const read = cache(async (slug: string, version?: string | string[]) => { try { return await publicArticle(await getPayload({ config }), slug, version, 'post'); } catch (error) { if (error instanceof APIError && error.status === 404) notFound(); throw error; } });
export async function generateMetadata({ params, searchParams }: Props) { const { slug } = await params, { version } = await searchParams; const data = await read(slug, version); return { title: data.snapshot.title, alternates: { canonical: `/posts/${slug}` }, ...(version ? { robots: { index: false, follow: true } } : {}) }; }
export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params, { version } = await searchParams, data = await read(slug, version);
  return <div className="shell article-page"><Reader key={data.snapshot.stableId} contentId={String(data.content.id)} initialData={data} articleSlug={slug} kind="post" version={typeof version === 'string' ? version : undefined} /><details className="version-menu"><summary>发布版本（{data.versions.length}）</summary><ul>{data.versions.map(item => <li key={item.stableId}><a href={`/posts/${slug}?version=${encodeURIComponent(item.stableId)}`}><time dateTime={item.publishedAt}>{new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.publishedAt))}</time></a></li>)}</ul></details></div>;
}
