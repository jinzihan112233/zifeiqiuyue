/** Homepage-only random display: the public API continues to return all eligible quotes. */
export type HomeQuote = {
  stableId: string;
  text: string;
  attribution: string;
  href?: string | null;
  demo?: boolean;
};

export const MAX_HOME_QUOTES = 3;
// Approximate sidebar height in full-width characters, including fixed space around each card.
export const HOME_QUOTE_BUDGET = 135;

function visualWidth(text: string) {
  let units = 0;
  for (const char of text) {
    if (char === '\n') units += 12;
    else if (/\s/.test(char)) units += 0.5;
    else if (/^[\x00-\x7f]$/.test(char)) units += 0.55;
    else if (char.codePointAt(0)! > 0xffff) units += 2;
    else units += 1;
  }
  return units;
}

export function homeQuoteCost(quote: Pick<HomeQuote, 'text' | 'attribution'>) {
  return 14 + Math.ceil(visualWidth(quote.text.trim())) +
    Math.min(16, Math.ceil(visualWidth(quote.attribution) / 1.7));
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Select at most 3 distinct quotes with a combined height budget.
 * Prefer entries absent from the previous page load. When multiple quotes fit,
 * show fewer than the entire pool to allow the next refresh to rotate them.
 * If nothing fits, show only the shortest available quote.
 */
export function selectHomeQuotes<T extends HomeQuote>(
  quotes: readonly T[],
  previousIds: readonly string[] = [],
  random: () => number = Math.random,
): T[] {
  const distinct = [...new Map(quotes.filter(q => q.text.trim()).map(q => [q.stableId, q])).values()];
  const fitting = distinct.filter(q => homeQuoteCost(q) <= HOME_QUOTE_BUDGET);
  if (!fitting.length) {
    return distinct.sort((a, b) => homeQuoteCost(a) - homeQuoteCost(b)).slice(0, 1);
  }

  const previous = new Set(previousIds);
  const unseen = shuffled(fitting.filter(q => !previous.has(q.stableId)), random);
  const seen = shuffled(fitting.filter(q => previous.has(q.stableId)), random);
  const maximum = Math.min(MAX_HOME_QUOTES, fitting.length > 1 ? fitting.length - 1 : 1);
  const selected: T[] = [];
  let total = 0;
  for (const quote of [...unseen, ...seen]) {
    const cost = homeQuoteCost(quote);
    if (selected.length >= maximum) break;
    if (total + cost > HOME_QUOTE_BUDGET) continue;
    selected.push(quote);
    total += cost;
  }
  return selected;
}
