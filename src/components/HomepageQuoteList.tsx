'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { HOME_QUOTE_BUDGET, homeQuoteCost, selectHomeQuotes, type HomeQuote } from '../modules/home-quotes';

const LAST_QUOTES_KEY = 'zifeiqiuyue:homepage-quotes:last';

export function HomepageQuoteList({ available, initial }: { available: HomeQuote[]; initial: HomeQuote[] }) {
  const [selected, setSelected] = useState(initial);
  const initialized = useRef(false);

  useEffect(() => {
    // Keep the server-rendered random picks, unless the previous tab refresh would
    // repeat quotes that can be replaced by eligible, unseen entries.
    if (initialized.current) return;
    initialized.current = true;
    try {
      const raw: unknown = JSON.parse(sessionStorage.getItem(LAST_QUOTES_KEY) || '[]');
      const previousIds = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string').slice(0, 3) : [];
      const previous = new Set(previousIds);
      const alternative = selectHomeQuotes(available, previousIds);
      const unseen = (items: HomeQuote[]) => items.filter(quote => !previous.has(quote.stableId)).length;
      const next = previousIds.length && unseen(alternative) > unseen(initial) ? alternative : initial;
      if (next !== initial) setSelected(next);
      sessionStorage.setItem(LAST_QUOTES_KEY, JSON.stringify(next.map(quote => quote.stableId)));
    } catch {
      // Browsers that block sessionStorage still receive server-side random quotes.
    }
  }, [available, initial]);

  return <>
    <div id="quotes-list" style={{ '--quote-count': Math.max(1, selected.length) } as CSSProperties}>{selected.map(quote => {
      const oversized = homeQuoteCost(quote) > HOME_QUOTE_BUDGET;
      return <blockquote className={'quote-item' + (oversized ? ' quote-item--oversized' : '')} key={quote.stableId}>
        <p title={oversized ? quote.text : undefined}>{quote.text}</p>
        <cite>{quote.href ? <a href={quote.href} rel="noopener noreferrer">— {quote.attribution}{quote.demo && ' · 演示'}</a> : <>— {quote.attribution}{quote.demo && ' · 演示'}</>}</cite>
      </blockquote>;
    })}</div>
    {!selected.length && <p className="empty-state">此页留白，静候字句。</p>}
  </>;
}
