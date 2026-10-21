import './public.css';
import { SiteNavigation } from '@/components/SiteNavigation';
export const metadata = { metadataBase: new URL(process.env.APP_ORIGIN || 'http://127.0.0.1:3000'), title: { default: '子非秋月 · 为您讲述', template: '%s · 子非秋月 · 为您讲述' }, description: '淡黄纸本与简线的非官方阅读空间。演示内容不作为作者原话。' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body><a className="skip-link" href="#main">跳到正文</a><header className="site-header"><div className="shell header-inner"><a href="/" className="brand" aria-label="子非秋月，返回首页"><span className="brand-mark" aria-hidden="true">秋</span><span className="brand-name">子非秋月<span className="brand-divider">·</span><small>为您讲述</small></span></a><SiteNavigation /></div></header><main id="main">{children}</main><footer className="site-footer shell"><span>子非秋月 · 为您讲述</span><span>非官方阅读站 · 演示内容不作为作者原话</span><a href="https://space.bilibili.com/11125629" target="_blank" rel="noopener noreferrer">作者 B 站主页 ↗</a><a href="/admin">管理后台</a></footer></body></html>;
}
