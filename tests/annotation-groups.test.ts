import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupAnnotations, previewAnnotationQuote } from '../src/modules/annotation-groups';
import { renderIntroMarkdown } from '../src/modules/intro-markdown';

const note = (id: number, start: number, end: number, snapshot = 1) =>
  ({ id, start, end, snapshot, quote: `原文${id}` });

test('contained and identical selections display together and retain their individual IDs', () => {
  const groups = groupAnnotations([note(1, 10, 40), note(2, 15, 20), note(3, 10, 40), note(4, 50, 60)]);
  assert.deepEqual(groups.map(group => group.items.map(item => item.id)), [[1, 2, 3], [4]]);
  assert.equal(groups[0].quote, '原文1');
});

test('partially overlapping ranges, repeated words elsewhere and other snapshots never group', () => {
  const groups = groupAnnotations([note(1, 0, 12), note(2, 8, 18), note(3, 23, 26), note(4, 1, 4, 2)]);
  assert.deepEqual(groups.map(group => group.items.length), [1, 1, 1, 1]);
});

test('transitive containment groups adjacent nested selections without altering input', () => {
  const input = [note(1, 20, 23), note(2, 0, 60), note(3, 40, 48)];
  const groups = groupAnnotations(input);
  assert.deepEqual(groups[0].items.map(item => item.id), [1, 2, 3]);
  assert.equal(groups[0].quote, '原文2');
  assert.deepEqual(input.map(item => item.id), [1, 2, 3]);
});

test('short quotes are complete; long and multiline quotes reveal their full text on expansion', () => {
  assert.deepEqual(previewAnnotationQuote('简短的原文'), { text: '简短的原文', truncated: false });
  const long = previewAnnotationQuote('长'.repeat(150));
  assert.equal(long.truncated, true);
  assert.ok(long.text.length <= 73);
  assert.equal(previewAnnotationQuote('第一行\n第二行\n第三行\n第四行').truncated, true);
  assert.equal(previewAnnotationQuote('😀'.repeat(100)).text, '😀'.repeat(72) + '…');
});

test('introduction Markdown formats emphasis while escaping raw HTML and dangerous links', () => {
  const html = renderIntroMarkdown('一段 **加粗** 和 *强调*。\n下一行<script>alert(1)</script> [坏链接](javascript:alert(1))');
  assert.match(html, /<strong>加粗<\/strong>/);
  assert.match(html, /<em>强调<\/em>/);
  assert.match(html, /<br>/);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});
