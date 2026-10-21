'use client';
import { useEffect, useState } from 'react';
import { ArticleDate } from './ArticleDate';
import { Discussion } from './Discussion';
import { AnnotatedText, type ReaderData } from './AnnotatedText';

export function Reader({ contentId, initialData, articleSlug, version, kind = 'article' }: { contentId: string; initialData?: ReaderData; articleSlug?: string; version?: string; kind?: 'article' | 'post' }) {
  const [data, setData] = useState<ReaderData | null>(initialData || null), [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const basePath = (data?.content.kind || kind) === 'post' ? '/posts' : '/articles';
  const currentHref = data?.content.slug ? `${basePath}/${data.content.slug}` : articleSlug ? `${basePath}/${articleSlug}` : `/lab/read/${contentId}`;
  const readingVersion = data?.snapshot.stableId || version;
  const loginHref = `/login?returnTo=${encodeURIComponent(currentHref + (readingVersion ? `?version=${encodeURIComponent(readingVersion)}` : ''))}`;
  const refresh = async () => {
    const oldVersion = new URLSearchParams(location.search).get('snapshot');
    const url = articleSlug ? `/api/community/${kind === 'post' ? 'public-post' : 'public-article'}?slug=${encodeURIComponent(articleSlug)}${version ? `&version=${encodeURIComponent(version)}` : ''}` : `/api/community/reader?content=${encodeURIComponent(contentId)}${oldVersion ? `&snapshot=${encodeURIComponent(oldVersion)}` : ''}`;
    const response = await fetch(url, { cache: 'no-store' }); const value = await response.json();
    if (!response.ok) throw new Error(value.error || '内容不可用。'); setData(value);
  };
  useEffect(() => {
    if (!initialData) refresh().catch(e => setError(e.message));
    fetch('/api/community/session', { cache: 'no-store' }).then(r => r.json()).then(value => setSignedIn(!!value.user)).catch(() => setSignedIn(false));
  }, [contentId, articleSlug, version]); // eslint-disable-line react-hooks/exhaustive-deps
  return <><p className="reader-back"><a href={articleSlug ? kind === "post" ? "/community" : "/articles" : "/workspace"}>← {articleSlug ? kind === "post" ? "返回社区来信" : "返回全部文章" : "返回发布文章"}</a></p>{error && <p role="alert" className="error">{error}</p>}{data && <>
    <header className="reader-heading"><span className="section-kicker">{data.snapshot.metadata && 'category' in data.snapshot.metadata ? String(data.snapshot.metadata.category || '站方文章') : '站内内容'}</span><h1 className="reader-title">{data.snapshot.title}</h1><p className="reader-date"><ArticleDate metadata={kind === "post" ? { demo: data.snapshot.metadata?.demo } : data.snapshot.metadata || {}} publishedAt={data.snapshot.publishedAt} /></p>{data.content.currentSnapshot !== data.snapshot.id && <p className="demo-note">正在阅读历史版本。<a href={currentHref}>查看当前版本</a></p>}{data.snapshot.metadata?.sourceUrl && <a className="reader-source" href={data.snapshot.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">查看原文来源 ↗</a>}</header>
    <AnnotatedText key={data.snapshot.stableId || data.snapshot.id} data={data} contentId={contentId} publicLayout={!!articleSlug} signedIn={signedIn} loginHref={loginHref} readingHref={currentHref} onUnavailable={() => { setData(null); setError('内容或版本已不可用，批注与引用停止显示。'); }} />
    <Discussion contentId={contentId} loginHref={loginHref} readingHref={currentHref} />
  </>}</>;
}
