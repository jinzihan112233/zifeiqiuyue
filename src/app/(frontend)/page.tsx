import { getPayload } from 'payload';
import config from '@payload-config';
import { publicHome } from '@/modules/editorial';
import { ArticleDate } from '@/components/ArticleDate';
export const dynamic = 'force-dynamic';
export const metadata = { title: '首页', alternates: { canonical: '/' } };
export default async function Home() {
  const home = await publicHome(await getPayload({ config }));
  return <div className="shell homepage-layout"><div className="primary-column">
    <section className="hero" aria-labelledby="hero-title"><div className="hero-inner"><span className="eyebrow">人物 · 思想 · 人间</span><h1 id="hero-title">借一页文字，<br />与古今相逢。</h1><p>{home.introduction}</p></div>
      <svg className="hero-drawing" viewBox="0 0 330 300" fill="none" aria-hidden="true"><circle cx="219" cy="79" r="43" /><path d="M53 213C88 191 104 179 127 150C143 170 151 184 166 190C184 165 201 134 216 117C240 148 253 163 283 187L323 207M4 240C52 221 79 209 112 201C137 207 147 222 178 226C203 220 218 204 243 204C272 204 293 218 326 226M51 260H197M225 260H288M92 274H246M266 105L279 101L287 106M283 87L293 84L300 88" /></svg>
    </section><section className="featured-section" aria-labelledby="featured-title"><div className="section-head"><div><h2 id="featured-title">文章推荐</h2></div><a className="view-all" href="/articles">查看全部 <span aria-hidden="true">↗</span></a></div>
      {home.featured.length ? <div className="featured-grid">{home.featured.slice(0, 4).map(item => <a key={item.stableId} className="article-card" href={`/articles/${item.slug}`}><span className="article-label">{item.metadata.category || '站方文章'}</span><h3>{item.title}</h3><p className="article-description">{item.summary}</p><div className="article-card-bottom"><ArticleDate metadata={item.metadata} publishedAt={item.publishedAt} /><span className="article-arrow" aria-hidden="true">↗</span></div></a>)}</div> : <p className="empty-state">篇章尚在整理，待展卷时再相逢。<br /><a href="/articles">浏览全部公开文章</a></p>}
    </section></div><aside className="quotes-column" aria-labelledby="quotes-title"><div className="quotes-heading"><h2 id="quotes-title">字句拾遗</h2></div><div id="quotes-list">{home.quotes.slice(0, 3).map(q => <blockquote className="quote-item" key={q.stableId}><p>{q.text}</p><cite>{q.href ? <a href={q.href} rel="noopener noreferrer">— {q.attribution}{q.demo && ' · 演示'}</a> : <>— {q.attribution}{q.demo && ' · 演示'}</>}</cite></blockquote>)}</div>{!home.quotes.length && <p className="empty-state">此页留白，静候字句。</p>}</aside></div>;
}
