# 子非秋月 · 纸本文案站

淡黄色纸面与简线的非官方静态阅读站。首页、目录和阅读页都可以直接打开，没有在线编辑器。

## 浏览网站

双击 `index.html`，无需安装依赖、启动服务器或联网。仓库已包含生成的文章内容和本地示例图片。

## 目录约定

```text
├── index.html / articles.html / read.html  页面入口
├── content/                              手动维护的内容
│   ├── articles/                         一篇文章一个 Markdown 文件
│   ├── quotes.json                       金句、出处、文章关联
│   └── site.json                         首页推荐文章 ID
├── assets/
│   ├── css/site.css                      全站与 Markdown 排版
│   ├── js/main.js                        页面渲染
│   ├── images/<文章ID>/                  该篇文章使用的图片
│   └── generated/content.js              构建结果，勿直接修改
├── scripts/build-content.cjs             内容构建与检查
├── tests/content.test.cjs                Markdown 与内容检查测试
└── docs/content-guide.md                 写作格式与新增流程
```

Markdown 是唯一的文章正文来源；不再维护重复的段落数组。文件名（去掉 `.md`）就是文章 ID，旧文章链接保持有效。原有六篇演示文章和三条摘句已保留。

## 修改内容

首次修改前安装 Node.js（含 npm），在项目目录运行一次：

```sh
npm ci
```

1. 在 `content/articles/` 新建或修改 `.md` 文件，使用 YAML 文件头填写标题、日期、类型和摘要。
2. 将配图放到 `assets/images/<文章ID>/`；正文用标准 Markdown 图片语法引用。
3. 在 `content/quotes.json` 维护金句，在 `content/site.json` 维护推荐 ID。
4. 运行构建，刷新浏览器：

```sh
npm run build
```

构建自动扫描全部 Markdown 文件，检查日期、推荐引用、金句关联及本地图片，成功后更新 `assets/generated/content.js`。浏览器只读取这个本地脚本，不通过 `fetch()` 加载 Markdown，因而支持 `file://`。修改源文件后必须重新构建；提交 Git 时，源文件和生成文件一起提交。

正文支持分级标题、**粗体**、*斜体*、删除线、引用、图片、链接、列表、分隔线、表格和代码。原生 HTML 会被转义为普通文本；标题与正文的字体家族由样式统一设置。完整示例见 [内容维护说明](docs/content-guide.md)。

## 检查

```sh
npm test
npm run check
```

`npm test` 检查 Markdown 显示、安全转义和异常内容；`npm run check` 检查内容有效性及生成文件是否过期，不修改文件。

## 内容说明

现有正文、标题、日期与金句均为演示内容，不是子非秋月的原始文案。示例配图为本站绘制的线描，不是原视频画面。文章和金句各自用 `demo: true` 标识演示状态。

添加真实内容时，核对正文、视频日期和出处，并确认转载许可；只有核验后的内容才将 `demo` 改为 `false`。金句不能仅因关联了一篇文章就视为作者原话。站点保持非官方标识。

项目使用本地 Git，未连接远程仓库。尚无账号、点赞、评论或在线发布；不保存访客数据。
