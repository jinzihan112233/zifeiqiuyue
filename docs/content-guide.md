# 文章、图片与金句的存储

## 新建文章

例如创建 `content/articles/example.md`。文件名 `example` 是稳定的文章 ID，对应 `read.html?id=example`；改名会改变链接。

```markdown
---
title: "文章标题"
published: "2026-10-21"
type: "人物独白"
description: "用于首页卡片的一两句摘要。"
sourceUrl: ""
demo: true
---

这里是一段正文，可以包含**粗体**、*斜体*和~~删除线~~。

## 一 · 正文小标题

### 更细一级的标题

> 这里是引用段落，仍需核实出处。

![图片内容的文字描述](../../assets/images/example/landscape.webp "可选的图片说明")

- 无序列表
- 第二项

1. 有序列表
2. 第二项

[原始作品](https://www.bilibili.com/)

---
```

模板中的图片地址是示例，使用前请先放入真实图片，否则构建会报错。首页文章主标题来自 `title`，正文建议从 `##` 开始。日期必须加引号，使用 `YYYY-MM-DD`；真实文章填写原视频发布日期，演示文章填写示例日期并保持 `demo: true`。

现有 `libai.md` 展示标题、粗体、斜体和本地图片；`freedom.md` 展示引用段落。Markdown 不负责自由选择字体家族、字号或颜色，这些由 `assets/css/site.css` 统一控制，以保持纸本风格。

## 图片

- 存放位置：`assets/images/<文章ID>/`，文件名建议简短、明确。
- 本地图片路径相对于当前 Markdown 文件，例如 `../../assets/images/libai/road-to-changan.svg`；构建会转换为网页可访问的路径。
- 可使用 PNG、JPEG、WebP、AVIF、GIF 或 SVG 等浏览器支持的格式，不需要额外插件。大照片建议先压缩。
- `![替代文字]` 必须描述图片内容，图片加载失败或使用读屏器时仍能理解。
- 也支持 `https://` 或 `http://` 图片地址，但外链图需要联网，离线浏览建议使用本地图片。
- 引号里的说明是原生悬停提示；需要可见图注时，在图片下另起一段文字。

图片会自适应阅读宽度，保留原始比例并延迟加载，不会挤出手机屏幕。只使用有权使用的图片，不要把示例线描当作视频画面。

## 金句

所有金句集中维护在 `content/quotes.json`，数组顺序就是首页显示顺序。每条保留以下字段：

```json
{
  "id": "quote-example",
  "text": "待展示的句子。",
  "attribution": "出处或署名",
  "articleId": null,
  "sourceUrl": "",
  "demo": true
}
```

- `id` 唯一，不随展示顺序改变；`text`、`attribution` 都不能为空。
- `articleId`：确实出自站内文章时填写文章 ID，否则保留 `null`；构建会检查关联文章存在。
- `sourceUrl`：可填写核验过的网页来源，无来源时保留空字符串。
- 首页署名优先链接到 `articleId` 对应的站内文章；没有关联文章时链接到 `sourceUrl`；两者都为空时仅展示文字。
- `demo` 控制该金句的演示标识；只有核验并明确出处后才改为 `false`。

金句存纯文本，不解析 Markdown，也不从文章里自动随机抽取，避免来源混淆。建议首页保持三条短句。

## 首页推荐

修改 `content/site.json` 的 `featuredIds`，建议保留四个文章 ID：

```json
{
  "featuredIds": ["libai", "freedom", "sushi", "dream"]
}
```

首页按此顺序推荐，全部文章仍按 `published` 日期倒序。新增文章会自动进入目录，不需要修改三个页面的脚本引用。

## 发布前更新

运行 `npm run build`、`npm test`、`npm run check`，再打开网页检查图片和排版。构建失败时先修复提示中的内容问题；之前成功生成的网页内容会保留。

将 `content/`、新增图片和更新后的 `assets/generated/content.js` 一起提交 Git。`node_modules/` 已忽略，不要提交或分发。
