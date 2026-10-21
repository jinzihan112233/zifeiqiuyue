# 子非秋月 · 为您讲述

淡黄色纸面与简线的非官方阅读站。仓库同时保留可直接打开的静态版本，以及本机运行的社区阅读与内容整理应用。

## 本地社区验证应用

P1 已接通用户名密码登录、冻结投稿、审核、发布版本、私有图片和选字批注；P2 增加四段文章、金句与推荐管理、可重复导入导出；P3 已接入公开阅读；P4 增加邀请码注册、恢复码、账号安全与个人中心。应用使用本机 PostgreSQL 数据库及演示内容，尚未上线。

当前环境运行 `npm run db:start`，再运行 `npm run app:start`，访问 `http://127.0.0.1:3000/`。本地随机测试账号在 `.local/p1-accounts.json`，不要提交或公开该文件。开发模式使用 `npm run app:dev`，启动生产模式前先运行 `npm run app:build`。

从新检出准备数据库、迁移、初始化账号、运行 18 项社区测试与恢复演练，见 [P1 实现与验证记录](docs/phase-1-validation.md)。

## 浏览静态网站

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

原静态版本不保存访客数据。新增社区验证应用保存本机账号、合成稿件、图片和批注；注册需要邀请码，点赞和完整评论回复仍未实现。项目没有自动推送或外部部署。

## 社区建设规划

后续邀请码注册、投稿审核、评论回复与文本批注的分阶段任务、架构约定、风险检查和验收方式，见 [微型社区项目构建流程](docs/community-build-roadmap.md)。该文档描述未来建设计划，不表示这些功能已经实现。

P0 的内容迁移清单、旧链接映射、角色权限与状态约定见 [P0 阶段交付与实施约定](docs/phase-0-foundation.md)。P1 的实际实现、检查结果、依赖告警和限制见上方验证记录。P2 的文章模型、四段格式、金句与导入导出已经实现，见 [P2 实现与验证记录](docs/phase-2-validation.md)。P3 已获使用者初步验收，后续仍需统一漏洞审查；专项检查记录见 [P3 实现与验证记录](docs/phase-3-validation.md)。P4 的实现、使用教程与 70 项自动测试记录见 [P4 实现与验证记录](docs/phase-4-validation.md)。

## 投稿、审核与社区来信（P5）

工作台已支持分页、独立编辑、图片插入、修订冲突保留、冻结提交及审核对照。公开帖子入口为 `/community` 和 `/posts/<slug>`；站方文章继续使用 `/articles`。

管理员可填写理由审核、下架和恢复，也可预检并明确确认敏感清除。清除会处理历史稿、引用摘录和独占媒体，独立清除清单用于防止旧备份重新公开已清除内容。教程、88 项自动测试及人工待验收项目见 [P5 实现与验证记录](docs/phase-5-validation.md)。

## 邀请码与个人中心（P4）

在 `/login` 登录，管理员通过 `/account/invitations` 生成邀请码；受邀者在 `/register` 注册并保存一次性恢复码。`/account` 查看自己的草稿、审核意见、公开状态与批注；`/account/security` 修改昵称、密码和恢复码；忘记密码时使用 `/recover`。

原本地初始化账号继续有效，没有自动重置密码；首次使用时请到账号安全页验证密码并生成恢复码。密码或权限变化、封禁、恢复账号后旧会话失效。邀请码和恢复码只保存哈希，不进入 Git。

本机所有请求共享本地 IP 限流桶，不接受伪造的转发 IP；公网部署前需配置可信代理及 HTTPS。浏览器视觉、键盘和真机专项检查仍待完成。

## 公开阅读与内容工作台（P3）

新应用首页为 `/`，目录为 `/articles`，阅读页为 `/articles/<slug>`，工作台迁至 `/workspace`。旧 `/lab/read/<数字ID>` 入口保留。通过新应用访问 `read.html?id=...` 时会跳转到对应 slug；原离线 HTML 仍独立运行。

游客只看到公开快照。目录优先按已核验视频日期排序，无视频日期时按本站发布的北京时间日期排序；同日按稳定标识排列，每页 12 篇。历史版本仍关联原批注，文章下架后公开页面及关联入口停止提供内容。

当前开发库的六篇旧文仍未公开，因此首页推荐和目录显示空状态。隔离测试内容只用于验证，不自动发布到开发库。浏览器自动化因无法可靠识别当前 Edge 地址而被安全校验中止；48 项自动测试通过不等于视觉及真机验收已完成。

## 社区文章、金句与迁移（P2）

启动社区应用后，编辑/管理员可创建四段式站方文章，维护栏目、来源、演示标识和已核验视频日期，预览 Markdown；管理员可整理全部内容。金句、首页简介和推荐通过工作台的“站方内容设置”维护。

六篇旧文章已原样迁入开发库草稿，缺少四段时不能提交；不会自动补写文案。三条金句和推荐顺序保留，未公开文章不出现在公开推荐中。旧静态站依然独立运行，仓库修改不会实时覆盖数据库。

规范化内容包使用 `articles/`、`posts/`、`versions/`、`quotes/`、`media/` 和清单文件，支持只读预览、重复跳过、冲突拒绝和往返检查。命令、模板、Git 边界与来源切换规则见 [社区内容与内容包规范](docs/community-content-format.md)。

```powershell
npm run content:transfer -- preview --legacy --report=.local/import-preview.json
npm run content:transfer -- import --legacy --report=.local/import-preview.json
npm run content:transfer -- export --directory=.local/export-public-001
npm run test:content-community
```

导出包含草稿时须显式使用 `--include-drafts`；不要将私有导出包上传 GitHub。内容包不包含账号、评论、批注与审核历史，整站恢复仍需数据库及媒体备份。

## 仓库协作约定

遵守 `.editorconfig` 的 UTF-8、LF 与两空格约定，文本换行同时由 `.gitattributes` 统一；不为调整格式批量重写正文。当前源内容、图片示例及 `assets/generated/content.js` 都应进入 Git，修改源内容后依次运行 `npm run build`、`npm test`、`npm run check`。

真实环境配置、运行时上传、存储和备份不进入 Git；不含真实值的环境模板和数据库迁移脚本应保留。未来数据库上线后的内容来源切换与目录边界，以 P0 实施约定为准。
