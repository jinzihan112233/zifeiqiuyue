const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { compileArticle, loadContent, serializeContent } = require('../scripts/build-content.cjs');
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'content/articles/example.md');
const front = '---\ntitle: "测试文章"\npublished: "2026-10-21"\ntype: "人物独白"\ndescription: "排版测试"\nsourceUrl: ""\ndemo: true\n---\n\n';
const compile = body => compileArticle(front + body, filename, root);

test('Markdown 保留标题、混合强调、引用、列表、表格、代码和网页链接', () => {
  const { html } = compile('## 标题\n\n### 小标题\n\n正文 **粗体**、*斜体*、~~删除~~ 与 `代码`。\n\n> 引用\n\n- 项目\n\n1. 步骤\n\n| 列 | 列 |\n| --- | --- |\n| 一 | 二 |\n\n[来源](https://www.bilibili.com/)\n\n```text\n示例\n```');
  for (const tag of ['h2', 'h3', 'strong', 'em', 's', 'code', 'blockquote', 'ul', 'ol', 'table', 'pre']) assert.match(html, new RegExp(`<${tag}[ >]`));
  assert.match(html, /href="https:\/\/www\.bilibili\.com\/"/);
});

test('原生 HTML 转义，不输出脚本、事件属性或可执行链接', () => {
  const { html } = compile('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[危险](javascript:alert%281%29)\n\n![危险](javascript:alert%281%29)');
  assert.ok(!/<script|<img|href="javascript:/i.test(html));
  assert.match(html, /&lt;script&gt;/);
});

test('本地图片路径从 Markdown 目录转换为网页路径，保留替代文字', () => {
  const { html } = compile('![山河](../../assets/images/libai/road-to-changan.svg)');
  assert.match(html, /src="assets\/images\/libai\/road-to-changan\.svg"/);
  assert.match(html, /alt="山河"/);
  assert.match(html, /loading="lazy"/);
});

test('缺图、越界路径或缺少替代文字时阻止构建', () => {
  assert.throws(() => compile('![山河](../../assets/images/missing.png)'), /图片不存在/);
  assert.throws(() => compile('![山河](../../README.md)'), /assets\/images/);
  assert.throws(() => compile('![](../../assets/images/libai/road-to-changan.svg)'), /图片替代文字/);
});

test('元数据、日期和正文缺失时给出构建错误', () => {
  assert.throws(() => compileArticle('无文件头', filename, root), /YAML/);
  assert.throws(() => compileArticle(front.replace('2026-10-21', '2026-02-30') + '正文', filename, root), /日期不存在/);
  assert.throws(() => compileArticle(front.replace('demo: true', 'demo: "true"') + '正文', filename, root), /demo/);
  assert.throws(() => compile('  '), /正文/);
});

test('独立内容文件和生成文件一致，推荐与金句引用均有效', () => {
  const data = loadContent(root);
  assert.equal(fs.readFileSync(path.join(root, 'assets/generated/content.js'), 'utf8'), serializeContent(data));
});

test('空站点允许没有文章、推荐与金句', () => {
  const cache = path.join(root, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(cache, 'empty-content-test-'));
  try {
    fs.mkdirSync(path.join(fixture, 'content/articles'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'content/site.json'), '{"featuredIds":[]}');
    fs.writeFileSync(path.join(fixture, 'content/quotes.json'), '[]');
    assert.deepEqual(loadContent(fixture), { articles: [], featuredIds: [], quotes: [] });
  } finally {
    assert.ok(path.resolve(fixture).startsWith(path.resolve(cache) + path.sep));
    fs.rmSync(fixture, { recursive: true });
  }
});

test('失效推荐、失效金句关联与重复金句 ID 都会阻止构建', () => {
  const cache = path.join(root, '.cache');
  fs.mkdirSync(cache, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(cache, 'content-test-'));
  const write = (name, value) => fs.writeFileSync(path.join(fixture, 'content', name), JSON.stringify(value));
  try {
    fs.mkdirSync(path.join(fixture, 'content/articles'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'content/articles/example.md'), front + '正文');
    write('quotes.json', []);
    write('site.json', { featuredIds: ['missing'] });
    assert.throws(() => loadContent(fixture), /推荐文章不存在/);
    write('site.json', { featuredIds: ['example'] });
    const quote = { id: 'quote-test', text: '摘句', attribution: '演示', articleId: 'missing', sourceUrl: '', demo: true };
    write('quotes.json', [quote]);
    assert.throws(() => loadContent(fixture), /关联文章不存在/);
    quote.articleId = 'example';
    write('quotes.json', [quote, quote]);
    assert.throws(() => loadContent(fixture), /金句 ID 重复/);
  } finally {
    assert.ok(path.resolve(fixture).startsWith(path.resolve(cache) + path.sep));
    fs.rmSync(fixture, { recursive: true });
  }
});
