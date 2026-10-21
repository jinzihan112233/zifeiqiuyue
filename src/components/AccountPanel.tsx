'use client';
import { displayLabel } from '../modules/display-labels';
import { useEffect, useState, type FormEvent } from 'react';
import { safeReturnTo } from '../modules/return-to';

type User = { id: number; username: string; nickname: string; role: string; recoveryNeedsSave: boolean };
type Item = { id: number; title?: string; slug?: string; status?: string; reason?: string; quote?: string; body?: string; content?: number; href?: string; updatedAt: string };
type Invitation = { id: number; used: number; maxUses: number; revoked: boolean; expiresAt: string; uses: { userId: number; createdAt: string }[] };
async function request(url: string, data?: unknown) {
  const response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', cache: 'no-store', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || value.errors?.[0]?.message || '操作未完成。');
  return value;
}
export async function logoutWithReminder() {
  const { user } = await request('/api/account/session');
  if (user?.recoveryNeedsSave && !window.confirm('退出前请确认已保存恢复码。若未设置或遗失，请先到账号安全页重新生成。仍要退出吗？')) return false;
  await request('/api/users/logout', {}); return true;
}
function PasswordFields({ current = false }: { current?: boolean }) {
  return <>{current && <label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} /></label>}<label>{current ? '新密码' : '密码'}<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /><small>12–128 个字符，空格也属于密码。</small></label><label>再次输入密码<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={256} /></label></>;
}
function CodeNotice({ code, onDone }: { code: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false), [copied, setCopied] = useState(false);
  return <section className="paper narrow"><h2>请保存新的恢复码</h2><p>仅此一次展示。旧恢复码立即失效。账号密码与恢复码都丢失时，无法找回账号。</p><pre className="secret-code">{code}</pre><button type="button" className="quiet" onClick={() => { void navigator.clipboard?.writeText(code).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? '已复制' : '复制恢复码'}</button><label className="check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />我已在安全处保存恢复码</label><button disabled={!saved} onClick={onDone}>继续</button></section>;
}
export function AuthForm({ mode }: { mode: 'login' | 'register' | 'recover' }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [code, setCode] = useState('');
  const heading = { login: '重逢，在字里行间', register: '凭一纸邀约，入席读故事', recover: '找回你的账号' }[mode];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form)); setBusy(true); setError('');
    try {
      const value = await request(mode === 'login' ? '/api/users/login' : `/api/account/${mode}`, data);
      form.reset();
      if (mode === 'login') location.assign(safeReturnTo(new URLSearchParams(location.search).get('returnTo')));
      else setCode(value.recoveryCode);
    } catch (error) { setError(error instanceof Error ? error.message : '操作未完成。'); } finally { setBusy(false); }
  }
  return <><p className="eyebrow">第四卷 · 相识</p><h1>{heading}</h1>{error && <p role="alert" className="error">{error}</p>}{code ? <CodeNotice code={code} onDone={() => location.assign('/login?returnTo=%2Faccount%2Fsecurity')} /> : <section className="paper narrow"><form onSubmit={submit} aria-busy={busy}><label>账号<input name="username" autoComplete="username" pattern="[a-zA-Z0-9_]{3,24}" required minLength={3} maxLength={24} /><small>3–24 位字母、数字或下划线，不区分大小写。</small></label>{mode === 'register' && <><label>昵称<input name="nickname" autoComplete="nickname" required maxLength={60} /></label><label>邀请码<input name="invitation" autoComplete="off" required maxLength={43} /></label></>}{mode === 'recover' && <label>恢复码<input name="recoveryCode" autoComplete="off" required maxLength={43} /></label>}{mode === 'login' ? <label>密码<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label> : <PasswordFields />}<button disabled={busy}>{busy ? '正在处理…' : { login: '登录', register: '注册并领取恢复码', recover: '重设密码并领取新恢复码' }[mode]}</button></form><p className="actions"><a href="/login">登录</a><a href="/register">邀请码注册</a><a href="/recover">找回密码</a></p>{mode === 'recover' && <p className="muted">恢复成功后需要重新登录。封禁状态不会因恢复密码解除。</p>}</section>}</>;
}
export function AccountPanel({ section = 'home' }: { section?: 'home' | 'security' | 'invitations' }) {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [code, setCode] = useState('');
  const [type, setType] = useState('drafts'), [page, setPage] = useState(1), [pages, setPages] = useState(1), [items, setItems] = useState<Item[]>([]), [invites, setInvites] = useState<Invitation[]>([]), [inviteCode, setInviteCode] = useState('');
  async function refresh() {
    const { user } = await request('/api/account/session'); setUser(user);
    if (!user) return;
    if (section === 'home') { const data = await request(`/api/account/activity?type=${type}&page=${page}`); setItems(data.docs); setPages(data.totalPages || 1); }
    if (section === 'invitations' && user.role === 'admin') { const data = await request(`/api/account/invitations?page=${page}`); setInvites(data.docs); setPages(data.totalPages || 1); }
  }
  useEffect(() => { let cancelled = false; setLoading(true); setError(''); refresh().catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [type, page, section]); // eslint-disable-line react-hooks/exhaustive-deps
  async function run(task: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await task(); await refresh(); } catch (error) { setError(error instanceof Error ? error.message : '操作未完成。'); } finally { setBusy(false); } }
  function security(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault(); const form = event.currentTarget, data = Object.fromEntries(new FormData(form));
    void run(async () => { const value = await request(`/api/account/${action}`, data); form.reset(); if (value.recoveryCode) setCode(value.recoveryCode); else if (action === 'password') { location.assign('/login?returnTo=%2Faccount%2Fsecurity'); } else setNotice('已保存。'); });
  }
  if (loading && !user) return <p role="status">正在翻开个人书页…</p>;
  if (!user) return <><h1>个人中心</h1>{error && <p role="alert">{error}</p>}<p><a href={`/login?returnTo=${encodeURIComponent(section === 'home' ? '/account' : `/account/${section}`)}`}>请先登录</a>，或使用邀请码<a href="/register">注册</a>。</p></>;
  return <><p className="eyebrow">个人书页</p><h1>{user.nickname}</h1><nav className="account-tabs" aria-label="个人中心"><a href="/account" aria-current={section === 'home' ? 'page' : undefined}>我的内容</a><a href="/account/security" aria-current={section === 'security' ? 'page' : undefined}>账号安全</a>{user.role === 'admin' && <a href="/account/invitations">邀请码管理</a>}</nav>{(busy || loading || notice) && <p aria-live="polite">{busy || loading ? '正在处理…' : notice}</p>}{error && <p role="alert" className="error">{error}</p>}
    {code ? <CodeNotice code={code} onDone={() => void run(async () => { await request('/api/account/confirm-recovery', {}); setCode(''); setNotice('恢复码已确认保存。'); })} /> : section === 'security' ? <><section className="paper narrow"><h2>账号资料</h2><p>账号：{user.username}</p><form onSubmit={e => security(e, 'nickname')}><label>昵称<input name="nickname" defaultValue={user.nickname} required maxLength={60} /></label><button disabled={busy}>保存昵称</button></form></section><section className="paper narrow"><h2>更改密码</h2><form onSubmit={e => security(e, 'password')}><PasswordFields current /><button disabled={busy}>更改密码并退出全部设备</button></form></section><section className="paper narrow"><h2>恢复码</h2><p>恢复码无法再次查看。{user.recoveryNeedsSave ? '尚未确认保存，请确认原恢复码已安全保存，或重新生成。' : '已确认保存。'}</p>{user.recoveryNeedsSave && <button className="quiet" disabled={busy} onClick={() => void run(async () => { await request('/api/account/confirm-recovery', {}); setNotice('已确认保存。'); })}>我已保存原恢复码</button>}<form onSubmit={e => security(e, 'recovery')}><label>当前密码<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={256} /></label><button disabled={busy}>重新生成恢复码（旧码失效）</button></form></section><div className="account-signout"><button className="quiet" disabled={busy} onClick={() => void run(async () => { if (await logoutWithReminder()) location.assign('/login'); })}>退出登录</button></div></> : section === 'invitations' ? user.role !== 'admin' ? <p role="alert">仅管理员可以管理邀请码。</p> : <><section className="paper narrow"><h2>生成邀请码</h2><form onSubmit={e => { e.preventDefault(); const form = e.currentTarget, data = Object.fromEntries(new FormData(form)); void run(async () => { const value = await request('/api/account/invitations', { ...data, expiresAt: new Date(String(data.expiresAt)).toISOString() }); setInviteCode(value.code); form.reset(); }); }}><label>最多使用次数<input name="maxUses" type="number" min={1} max={100} defaultValue={1} required /></label><label>失效时间（本机时区）<input name="expiresAt" type="datetime-local" required /></label><button disabled={busy}>生成</button></form>{inviteCode && <div role="status"><p>仅此一次展示，请复制后交给受邀者。</p><pre className="secret-code">{inviteCode}</pre><button className="quiet" onClick={() => { void navigator.clipboard?.writeText(inviteCode).then(() => setNotice('已复制邀请码。')).catch(() => setError('复制失败，请手动复制。')); }}>复制邀请码</button><button className="quiet" onClick={() => setInviteCode('')}>隐藏</button></div>}</section><ul className="rows">{invites.map(invite => <li key={invite.id}><div>邀请码 #{invite.id}<small>{invite.revoked ? '已撤销' : '有效至 ' + new Date(invite.expiresAt).toLocaleString('zh-CN')} · 已使用 {invite.used}/{invite.maxUses}</small><details><summary>使用记录</summary>{invite.uses.map(use => <p key={use.userId}>成员 #{use.userId} · {new Date(use.createdAt).toLocaleString('zh-CN')}</p>)}</details></div><button className="quiet" disabled={busy || invite.revoked} onClick={() => void run(async () => { await request(`/api/account/invitations/${invite.id}`, {}); })}>撤销</button></li>)}</ul></> : <><section className="paper"><label>查看<select value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="drafts">我的草稿</option><option value="submissions">提交与审核意见</option><option value="contents">内容与公开状态</option><option value="annotations">我的文字批注</option><option value="comments">我的评论与回复</option></select></label><ul className="rows">{items.map(item => <li key={item.id}><div><strong>{item.title || item.slug || item.quote || `#${item.id}`}</strong><small>{displayLabel(item.status)} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</small>{item.reason && <p>审核意见：{item.reason}</p>}{item.body && <p>{item.body}</p>}<a href={item.href || '/workspace'}>{type === 'comments' ? '查看讨论' : item.status === 'public' ? '阅读' : '继续编辑'}</a></div></li>)}</ul>{!items.length && <p className="muted">这里还没有记录，先写下第一段故事吧。</p>}</section></>}
    {!code && section !== 'security' && pages > 1 && <div className="actions"><button className="quiet" disabled={busy || loading || page <= 1} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {pages} 页</span><button className="quiet" disabled={busy || loading || page >= pages} onClick={() => setPage(page + 1)}>下一页</button></div>}
  </>;
}
