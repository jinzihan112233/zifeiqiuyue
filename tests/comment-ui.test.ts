import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RootThread, type CommentItem } from '../src/components/RootThread';
import { Discussion } from '../src/components/Discussion';

const root: CommentItem = {
  id: 27, parent: null, root: null, nickname: '测试读者', tag: 'moon',
  replyToNickname: null, replyToTag: null, replyToExcerpt: null, replyCount: 3,
  body: '关于这一段文字的想法', html: '<p>关于这一段文字的想法</p>',
  deleted: false, hidden: false, revision: 1, own: true,
  createdAt: '2026-10-21T09:00:00.000Z', editedAt: null, annotation: null,
};

test('root comments show a collapsed reply count without a page transition', () => {
  const html = renderToStaticMarkup(createElement(RootThread, {
    contentId: '10', root, user: { id: 5, role: 'member' },
    loginHref: '/login', readingHref: '/articles/example',
  }));
  assert.match(html, /测试读者/);
  assert.match(html, /展开 3 条回复/);
  assert.match(html, /comment-thread-root/);
  assert.doesNotMatch(html, /href="[^"]*thread=/);
});

test('the discussion opens with a main-comment view instead of a separate thread page', () => {
  const html = renderToStaticMarkup(createElement(Discussion, {
    contentId: '10', loginHref: '/login', readingHref: '/articles/example',
  }));
  assert.match(html, /读后回响/);
  assert.match(html, /discussion--threads/);
  assert.doesNotMatch(html, /返回全部讨论/);
});
