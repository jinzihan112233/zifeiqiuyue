'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const publicLinks = [
  { href: '/', label: '首页' },
  { href: '/articles', label: '全部文章' },
  { href: '/community', label: '社区来信' },
];

export function SiteNavigation() {
  const path = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    fetch('/api/account/session', { cache: 'no-store' })
      .then(response => response.json())
      .then(data => setSignedIn(!!data.user))
      .catch(() => setSignedIn(false));
  }, [path]);

  const accountHref = signedIn ? '/account' : '/login';
  const secondaryLinks = [
    { href: '/workspace', label: '发布文章' },
    { href: accountHref, label: signedIn ? '个人中心' : '登录 / 注册' },
  ];
  const current = (href: string) => {
    if (href === '/') return path === '/';
    if (href === '/community') return path === '/community' || path.startsWith('/posts/');
    if (href === '/articles') return path === '/articles' || path.startsWith('/articles/');
    if (href === '/workspace') return path === '/workspace' || path.startsWith('/workspace/');
    if (href === accountHref) return ['/account', '/login', '/register', '/recover'].some(segment => path === segment || path.startsWith(segment + '/'));
    return path === href;
  };
  const renderLink = ({ href, label }: { href: string; label: string }) => (
    <a key={href} href={href} aria-current={current(href) ? 'page' : undefined}>{label}</a>
  );

  return <nav className="nav-links" aria-label="主导航">
    <div className="nav-primary">{publicLinks.map(renderLink)}</div>
    <div className="nav-secondary">{secondaryLinks.map(renderLink)}</div>
    <details className="nav-more">
      <summary className={secondaryLinks.some(link => current(link.href)) ? 'is-current' : undefined}>更多</summary>
      <div className="nav-dropdown">{secondaryLinks.map(renderLink)}</div>
    </details>
  </nav>;
}
