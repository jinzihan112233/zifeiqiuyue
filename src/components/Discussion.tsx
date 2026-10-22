'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { contentAPI as api } from './content-client';
import { RootThread, type CommentResult, type DiscussionUser } from './RootThread';

export function Discussion({ contentId, loginHref, readingHref }: { contentId: string; loginHref: string; readingHref: string }) {
  const [user, setUser] = useState<DiscussionUser>(null);
  const [data, setData] = useState<CommentResult | null>(null);
  const [page, setPage] = useState(1), [pinnedRoot, setPinnedRoot] = useState<number | null>(null);
  const [body, setBody] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [reporting, setReporting] = useState(false), [reason, setReason] = useState('');
  const [manageReason, setManageReason] = useState('');
  const key = useRef(''), sending = useRef(false);

  async function load(nextPage = page) {
    const value: CommentResult = await api('discussion?content=' + contentId + '&page=' + nextPage);
    setData(value); setPage(nextPage);
  }
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const value = params.get('thread');
    if (value && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) setPinnedRoot(Number(value));
    api('session').then(result => setUser(result.user || null)).catch(() => setUser(null));
  }, []);
  useEffect(() => {
    let cancelled = false;
    setData(null); setError('');
    api('discussion?content=' + contentId + '&page=' + page)
      .then((value: CommentResult) => { if (!cancelled) setData(value); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [contentId, page]);

  async function run(task: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，请重试。'); }
    finally { sending.current = false; setBusy(false); }
  }
  function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      key.current ||= crypto.randomUUID();
      await api('comment', { content: Number(contentId), parent: null, body, requestKey: key.current });
      key.current = ''; setBody('');
      await load(1); setNotice('评论已发布。');
    });
  }
  return <section className="discussion discussion--threads" id="discussion" aria-labelledby="discussion-title">
    <div className="discussion-heading"><h2 id="discussion-title">读后回响</h2><button type="button" className="quiet" disabled={busy} onClick={() => void run(() => load())}>刷新评论</button></div>
    {data?.locked && <p role="status">讨论已锁定，仍可阅读已有评论。</p>}
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {user?.role === 'admin' && <details className="discussion-management">
      <summary>评论管理</summary>
      <label>管理理由<input value={manageReason} maxLength={1000} onChange={e => setManageReason(e.target.value)} /></label>
      <button type="button" disabled={busy || !manageReason.trim() || !data} onClick={() => void run(async () => {
        await api('moderate', { content: Number(contentId), action: data?.locked ? 'unlock' : 'lock', expected: data?.locked ? 'locked' : 'open', reason: manageReason });
        await load(); setManageReason('');
      })}>{data?.locked ? '解除锁定' : '锁定讨论'}</button>
      <a href="/workspace/discussions">举报处理队列</a>
    </details>}
    {pinnedRoot !== null && <div className="discussion-pinned"><h3>来自原链接的讨论</h3>
      <button type="button" onClick={() => setPinnedRoot(null)}>关闭引用</button>
      <RootThread key={'pinned-' + pinnedRoot} rootId={pinnedRoot} contentId={contentId} user={user} loginHref={loginHref} readingHref={readingHref} locked={data?.locked ?? false} initialExpanded />
    </div>}
    {data ? <div className="discussion-roots">
      {data.items.map(item => <RootThread key={item.id} root={item} contentId={contentId} user={user} loginHref={loginHref} readingHref={readingHref} locked={data.locked} />)}
      {!data.items.length && <p className="muted">还没有评论，欢迎留下第一段回响。</p>}
      {data.pages > 1 && <nav className="comment-replies-pagination" aria-label="主评论分页">
        <button disabled={busy || page <= 1} onClick={() => setPage(n => n - 1)}>上一页</button>
        <span>第 {page} / {data.pages} 页</span>
        <button disabled={busy || page >= data.pages} onClick={() => setPage(n => n + 1)}>下一页</button>
      </nav>}
    </div> : !error && <p role="status">正在读取评论…</p>}
    {user ? <form className="discussion-new-comment" onSubmit={publish}>
      <label>写下你的评论<textarea rows={4} maxLength={5000} required value={body} onChange={e => { setBody(e.target.value); key.current = ''; }} /></label>
      <div className="discussion-actions">
        <button disabled={busy || !data || data.locked || !body.trim()}>发布主评论</button>
        <button type="button" disabled={busy} onClick={() => { setReporting(true); setReason(''); }}>举报这篇内容</button>
      </div>
    </form> : <p><a href={loginHref}>登录后发表评论、回复或举报</a></p>}
    {reporting && <form className="comment-inline-composer" onSubmit={event => {
      event.preventDefault(); void run(async () => { await api('report', { content: Number(contentId), reason }); setReporting(false); setReason(''); setNotice('举报已提交。'); });
    }}><label>举报内容<textarea rows={3} maxLength={1000} required value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={busy}>提交</button><button type="button" onClick={() => setReporting(false)}>取消</button></form>}
  </section>;
}
