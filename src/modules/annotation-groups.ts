/** Group only selections that cover one another within the same published snapshot.
 * Identical words in different positions and partial overlaps stay independent.
 */
export type AnnotationRange = { id: number; snapshot: number; start: number; end: number; quote: string };

export type AnnotationGroup<T extends AnnotationRange> = { key: number; quote: string; items: T[] };

export function groupAnnotations<T extends AnnotationRange>(items: readonly T[]): AnnotationGroup<T>[] {
  const parent = items.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index];
    return index;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.snapshot !== b.snapshot) continue;
      const aContainsB = a.start <= b.start && a.end >= b.end;
      const bContainsA = b.start <= a.start && b.end >= a.end;
      if (aContainsB || bContainsA) parent[root(j)] = root(i);
    }
  }
  const groups = new Map<number, T[]>();
  items.forEach((item, index) => {
    const indexRoot = root(index);
    const group = groups.get(indexRoot) || [];
    group.push(item);
    groups.set(indexRoot, group);
  });
  return [...groups.values()].map(members => {
    const widest = members.reduce((best, item) =>
      item.end - item.start > best.end - best.start ? item : best);
    return { key: members[0].id, quote: widest.quote, items: members };
  });
}

/** Keep short quotes intact; expand lengthy or heavily line-broken quotes on demand. */
export function previewAnnotationQuote(quote: string, maxCharacters = 28, maxLines = 2) {
  const characters = Array.from(quote);
  const lines = quote.split('\n');
  if (characters.length <= maxCharacters && lines.length <= maxLines) return { text: quote, truncated: false };
  const linePreview = lines.slice(0, maxLines).join('\n');
  return { text: Array.from(linePreview).slice(0, maxCharacters).join('') + '…', truncated: true };
}

/** Place marginal notes close to their quoted line without allowing cards to overlap. */
export function placeAnnotationNotes(entries: readonly { anchor: number; height: number }[], gap = 12) {
  const tops: number[] = [];
  let bottom = 0;
  for (const entry of entries) {
    const top = Math.max(0, Number.isFinite(entry.anchor) ? entry.anchor : 0, bottom ? bottom + gap : 0);
    tops.push(top);
    bottom = top + Math.max(0, entry.height);
  }
  return { tops, height: bottom };
}
