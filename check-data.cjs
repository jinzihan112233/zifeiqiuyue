const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'data.js'), 'utf8'), context);
const { articles, featuredIds, quotes } = context.window.SITE_DATA;
assert.ok(Array.isArray(articles) && articles.length > 0, '文章数组不能为空');
const ids = new Set();
for (const article of articles) {
  for (const field of ['id', 'title', 'type', 'description']) {
    assert.ok(typeof article[field] === 'string' && article[field].trim(), `${field} 不能为空`);
  }
  assert.ok(!ids.has(article.id), `重复文章 ID：${article.id}`);
  ids.add(article.id);
  assert.match(article.published, /^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD');
  assert.equal(new Date(article.published).toISOString().slice(0, 10), article.published, '日期不存在');
  assert.ok(Array.isArray(article.paragraphs) && article.paragraphs.length > 0, '正文不能为空');
  assert.ok(article.paragraphs.every(p => typeof p === 'string' && p.trim()), '段落必须是非空文本');
  assert.equal(typeof article.sourceUrl, 'string', '来源必须是字符串');
  if (article.sourceUrl) {
    assert.ok(['http:', 'https:'].includes(new URL(article.sourceUrl).protocol), '来源须为网页链接');
  }
}
assert.ok(Array.isArray(featuredIds) && featuredIds.length > 0, '推荐列表不能为空');
assert.equal(new Set(featuredIds).size, featuredIds.length, '推荐 ID 不能重复');
for (const id of featuredIds) assert.ok(ids.has(id), `推荐文章不存在：${id}`);
assert.ok(Array.isArray(quotes) && quotes.length > 0, '摘句列表不能为空');
assert.ok(quotes.every(q => typeof q === 'string' && q.trim()), '摘句必须是非空文本');
console.log(`数据检查通过：${articles.length} 篇文章、${featuredIds.length} 篇推荐、${quotes.length} 条摘句。`);
