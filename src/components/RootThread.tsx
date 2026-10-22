'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { contentAPI as api } from './content-client';
import { AnnotationQuote } from './AnnotationQuote';
import { UserTagName } from './UserTagName';
import type { UserTag } from '../modules/user-tag-labels';
import { annotationHref } from '../modules/annotation-text';

export type CommentItem = {
  id: number; parent: number | null; root: number | null; nickname: string;
  tag: UserTag; replyToNickname: string | null; replyToTag: UserTag | null;
  replyToExcerpt: string | null; replyCount: number;
  body: string; html: string; deleted: boolean; hidden: boolean;
  revision: number; own: boolean; createdAt: string; editedAt: string | null;
  annotation: { id: number; version: string; quote: string } | null;
};
export type CommentResult = {
  items: CommentItem[]; thread: CommentItem | null; pages: number;
  total: number; locked: boolean;
};
export type DiscussionUser = { id: number; role: string } | null;

export function RootThread({
  contentId, root: initialRoot, rootId, user, loginHref, readingHref, compact = false, initialExpanded = false, locked = false,
}: {
  contentId: string; root?: CommentItem; rootId?: number; user: DiscussionUser;
  loginHref: string; readingHref: string; compact?: boolean; initialExpanded?: boolean; locked?: boolean;
}) {
  const id = initialRoot?.id || rootId;
  const [root, setRoot] = useState<CommentItem | null>(initialRoot || null);
  const [expanded, setExpanded] = useState(initialExpanded);
  const [result, setResult] = useState<CommentResult | null>(null);
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<CommentItem | null>(null);
  const [editing, setEditing] = useState<CommentItem | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [report, setReport] = useState<CommentItem | null>(null), [reason, setReason] = useState('');
  const [moderating, setModerating] = useState<CommentItem | null>(null), [moderationReason, setModerationReason] = useState('');
  const sending = useRef(false), key = useRef('');
  const field = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);

  async function refresh(nextPage = page) {
    if (!id) return;
    const response: CommentResult = await api('discussion?content=' + contentId + '&root=' + id + '&page=' + nextPage);
    if (!mounted.current) return;
    setRoot(response.thread);
    setResult(response);
    setPage(nextPage);
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!id || !expanded) return;
    let current = true;
    setError('');
    api('discussion?content=' + contentId + '&root=' + id + '&page=1')
      .then((value: CommentResult) => { if (current) { setRoot(value.thread); setResult(value); setPage(1); } })
      .catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [contentId, id, expanded]);

  async function run(task: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setError(''); setNotice('');
    try { await task(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败，输入已保留。'); }
    finally { sending.current = false; setBusy(false); }
  }
  function compose(note: CommentItem, edit = false) {
    setTarget(edit ? null : note); setEditing(edit ? note : null);
    setDraft(edit ? note.body : ''); key.current = '';
    requestAnimationFrame(() => field.current?.focus());
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      if (editing) await api('comment-edit/' + editing.id, { body: draft, revision: editing.revision });
      else {
        key.current ||= crypto.randomUUID();
        await api('comment', { content: Number(contentId), parent: target?.id ?? id, body: draft, requestKey: key.current });
      }
      key.current = ''; setDraft(''); setTarget(null); setEditing(null);
      if (editing) await refresh(page);
      else {
        const latest: CommentResult = await api('discussion?content=' + contentId + '&root=' + id + '&page=1');
        await refresh(latest.pages);
      }
      setNotice('已发布。');
    });
  }
  function card(item: CommentItem, isRoot: boolean) {
    return <article key={item.id} className={'comment-thread-item' + (isRoot ? ' comment-thread-root' : ' comment-thread-reply')} id={'comment-' + item.id}>
      <p className="discussion-meta"><UserTagName nickname={item.nickname} tag={item.tag} /> · <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</time>{item.editedAt && ' · 已编辑'}</p>
      {!isRoot && item.replyToNickname && <div className="comment-reply-reference">
        回复 @<UserTagName nickname={item.replyToNickname} tag={item.replyToTag || 'regular'} showTag={false} />
        {item.replyToExcerpt && <span className="comment-reference-snippet">「{item.replyToExcerpt}」</span>}
      </div>}
      {item.deleted ? <p className="muted">作者已删除此评论。</p>
        : item.hidden ? <p className="muted">该评论已被管理员隐藏。</p>
        : <>{item.annotation && <div className="discussion-annotation"><p className="discussion-annotation-label">批注引用原文</p><AnnotationQuote quote={item.annotation.quote} /><a className="discussion-annotation-link" href={annotationHref(readingHref, item.annotation.version, item.annotation.id, item.root || item.id)}>原文定位</a></div>}<div className="comment-prose" dangerouslySetInnerHTML={{ __html: item.html }} /></>}
      <div className="discussion-actions comment-inline-actions">
        {user && !item.deleted && !item.hidden && !(locked || result?.locked) && <button type="button" disabled={busy} onClick={() => { setExpanded(true); compose(item); }}>回复</button>}
        {user && !item.deleted && !item.hidden && <button type="button" disabled={busy} onClick={() => { setReport(item); setReason(''); }}>举报</button>}
        {item.own && !item.deleted && <><button type="button" disabled={busy} onClick={() => compose(item, true)}>编辑</button>
          <button type="button" disabled={busy} onClick={() => {
            if (confirm('删除此评论？已有回复会保留。')) void run(async () => { await api('comment-delete/' + item.id, { revision: item.revision }); await refresh(); });
          }}>删除</button></>}
        {user?.role === 'admin' && <button type="button" disabled={busy} onClick={() => { setModerating(item); setModerationReason(''); }}>{item.hidden ? '恢复' : '隐藏'}</button>}
      </div>
    </article>;
  }
  return <section className={'comment-thread' + (compact ? ' comment-thread--compact' : '')} aria-label={'评论 #' + id}>
    {root ? card(root, true) : !error && <p className="muted">读取评论中…</p>}
    {root && !expanded && (root.replyCount > 0 || target) &&
      <button className="comment-replies-toggle" type="button" onClick={() => setExpanded(true)}>展开 {root.replyCount} 条回复</button>}
    {expanded && <div className="comment-replies">
      {result?.items.map(item => card(item, false))}
      {result && !result.items.length && <p className="muted">暂无回复。</p>}
      {result && result.pages > 1 && <div className="comment-replies-pagination">
        <button type="button" disabled={busy || page <= 1} onClick={() => void run(() => refresh(page - 1))}>上一页</button>
        <span>{page} / {result.pages}</span>
        <button type="button" disabled={busy || page >= result.pages} onClick={() => void run(() => refresh(page + 1))}>下一页</button>
      </div>}
      {!compact && <button type="button" className="comment-replies-toggle" onClick={() => { setExpanded(false); setTarget(null); }} disabled={busy}>收起回复</button>}
    </div>}
    {user && (target || editing) && <form className="comment-inline-composer" onSubmit={submit}>
      <label>{editing ? '编辑评论' : '回复 ' + (target?.nickname || root?.nickname || '')}
        <textarea ref={field} rows={compact ? 2 : 3} maxLength={5000} required value={draft} onChange={e => { setDraft(e.target.value); key.current = ''; }} />
      </label>
      <div className="discussion-actions"><button disabled={busy || (!editing && (locked || result?.locked)) || !draft.trim()}>{editing ? '保存' : '发布回复'}</button><button type="button" disabled={busy} onClick={() => { setTarget(null); setEditing(null); setDraft(''); }}>取消</button></div>
    </form>}
    {report && <form className="comment-inline-composer" onSubmit={event => { event.preventDefault(); void run(async () => { await api('report', { content: Number(contentId), comment: report.id, reason }); setReport(null); setReason(''); setNotice('举报已提交。'); }); }}>
      <label>举报评论<textarea rows={2} maxLength={1000} required value={reason} onChange={e => setReason(e.target.value)} /></label>
      <button disabled={busy}>提交举报</button><button type="button" onClick={() => setReport(null)}>取消</button>
    </form>}
    {moderating && <form className="comment-inline-composer" onSubmit={event => { event.preventDefault(); void run(async () => { await api('moderate', { content: Number(contentId), action: moderating.hidden ? 'restore' : 'hide', comment: moderating.id, revision: moderating.revision, reason: moderationReason }); setModerating(null); await refresh(); }); }}>
      <label>管理理由<textarea rows={2} required maxLength={1000} value={moderationReason} onChange={e => setModerationReason(e.target.value)} /></label>
      <button disabled={busy}>确认{moderating.hidden ? '恢复' : '隐藏'}</button><button type="button" onClick={() => setModerating(null)}>取消</button>
    </form>}
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!user && compact && <p className="muted"><a href={loginHref}>登录后参与讨论</a></p>}
  </section>;
}
