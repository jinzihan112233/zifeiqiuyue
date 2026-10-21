'use client';
import { displayLabel } from '../modules/display-labels';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { EditorialTools } from './EditorialTools';
import { contentAPI as api } from './content-client';

export function Workspace() {
  const [user, setUser] = useState<{ id: number; nickname: string; role: string } | null>(null), [loaded, setLoaded] = useState(false);
  const [type, setType] = useState('contents'), [status, setStatus] = useState(''), [kind, setKind] = useState(''), [page, setPage] = useState(1), [data, setData] = useState<{ items: any[]; pages: number; total: number }>({ items: [], pages: 1, total: 0 });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [creating, setCreating] = useState(false);
  const newDirty = useRef(false);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (newDirty.current) { event.preventDefault(); event.returnValue = ''; } };
    const navigate = (event: MouseEvent) => { if (newDirty.current && (event.target as Element).closest?.('a[href]') && !window.confirm('新建稿件尚未保存，确定离开吗？')) event.preventDefault(); };
    window.addEventListener('beforeunload', leave); document.addEventListener('click', navigate); return () => { window.removeEventListener('beforeunload', leave); document.removeEventListener('click', navigate); };
  }, []);
  useEffect(() => { let active = true; setBusy(true); setError(''); (async () => {
    const session = await api('session'); if (!active) return; setUser(session.user);
    if (session.user) { const result = await api(`manage-list?type=${type}&page=${page}${status ? `&status=${status}` : ''}${kind && type !== 'media' ? `&kind=${kind}` : ''}`); if (active) setData(result); }
  })().catch(e => { if (active) setError(e.message); }).finally(() => { if (active) { setLoaded(true); setBusy(false); } }); return () => { active = false; }; }, [type, status, kind, page]);
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const input = Object.fromEntries(new FormData(event.currentTarget)); setBusy(true); setError('');
    api('content', input).then(result => { newDirty.current = false; location.assign(`/workspace/edit/${result.content.id}`); }).catch(e => { setError(e.message); setBusy(false); });
  }
  return <><h1>发布文章</h1>
    {error && <p role="alert" className="error">{error}</p>}{!loaded ? <p role="status">正在翻开工作台…</p> : !user ? <p><a href="/login?returnTo=%2Fworkspace">登录后开始写作</a>，或凭邀请码<a href="/register">注册</a>。</p> : <>
      <nav aria-label="工作台操作"><a href="/account">{user.nickname} · 个人中心</a>{user.role === 'admin' && <><a href="/account/invitations">邀请码管理</a><a href="/workspace/discussions">举报与讨论管理</a></>}<button onClick={() => { if (!creating || !newDirty.current || window.confirm('放弃未保存的新建稿件吗？')) { newDirty.current = false; setCreating(!creating); } }}>新建内容</button></nav>
      {creating && <section className="paper"><h2>新建稿件</h2><form onSubmit={create} onChange={() => { newDirty.current = true; }}><label>内容类型<select name="kind"><option value="post">社区帖子</option>{user.role !== 'member' && <option value="article">站方文章（开头、简介、正文、后记）</option>}</select></label><label>固定链接标识<input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} required placeholder="例如 a-story-of-autumn" /></label><label>标题<input name="title" maxLength={200} required /></label><label>正文（Markdown）<textarea name="markdown" rows={9} maxLength={50000} required placeholder="在这里写下第一段文字…" /></label><button disabled={busy}>创建并进入编辑</button></form></section>}
      <section className="paper"><h2>{user.role === 'admin' ? '内容与审核管理' : '我的稿件'}</h2><div className="desk-filters"><label>查看<select value={type} onChange={e => { setType(e.target.value); setStatus(''); setPage(1); }}><option value="contents">内容与编辑</option><option value="submissions">{user.role === 'admin' ? '审核队列与提交记录' : '我的提交记录'}</option><option value="media">图片库</option></select></label>{type !== 'media' && <><label>状态<select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">全部状态</option>{(type === 'submissions' ? [['pending', '待审核'], ['approved', '已通过'], ['returned', '已退回'], ['withdrawn', '已撤回']] : [['unpublished', '未公开'], ['public', '已公开'], ['hidden', '已下架']]).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label><label>类型<select value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="">全部类型</option><option value="post">社区帖子</option><option value="article">站方文章</option></select></label></>}</div>
      <p aria-live="polite">{busy ? '正在读取…' : `共 ${data.total} 条记录`}</p><ul className="rows">{data.items.map(item => <li key={item.id}><div><strong>{item.title || item.slug || item.alt || `#${item.id}`}</strong><small>{item.status || item.visibility ? displayLabel(item.status || item.visibility) : `图片 #${item.id}`}{item.revision && ` · 修订 ${item.revision}`}</small>{item.reason && <p>审核意见：{item.reason}</p>}</div><div className="actions">{type === 'contents' ? <><a href={`/workspace/edit/${item.id}`}>编辑与管理</a>{item.visibility === 'public' && <a href={`/${item.kind === 'article' ? 'articles' : 'posts'}/${item.slug}`}>阅读发布版</a>}</> : type === 'submissions' ? <a href={`/workspace/review/${item.content}?submission=${item.id}`}>查看冻结稿{user.role !== 'member' && '与审核'}</a> : <code>![图片说明](media:{item.id})</code>}</div></li>)}</ul>{!busy && !data.items.length && <p className="muted">没有符合条件的记录。</p>}<div className="actions"><button className="quiet" disabled={busy || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {data.pages} 页</span><button className="quiet" disabled={busy || page >= data.pages} onClick={() => setPage(page + 1)}>下一页</button></div></section>
      {user.role !== 'member' && <EditorialTools contents={[]} />}
    </>}
  </>;
}
