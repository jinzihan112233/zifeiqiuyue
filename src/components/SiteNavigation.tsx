'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
export function SiteNavigation() {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { fetch('/api/account/session', { cache: 'no-store' }).then(r => r.json()).then(data => setSignedIn(!!data.user)).catch(() => setSignedIn(false)); }, [path]);
  return <nav aria-label="主导航" className="nav-links">{[['/', '首页'], ['/articles', '全部文章'], ['/community', '社区来信'], ['/workspace', '内容工作台'], [signedIn ? '/account' : '/login', signedIn ? '个人中心' : '登录 / 注册']].map(([href, text]) => <a key={href} href={href} aria-current={path === href ? 'page' : undefined}>{text}</a>)}</nav>;
}
