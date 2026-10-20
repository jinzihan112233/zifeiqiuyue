const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const MarkdownIt = require('markdown-it');

const projectRoot = path.resolve(__dirname, '..');
const requireText = (value, name) => assert.ok(typeof value === 'string' && value.trim(), `${name} 必须是非空文本`);
const checkSource = (value, name) => {
  assert.equal(typeof value, 'string', `${name} 必须是字符串，没有来源时填 ""`);
  if (value) assert.ok(['https:', 'http:'].includes(new URL(value).protocol), `${name} 必须是网页链接`);
};

function compileArticle(source, filename, root = projectRoot) {
  source = source.replace(/^\uFEFF/, '');
  assert.match(source, /^---\r?\n/, `${filename} 须以 YAML 文件头开始`);
  const { data, content } = matter(source);
  for (const key of ['title', 'published', 'type', 'description']) requireText(data[key], `${filename}: ${key}`);
  assert.match(data.published, /^\d{4}-\d{2}-\d{2}$/, `${filename}: 日期须用引号包裹，格式为 YYYY-MM-DD`);
  assert.equal(new Date(data.published).toISOString().slice(0, 10), data.published, `${filename}: 日期不存在`);
  checkSource(data.sourceUrl, `${filename}: sourceUrl`);
  assert.equal(typeof data.demo, 'boolean', `${filename}: demo 须为 true 或 false`);
  requireText(content, `${filename}: 正文`);

  const markdown = new MarkdownIt({ html: false });
  const renderImage = markdown.renderer.rules.image;
  markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
    const image = tokens[index];
    requireText(image.content, `${filename}: 图片替代文字`);
    const sourceUrl = image.attrGet('src');
    if (/^https?:\/\//i.test(sourceUrl)) {
      new URL(sourceUrl);
    } else {
      assert.ok(!/^[a-z][a-z\d+.-]*:/i.test(sourceUrl) && !sourceUrl.startsWith('//'), `${filename}: 图片须为本地文件或 HTTP(S) 链接`);
      const absolute = path.resolve(path.dirname(filename), decodeURIComponent(sourceUrl));
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      assert.ok(relative.startsWith('assets/images/'), `${filename}: 本地图片须存放在 assets/images/ 内`);
      assert.ok(fs.existsSync(absolute) && fs.statSync(absolute).isFile(), `${filename}: 图片不存在：${sourceUrl}`);
      image.attrSet('src', relative.split('/').map(encodeURIComponent).join('/'));
    }
    image.attrSet('loading', 'lazy');
    image.attrSet('decoding', 'async');
    return renderImage(tokens, index, options, env, renderer);
  };
  return {
    id: path.basename(filename, '.md'),
    title: data.title,
    published: data.published,
    type: data.type,
    description: data.description,
    sourceUrl: data.sourceUrl,
    demo: data.demo,
    html: markdown.render(content)
  };
}

function loadContent(root = projectRoot) {
  const articleDirectory = path.join(root, 'content/articles');
  const articles = fs.readdirSync(articleDirectory).filter(file => file.endsWith('.md')).sort().map(file => {
    const filename = path.join(articleDirectory, file);
    return compileArticle(fs.readFileSync(filename, 'utf8'), filename, root);
  });
  assert.ok(articles.length, '至少需要一篇文章');
  const ids = new Set(articles.map(article => article.id));
  assert.equal(ids.size, articles.length, '文章 ID 不能重复');
  const { featuredIds } = JSON.parse(fs.readFileSync(path.join(root, 'content/site.json'), 'utf8'));
  assert.ok(Array.isArray(featuredIds) && featuredIds.length, '推荐列表不能为空');
  assert.equal(new Set(featuredIds).size, featuredIds.length, '推荐 ID 不能重复');
  for (const id of featuredIds) assert.ok(ids.has(id), `推荐文章不存在：${id}`);

  const quotes = JSON.parse(fs.readFileSync(path.join(root, 'content/quotes.json'), 'utf8'));
  assert.ok(Array.isArray(quotes), '金句须存为数组');
  const quoteIds = new Set();
  for (const quote of quotes) {
    for (const key of ['id', 'text', 'attribution']) requireText(quote[key], `金句 ${key}`);
    assert.ok(!quoteIds.has(quote.id), `金句 ID 重复：${quote.id}`);
    quoteIds.add(quote.id);
    assert.equal(typeof quote.demo, 'boolean', `${quote.id}: demo 须为 true 或 false`);
    checkSource(quote.sourceUrl, `${quote.id}: sourceUrl`);
    assert.ok(quote.articleId === null || ids.has(quote.articleId), `${quote.id}: 关联文章不存在`);
  }
  return { articles, featuredIds, quotes };
}

function serializeContent(data) {
  return '// 自动生成：请修改 content/ 内的源文件后运行 npm run build。\nwindow.SITE_DATA = ' + JSON.stringify(data, null, 2) + ';\n';
}

if (require.main === module) {
  try {
    const data = loadContent();
    const output = path.join(projectRoot, 'assets/generated/content.js');
    const result = serializeContent(data);
    if (process.argv.includes('--check')) {
      assert.ok(fs.existsSync(output), '内容尚未生成，请运行 npm run build');
      assert.equal(fs.readFileSync(output, 'utf8'), result, '生成文件已过期，请运行 npm run build');
      console.log('内容检查通过，生成文件与源文件一致。');
    } else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, result);
      console.log(`已构建 ${data.articles.length} 篇 Markdown 文章、${data.quotes.length} 条金句。`);
    }
  } catch (error) {
    console.error('内容构建失败：' + error.message);
    process.exitCode = 1;
  }
}

module.exports = { compileArticle, loadContent, serializeContent };
