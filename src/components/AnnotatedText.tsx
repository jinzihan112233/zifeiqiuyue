'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { annotationHref, annotationTextVersion, anchorRange, findQuoteRanges, rangeAnchor, type Anchor } from '../modules/annotation-text';
import type { AnnotationItem } from '../modules/annotations';
import type { PublicArticle } from '../modules/public-reading';

export type ReaderData = Pick<PublicArticle, 'content' | 'snapshot' | 'annotations'> & Partial<Pick<PublicArticle, 'annotationPagination' | 'versions'>>;
type SelectionAnchor = Anchor & { snapshot: number; rendererVersion: string };
async function read(action: string) {
  const response = await fetch(`/api/community/${action}`, { cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || '批注读取失败。'), { status: response.status });
  return value;
}
export function AnnotatedText({ data, contentId, publicLayout, signedIn, loginHref, readingHref, onUnavailable }: { data: ReaderData; contentId: string; publicLayout: boolean; signedIn: boolean; loginHref: string; readingHref: string; onUnavailable: () => void }) {
  const { snapshot } = data;
  const article = useRef<HTMLElement>(null), composer = useRef<HTMLTextAreaElement>(null), cleanHighlight = useRef<() => void>(() => {}), ignoreSelection = useRef(false), requestKey = useRef(''), sending = useRef(false), origin = useRef(0);
  const [items, setItems] = useState(data.annotations), [page, setPage] = useState(1), [pages, setPages] = useState(data.annotationPagination?.pages || 1);
  const [selection, setSelection] = useState<SelectionAnchor | null>(null), [candidate, setCandidate] = useState<Anchor | null>(null), [body, setBody] = useState('');
  const [active, setActive] = useState<AnnotationItem | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [search, setSearch] = useState(''), [searchPage, setSearchPage] = useState(1);
  const supported = snapshot.rendererVersion === annotationTextVersion, locked = data.content.discussion === 'locked';
  const matches = useMemo(() => { try { return search.trim() ? findQuoteRanges(snapshot.plainText, search, searchPage) : null; } catch { return null; } }, [snapshot.plainText, search, searchPage]);
  const query = `content=${contentId}&snapshot=${snapshot.id}`;
  const href = (note: AnnotationItem, target = 'body') => annotationHref(readingHref, note.version, note.id, note.comment, target);
  async function load(nextPage = page) {
    setLoading(true); setError('');
    try {
      let result;
      try { result = await read(`annotations?${query}&page=${nextPage}`); }
      catch (e) { if (nextPage > 1 && (e as { status: number }).status === 404) result = await read(`annotations?${query}&page=1`); else throw e; }
      setItems(result.items); setPage(result.page); setPages(result.pages);
      if (active) { try { setActive(await read(`annotation-detail?${query}&id=${active.id}`)); } catch { cleanHighlight.current(); setActive(null); } }
    } catch (e) {
      setItems([]); setActive(null); cleanHighlight.current(); setError((e as Error).message);
      if ((e as { status: number }).status === 404) onUnavailable();
    } finally { setLoading(false); }
  }
  function paint(note: AnnotationItem, scroll = true) {
    if (!article.current) return;
    const range = anchorRange(article.current, note, snapshot.plainText, snapshot.rendererVersion);
    cleanHighlight.current(); ignoreSelection.current = true;
    if (typeof Highlight !== 'undefined' && typeof CSS !== 'undefined' && CSS.highlights) {
      CSS.highlights.set('reader-active-annotation', new Highlight(range));
      cleanHighlight.current = () => CSS.highlights.delete('reader-active-annotation');
    } else {
      const selected = window.getSelection(); selected?.removeAllRanges(); selected?.addRange(range);
      cleanHighlight.current = () => selected?.removeAllRanges();
    }
    if (scroll) {
      origin.current = window.scrollY;
      const node = range.startContainer.nodeType === 1 ? range.startContainer as Element : range.startContainer.parentElement;
      node?.scrollIntoView({ block: 'center', behavior: 'auto' });
      article.current.focus({ preventScroll: true });
    }
  }
  async function locate(note: AnnotationItem, scroll = true) {
    setError(''); setCandidate(null);
    try {
      const fresh = await read(`annotation-detail?${query}&id=${note.id}`); setActive(fresh);
      try { paint(fresh, scroll); setNotice(`已定位批注 #${fresh.id}。`); }
      catch (e) { cleanHighlight.current(); setError((e as Error).message); }
    } catch (e) { cleanHighlight.current(); setActive(null); setItems(current => current.filter(item => item.id !== note.id)); setError((e as Error).message); }
  }
  useEffect(() => {
    let cancelled = false;
    const entryFocus = document.activeElement;
    const params = new URLSearchParams(location.search), id = params.get('annotation');
    if (id !== null) {
      if (params.getAll('annotation').length !== 1 || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) setError('批注链接无效。');
      else read(`annotation-detail?${query}&id=${id}`).then(note => {
        if (cancelled) return;
        if (params.getAll('thread').length > 1 || params.has('thread') && params.get('thread') !== String(note.comment)) throw new Error('批注与讨论目标不一致。');
        setActive(note);
        try { paint(note, location.hash !== '#discussion' && document.activeElement === entryFocus); } catch (e) { setError((e as Error).message); }
      }).catch(e => { if (!cancelled) setError(e.message); });
    }
    return () => { cancelled = true; cleanHighlight.current(); };
  }, [snapshot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let frame = 0;
    const capture = () => {
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => {
        if (ignoreSelection.current || selection || busy || !supported || !article.current) return;
        const selected = window.getSelection();
        if (!selected || selected.rangeCount !== 1 || selected.isCollapsed) return;
        try { setCandidate(rangeAnchor(article.current, selected.getRangeAt(0), snapshot.plainText, snapshot.rendererVersion)); }
        catch { setCandidate(null); }
      });
    };
    document.addEventListener('selectionchange', capture);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('selectionchange', capture); };
  }, [snapshot, selection, busy, supported]);
  useEffect(() => { if (selection) composer.current?.focus(); }, [selection]);
  useEffect(() => {
    if (!body) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.shiftKey && link && !link.download && link.target !== '_blank') {
        const target = new URL(link.href);
        if ((target.origin !== location.origin || target.pathname !== location.pathname || target.search !== location.search) && !window.confirm('批注文字尚未发布。请先下载保留，确定离开或切换版本吗？')) event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', leave); document.addEventListener('click', navigate);
    return () => { window.removeEventListener('beforeunload', leave); document.removeEventListener('click', navigate); };
  }, [body]);
  function choose(anchor: Anchor) {
    try {
      if (!article.current) return;
      anchorRange(article.current, anchor, snapshot.plainText, snapshot.rendererVersion);
      cleanHighlight.current(); setActive(null);
      origin.current = window.scrollY; requestKey.current = ''; setSelection({ ...anchor, snapshot: snapshot.id, rendererVersion: snapshot.rendererVersion }); setCandidate(null); setError('');
    } catch (e) { setError((e as Error).message); }
  }
  function pick() {
    try {
      const selected = window.getSelection();
      if (candidate) choose(candidate);
      else if (selected?.rangeCount === 1 && article.current) choose(rangeAnchor(article.current, selected.getRangeAt(0), snapshot.plainText, snapshot.rendererVersion));
      else throw new Error('请先选择正文文字，或使用原文引用查找。');
    } catch (e) { setError((e as Error).message); }
  }
  function backToReading() { window.scrollTo({ top: origin.current, behavior: 'auto' }); article.current?.focus({ preventScroll: true }); }
  function noteCard(note: AnnotationItem, separate = false) {
    return <section key={note.id} className={`note${active?.id === note.id ? ' active-note' : ''}`} id={`${separate ? 'selected' : 'note'}-annotation-${note.id}`} aria-label={`批注 #${note.id}`}>
      <p className="muted">批注 #{note.id}{separate && ' · 来自直接链接'}</p><blockquote>{note.quote}</blockquote><p>{note.body}</p>
      <div className="annotation-buttons"><button type="button" className="quiet" disabled={busy || loading} onClick={() => void locate(note)}>定位原文</button><a href={href(note, 'discussion')}>查看讨论</a></div>
      <a href={href(note)}>独立链接</a>
    </section>;
  }
  return <div className={publicLayout ? 'reading-grid' : 'reader-grid'}>
    <section>
      <article id="annotation-body" ref={article} tabIndex={0} aria-label="正文阅读区域" onPointerDown={() => { ignoreSelection.current = false; }} onKeyDown={() => { ignoreSelection.current = false; }} className={publicLayout ? 'reader-body' : 'prose'} dangerouslySetInnerHTML={{ __html: snapshot.html }} />
      <div className="annotation-actions">{signedIn ? <button type="button" disabled={!supported || locked || busy} onMouseDown={e => e.preventDefault()} onClick={pick}>为选中文字写批注</button> : <a href={loginHref}>登录后为文字写批注</a>}</div>
      {locked && <p role="status">讨论已锁定，不能新增批注。</p>}
      {!supported && <p role="status">此版本的定位规则暂不支持，仍可阅读正文、引用和评论。</p>}
      {signedIn && !locked && candidate && !selection && <button type="button" className="selection-offer" onMouseDown={e => e.preventDefault()} onClick={pick}>批注所选文字</button>}
      <p role="status">{busy ? '正在保存批注…' : notice}</p>{error && <p role="alert" className="error">{error}</p>}
      {signedIn && supported && <details className="quote-search"><summary>查找原文并批注</summary><label>查找原文（完全匹配）<textarea value={search} maxLength={5000} rows={2} onChange={e => { setSearch(e.target.value); setSearchPage(1); }} /></label>{matches && <><p>找到 {matches.total} 处，请选择引用位置。</p>{matches.items.map(anchor => <div className="quote-match" key={anchor.start}><p>{anchor.prefix}<strong>{anchor.quote}</strong>{anchor.suffix}</p><button type="button" disabled={busy || locked} onClick={() => choose(anchor)}>选择此处（位置 {anchor.start + 1}）</button></div>)}{matches.pages > 1 && <div className="annotation-buttons"><button type="button" disabled={searchPage === 1} onClick={() => setSearchPage(searchPage - 1)}>上一组匹配</button><span>{searchPage} / {matches.pages}</span><button type="button" disabled={searchPage === matches.pages} onClick={() => setSearchPage(searchPage + 1)}>下一组匹配</button></div>}</>}</details>}
      {selection && <form className="annotation-form" aria-busy={busy} onSubmit={async event => {
        event.preventDefault(); if (sending.current) return; sending.current = true; setBusy(true); setError('');
        try {
          if (selection.snapshot !== snapshot.id || selection.rendererVersion !== snapshot.rendererVersion) throw new Error('阅读版本已变化，请保留输入并重新选择原文。');
          requestKey.current ||= crypto.randomUUID();
          const response = await fetch('/api/community/annotation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...selection, body, requestKey: requestKey.current }) });
          const value = await response.json(); if (!response.ok) throw new Error(value.error || '批注保存失败。');
          requestKey.current = ''; setBody(''); setSelection(null); setNotice('批注已发布。');
          await load(1);
          try { const note = await read(`annotation-detail?${query}&id=${value.id}`); setActive(note); paint(note, false); } catch { setError('批注已发布，但读取或定位更新失败，请刷新批注。'); }
        } catch (e) { setError((e as Error).message); } finally { sending.current = false; setBusy(false); }
      }}><h3>为这段原文写批注</h3><blockquote>{selection.quote}</blockquote><label>批注内容<textarea ref={composer} value={body} maxLength={5000} required rows={5} onChange={e => { setBody(e.target.value); requestKey.current = ''; }} /></label><div className="annotation-buttons"><button disabled={busy || locked}>发布批注</button><button type="button" disabled={busy} onClick={() => { setSelection(null); setCandidate(null); backToReading(); }}>取消并保留草稿</button></div></form>}
      {body && !selection && <p role="status">上一份尚未发布的输入已保留。重新选择引用后可继续编辑。</p>}
      {body && <button type="button" className="quiet" onClick={() => {
        const file = new Blob([`发布版本：${snapshot.stableId}\n渲染规则：${snapshot.rendererVersion}\n原文引用：${selection?.quote || ''}\n\n批注正文：\n${body}`], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(file), link = document.createElement('a'); link.href = url; link.download = `annotation-draft-${snapshot.id}.txt`; link.click(); URL.revokeObjectURL(url);
      }}>下载未发布批注</button>}
      {active && <button type="button" className="quiet" onClick={backToReading}>返回刚才的阅读位置</button>}
    </section>
    <aside className="marginalia" aria-labelledby="annotations-heading"><h2 id="annotations-heading">页边批注</h2><button type="button" className="quiet" disabled={busy || loading} onClick={() => void load()}>刷新批注</button>
      {active && !items.some(note => note.id === active.id) && noteCard(active, true)}
      {items.map(note => noteCard(note))}{!items.length && <p className="muted">{loading ? '正在读取批注…' : '这个版本还没有可见批注。'}</p>}
      {pages > 1 && <nav className="annotation-buttons" aria-label="批注分页"><button type="button" disabled={busy || loading || page <= 1} onClick={() => void load(page - 1)}>上一页批注</button><span>第 {page} / {pages} 页</span><button type="button" disabled={busy || loading || page >= pages} onClick={() => void load(page + 1)}>下一页批注</button></nav>}
      {!!data.versions?.some(v => v.stableId !== snapshot.stableId && v.annotations > 0) && <details><summary>其他版本的批注</summary><ul>{data.versions.filter(v => v.stableId !== snapshot.stableId && v.annotations > 0).map(v => <li key={v.stableId}><a href={`${readingHref}?version=${encodeURIComponent(v.stableId)}#annotations-heading`}>{new Date(v.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · {v.annotations} 条可见批注</a></li>)}</ul></details>}
    </aside>
  </div>;
}
