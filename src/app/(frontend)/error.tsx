'use client';
export default function ErrorPage({ retry }: { error: unknown; retry: () => void }) {
  return <section className="shell page-shell unavailable" role="alert"><span className="section-kicker">稍候再读</span><h1>暂时无法展开此页</h1><p>内容服务暂时不可用，请稍后重试。</p><div className="reading-actions"><button onClick={() => retry()}>重新尝试</button><a href="/">返回首页</a></div></section>;
}
