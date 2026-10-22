'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { contentAPI as api } from './content-client';
import { annotationHref } from '../modules/annotation-text';
import { AnnotationQuote } from './AnnotationQuote';
import { UserTagName } from './UserTagName';
import type { UserTag } from '../modules/user-tags';

type Comment = { id: number; parent: number | null; root: number | null; nickname: string; tag: UserTag; body: string; html: string; deleted: boolean; hidden: boolean; revision: number; own: boolean; createdAt: string; editedAt: string | null; annotation: { id: number; version: string; quote: string } | null };
type Data = { items: Comment[]; thread: Comment | null; pages: number; locked: boolean };
type User = { id: number; role: string };
export function Discussion({ contentId, loginHref, readingHref }: { contentId: string; loginHref: string; readingHref: string }) {
  const [user, setUser] = useState<User | null>(null), [data, setData] = useState<Data | null>(null), [root, setRoot] = useState<number | undefined>(), [page, setPage] = useState(1);
  const [body, setBody] = useState(''), [editing, setEditing] = useState<Comment | null>(null), [reply, setReply] = useState<Comment | null>(null);
  const [reporting, setReporting] = useState<number | 'content' | null>(null), [reason, setReason] = useState(''), [adminReason, setAdminReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const key = useRef(''), text = useRef<HTMLTextAreaElement>(null), sending = useRef(false);
  async function load(selectedRoot = root, selectedPage = page) {
    const value = await api(`discussion?content=${contentId}&page=${selectedPage}${selectedRoot ? `&root=${selectedRoot}` : ''}`); setData(value);
  }
  useEffect(() => {
    const raw = new URLSearchParams(location.search).get('thread'); if (raw && /^[1-9]\d*$/.test(raw)) setRoot(Number(raw));
    api('session').then(value => setUser(value.user)).catch(() => setUser(null));
  }, []);
  useEffect(() => { let active = true; setData(null); setError(''); api(`discussion?content=${contentId}&page=${page}${root ? `&root=${root}` : ''}`).then(value => { if (active) setData(value); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [contentId, page, root]);
  async function run(task: () => Promise<void>) {
    if (sending.current) return; sending.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(); try { await load(); } catch { setData(null); setError('操作已完成，列表刷新失败；请点击重新读取。'); } }
    catch (e) { setError(e instanceof Error ? e.message : '操作未完成。'); }
    finally { sending.current = false; setBusy(false); }
  }
  function compose(note: Comment, edit: boolean) {
    setEditing(edit ? note : null); setReply(edit ? null : note); setBody(edit ? note.body : ''); key.current = ''; text.current?.focus();
  }
  function submit(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      if (editing) await api(`comment-edit/${editing.id}`, { body, revision: editing.revision });
      else { key.current ||= crypto.randomUUID(); await api('comment', { content: Number(contentId), parent: reply?.id || null, body, requestKey: key.current }); }
      key.current = ''; setBody(''); setEditing(null); setReply(null); setNotice('已保存。');
    });
  }
  function manage(action: string, note?: Comment) {
    void run(async () => { await api('moderate', { content: Number(contentId), action, comment: note?.id, revision: note?.revision, expected: data?.locked ? 'locked' : 'open', reason: adminReason }); setNotice('管理操作已完成。'); });
  }
  function row(note: Comment) {
    return <article className={`discussion-note${note.parent ? ' discussion-reply' : ''}`} id={`comment-${note.id}`} key={note.id}>
      <p className="discussion-meta"><UserTagName nickname={note.nickname} tag={note.tag} /> · #{note.id}{note.parent && ` · 回复 #${note.parent}`} · <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time>{note.editedAt && ' · 已编辑'}</p>
      {note.deleted ? <p className="muted">作者已删除这条评论。</p> : note.hidden ? <p className="muted">这条评论已被管理员隐藏。</p> : <>{note.annotation && <div className="discussion-annotation"><p className="discussion-annotation-label">批注引用原文</p><AnnotationQuote quote={note.annotation.quote} /><a className="discussion-annotation-link" href={annotationHref(readingHref, note.annotation.version, note.annotation.id, note.root || note.id, 'discussion')}>阅读批注对应版本</a></div>}<div className="comment-prose" dangerouslySetInnerHTML={{ __html: note.html }} /></>}
      <div className="discussion-actions">
        {!root && <button type="button" disabled={busy} onClick={() => { setRoot(note.id); setPage(1); setReply(null); }}>展开讨论</button>}
        {user && !note.deleted && <>
          {!note.hidden && <><button type="button" disabled={busy || data?.locked} onClick={() => compose(note, false)}>回复 #{note.id}</button><button type="button" disabled={busy} onClick={() => { setReporting(note.id); setReason(''); }}>举报</button></>}
          {note.own && <><button type="button" disabled={busy} onClick={() => compose(note, true)}>编辑</button><button type="button" disabled={busy} onClick={() => { if (window.confirm('删除后正文不能恢复，已有回复会保留。确定删除吗？')) void run(async () => { await api(`comment-delete/${note.id}`, { revision: note.revision }); setNotice('已删除正文，回复保留。'); }); }}>删除</button></>}
        </>}
        {user?.role === 'admin' && <button type="button" disabled={busy || !adminReason.trim()} onClick={() => manage(note.hidden ? 'restore' : 'hide', note)}>{note.hidden ? '恢复显示' : '管理隐藏'}</button>}
      </div>
    </article>;
  }
  return <section className="discussion" id="discussion" aria-labelledby="discussion-title">
    <h2 id="discussion-title">读后回响</h2>
    <p role="status">{busy ? '正在处理…' : notice}</p>{error && <p role="alert" className="error">{error}</p>}
    <div className="discussion-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { await load(); })}>重新读取</button>{root && <button type="button" disabled={busy} onClick={() => { setRoot(undefined); setPage(1); setReply(null); }}>返回全部讨论</button>}{user && <button type="button" disabled={busy} onClick={() => { setReporting('content'); setReason(''); }}>举报这篇内容</button>}</div>
    {user?.role === 'admin' && <div className="discussion-management"><a href="/workspace/discussions">举报处理队列</a><label>管理理由<input value={adminReason} maxLength={1000} onChange={e => setAdminReason(e.target.value)} /></label><button type="button" disabled={busy || !data || !adminReason.trim()} onClick={() => manage(data?.locked ? 'unlock' : 'lock')}>{data?.locked ? '解锁讨论' : '锁定讨论'}</button></div>}
    {data ? <>{data.locked && <p role="status">讨论已锁定，现有评论仍可阅读。</p>}{data.thread && row(data.thread)}{data.items.map(row)}{!data.items.length && <p className="muted">{root ? '还没有回复。' : '还没有讨论，欢迎留下第一段回响。'}</p>}{data.pages > 1 && <nav className="discussion-actions" aria-label="评论分页"><button disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {data.pages} 页</span><button disabled={busy || page >= data.pages} onClick={() => setPage(page + 1)}>下一页</button></nav>}</> : !error && <p role="status">正在读取讨论…</p>}
    {user ? <form onSubmit={submit} aria-busy={busy}><label>{editing ? `编辑评论 #${editing.id}${editing.hidden ? '（保存后仍隐藏）' : ''}` : reply ? `回复 #${reply.id}` : '写下整篇评论'}<textarea ref={text} value={body} onChange={e => { setBody(e.target.value); key.current = ''; }} rows={5} maxLength={5000} required /></label><div className="discussion-actions"><button disabled={busy || !data || (!editing && data.locked)}>{editing ? '保存修改' : '发布'}</button>{(editing || reply) && <button type="button" disabled={busy} onClick={() => { setEditing(null); setReply(null); setBody(''); key.current = ''; }}>取消编辑或回复</button>}</div></form> : <p><a href={loginHref}>登录后发表评论、回复或举报</a></p>}
    {reporting !== null && <form onSubmit={event => { event.preventDefault(); void run(async () => { await api('report', { content: Number(contentId), comment: reporting === 'content' ? undefined : reporting, reason }); setReporting(null); setReason(''); setNotice('举报已提交，等待管理员处理。'); }); }}><h3>举报{reporting === 'content' ? '这篇内容' : `评论 #${reporting}`}</h3><label>举报理由<textarea required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label><div className="discussion-actions"><button disabled={busy}>提交举报</button><button type="button" disabled={busy} onClick={() => setReporting(null)}>取消</button></div></form>}
  </section>;
}
