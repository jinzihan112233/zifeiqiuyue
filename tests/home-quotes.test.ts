import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HOME_QUOTE_BUDGET, MAX_HOME_QUOTES, homeQuoteCost, selectHomeQuotes, type HomeQuote } from '../src/modules/home-quotes';

const quotes = (count: number, length = 24): HomeQuote[] =>
  Array.from({ length: count }, (_, i) => ({
    stableId: 'q-' + i,
    text: ('在文字中遇见世界。').repeat(Math.ceil(length / 9)).slice(0, length),
    attribution: '作者' + i,
    href: i % 2 ? '/articles/test?version=one' : null,
    demo: false,
  }));

function rng(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('homepage quotes: randomize selection, never duplicate, keep source order intact', () => {
  const pool = quotes(12);
  const before = JSON.stringify(pool);
  const selections = new Set<string>();
  for (let seed = 1; seed <= 24; seed++) {
    const selected = selectHomeQuotes(pool, [], rng(seed));
    assert.ok(selected.length >= 1 && selected.length <= MAX_HOME_QUOTES);
    assert.equal(selected.length, new Set(selected.map(q => q.stableId)).size);
    assert.ok(selected.reduce((total, q) => total + homeQuoteCost(q), 0) <= HOME_QUOTE_BUDGET);
    selections.add(selected.map(q => q.stableId).join(','));
  }
  assert.ok(selections.size > 2, 'refreshes should not always select the same quotes');
  assert.equal(JSON.stringify(pool), before);
});

test('homepage quotes: avoid prior selection when alternatives can fit', () => {
  const pool = quotes(8, 22);
  const old = selectHomeQuotes(pool, [], rng(2));
  const next = selectHomeQuotes(pool, old.map(q => q.stableId), rng(17));
  assert.ok(next.length >= 1);
  assert.ok(next.every(q => !old.some(previous => previous.stableId === q.stableId)));
});

test('homepage quotes: two candidates alternate, one candidate remains visible', () => {
  const pool = quotes(2, 18);
  const first = selectHomeQuotes(pool, [], rng(1));
  assert.equal(first.length, 1);
  const second = selectHomeQuotes(pool, first.map(q => q.stableId), rng(1));
  assert.equal(second.length, 1);
  assert.notEqual(first[0].stableId, second[0].stableId);
  assert.equal(selectHomeQuotes([pool[0]], [pool[0].stableId], rng(1))[0].stableId, pool[0].stableId);
});

test('homepage quotes: length and multiline budget reduce the number shown', () => {
  const pool: HomeQuote[] = [
    { stableId: 'a', text: '字'.repeat(65), attribution: '来源' },
    { stableId: 'b', text: '字'.repeat(65), attribution: '来源' },
    { stableId: 'c', text: '字'.repeat(65), attribution: '来源' },
    { stableId: 'd', text: '字'.repeat(65), attribution: '来源' },
  ];
  const picked = selectHomeQuotes(pool, [], rng(2));
  assert.equal(picked.length, 1);
  assert.ok(picked.reduce((total, q) => total + homeQuoteCost(q), 0) <= HOME_QUOTE_BUDGET);
  assert.ok(homeQuoteCost({ text: '短句\n短句\n短句', attribution: '某作者' }) >
    homeQuoteCost({ text: '短句短句短句', attribution: '某作者' }));
});

test('homepage quotes: empty, duplicate, and extremely long content', () => {
  assert.deepEqual(selectHomeQuotes([]), []);
  assert.deepEqual(selectHomeQuotes([{ stableId: 'blank', text: ' ', attribution: '作者' }]), []);
  const pool = [
    { stableId: 'x', text: '长'.repeat(300), attribution: '甲' },
    { stableId: 'x', text: '长'.repeat(240), attribution: '甲' },
    { stableId: 'y', text: '长'.repeat(190), attribution: '乙' },
  ];
  const selected = selectHomeQuotes(pool, [], rng(1));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].stableId, 'y', 'when none fit, show only the shortest one');
});
