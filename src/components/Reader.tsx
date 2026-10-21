'use client';
import { useEffect, useRef, useState } from 'react';
import { ArticleDate } from './ArticleDate';

type Annotation = { id: number; start: number; end: number; quote: string; body: string };
type ReaderData = { content: { currentSnapshot: number; visibility: string }; snapshot: { id: number; title: string; html: string; plainText: string; publishedAt: string; metadata?: { demo?: boolean; sourceUrl?: string; originalVideoDate?: string } }; annotations: Annotation[] };
function highlight(root: HTMLElement, start: number, end: number) {
  root.querySelectorAll('mark').forEach(mark => mark.replaceWith(...mark.childNodes)); root.normalize();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const pieces: { node: Text; from: number; to: number }[] = [];
  let offset = 0, node: Node | null;
  while ((node = walker.nextNode())) { const length = Array.from(node.textContent || '').length; if (offset < end && offset + length > start) pieces.push({ node: node as Text, from: Math.max(0, start - offset), to: Math.min(length, end - offset) }); offset += length; }
  for (const piece of pieces) { const chars = Array.from(piece.node.data); const mark = document.createElement('mark'); mark.textContent = chars.slice(piece.from, piece.to).join(''); piece.node.replaceWith(document.createTextNode(chars.slice(0, piece.from).join('')), mark, document.createTextNode(chars.slice(piece.to).join(''))); }
  root.querySelector('mark')?.scrollIntoView({ block: 'center', behavior: 'auto' });
}
export function Reader({ contentId, initialData, articleSlug, version, kind = 'article' }: { contentId: string; initialData?: ReaderData; articleSlug?: string; version?: string; kind?: 'article' | 'post' }) {
  const [data, setData] = useState<ReaderData | null>(initialData || null), [error, setError] = useState(''), [body, setBody] = useState(''), [selection, setSelection] = useState<{ start: number; end: number; quote: string } | null>(null), [busy, setBusy] = useState(false);
  const article = useRef<HTMLElement>(null);
  const [signedIn, setSignedIn] = useState(false);
  const basePath = kind === 'post' ? '/posts' : '/articles';
  const currentHref = articleSlug ? `${basePath}/${articleSlug}` : `/lab/read/${contentId}`;
  const loginHref = `/login?returnTo=${encodeURIComponent(currentHref + (version ? `?version=${encodeURIComponent(version)}` : ''))}`;
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
  function pickSelection() {
    const selected = window.getSelection(); if (!selected?.rangeCount || !article.current) return;
    const range = selected.getRangeAt(0); if (!article.current.contains(range.startContainer) || !article.current.contains(range.endContainer) || range.collapsed) { setError('请先在正文内选择一段文字，再点击批注按钮。'); return; }
    const prefix = range.cloneRange(); prefix.selectNodeContents(article.current); prefix.setEnd(range.startContainer, range.startOffset);
    const start = Array.from(prefix.toString()).length, quote = range.toString(); if (!quote.trim()) { setError('请选择包含实际文字的段落，不能只选择空白。'); return; } setSelection({ start, end: start + Array.from(quote).length, quote }); setError('');
  }
  return <><p className="reader-back"><a href={articleSlug ? kind === "post" ? "/community" : "/articles" : "/workspace"}>← {articleSlug ? kind === "post" ? "返回社区来信" : "返回全部文章" : "返回内容工作台"}</a></p>{error && <p role="alert" className="error">{error}</p>}{data && <>
    <header className="reader-heading"><span className="section-kicker">{data.snapshot.metadata && 'category' in data.snapshot.metadata ? String(data.snapshot.metadata.category || '站方文章') : '站内内容'}</span><h1 className="reader-title">{data.snapshot.title}</h1><p className="reader-date"><ArticleDate metadata={kind === "post" ? { demo: data.snapshot.metadata?.demo } : data.snapshot.metadata || {}} publishedAt={data.snapshot.publishedAt} /></p><p className="demo-note">{data.snapshot.metadata?.demo !== false && '演示内容，并非子非秋月原话。'}{data.content.currentSnapshot !== data.snapshot.id && <> 正在阅读历史版本。<a href={currentHref}>查看当前版本</a></>}</p>{data.snapshot.metadata?.sourceUrl && <a className="reader-source" href={data.snapshot.metadata.sourceUrl} target="_blank" rel="noopener noreferrer">查看原文来源 ↗</a>}</header>
    <div className={articleSlug ? "reading-grid" : "reader-grid"}><section><article ref={article} className={articleSlug ? "reader-body" : "prose"} dangerouslySetInnerHTML={{ __html: data.snapshot.html }} /><div className="annotation-actions">{signedIn ? <button type="button" onClick={pickSelection}>为选中文字写批注</button> : <a href={loginHref}>登录后为文字写批注</a>}</div><p className="muted">请先选择正文文字。也可以从旁边已有批注定位原文。</p>{selection && <form className="paper" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { const response = await fetch('/api/community/annotation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot: data.snapshot.id, ...selection, body }) }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setBody(''); setSelection(null); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : '批注失败。'); } finally { setBusy(false); } }}><blockquote>{selection.quote}</blockquote><label>批注内容<textarea value={body} onChange={e => setBody(e.target.value)} required maxLength={5000} /></label><button disabled={busy}>{busy ? '正在保存…' : '发布批注'}</button></form>}</section>
    <aside className="marginalia"><h2>页边批注</h2>{!data.annotations.length && <p className="muted">这个版本还没有批注。</p>}{data.annotations.map(note => <section key={note.id} className="note"><blockquote>{note.quote}</blockquote><p>{note.body}</p><button className="quiet" onClick={() => { if (article.current?.textContent !== data.snapshot.plainText) { setError('本页文字与原版本不一致，保留引用但不猜测定位。'); return; } highlight(article.current!, note.start, note.end); }}>定位原文</button></section>)}</aside></div>
  </>}</>;
}
