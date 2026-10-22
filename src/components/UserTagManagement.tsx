'use client';
import { useEffect, useState } from 'react';
import { UserTagName } from './UserTagName';
import { userTagNames, type UserTag } from '../modules/user-tag-labels';
type Entry = { id: number; username: string; nickname: string; tag: UserTag };
async function call(url: string, data?: unknown) {
  const response = await fetch(url, { method: data ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', headers: data ? { 'Content-Type': 'application/json' } : {}, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '请求失败。');
  return result;
}
export function UserTagManagement({ managerTag, managerId }: { managerTag: UserTag; managerId: number }) {
  const [items, setItems] = useState<Entry[]>([]), [page, setPage] = useState(1), [pages, setPages] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function refresh() { const result = await call('/api/account/users?page=' + page); setItems(result.docs); setPages(result.totalPages || 1); }
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  async function change(entry: Entry, tag: UserTag) {
    if (!window.confirm('将 ' + entry.nickname + ' 的 Tag 设置为「' + userTagNames[tag] + '」？权限会立即改变并使其现有登录失效。')) return;
    setBusy(true); setError(''); setNotice('');
    try { await call('/api/account/user-tag/' + entry.id, { tag }); await refresh(); setNotice('Tag 已更新，对方需要重新登录。'); }
    catch(e) { setError(e instanceof Error ? e.message : '修改失败。'); } finally { setBusy(false); }
  }
  return <section className="paper"><h2>管理用户 Tag</h2><p className="muted">普通（黑）、小秋月（蓝）可评论和发社区帖子；管理员（紫）可发布站方内容与审核；站长（金）拥有最高管理权限。管理员只能分配普通和小秋月。站长身份不能从此页面授予。</p>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <ul className="rows">{items.map(entry => { const editable = entry.id !== managerId && entry.tag !== 'owner' && (managerTag === 'owner' || entry.tag !== 'admin');
      return <li key={entry.id}><div><UserTagName nickname={entry.nickname} tag={entry.tag} /><small>账号：{entry.username} · #{entry.id}</small></div>{editable && <label>修改 Tag<select disabled={busy} value={entry.tag} onChange={event => void change(entry, event.target.value as UserTag)}><option value="regular">普通</option><option value="moon">小秋月</option>{managerTag === 'owner' && <option value="admin">管理员</option>}</select></label>}</li>;
    })}</ul><nav className="actions"><button className="quiet" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button><span>{page} / {pages}</span><button className="quiet" disabled={busy || page >= pages} onClick={() => setPage(p => p + 1)}>下一页</button></nav>
  </section>;
}
