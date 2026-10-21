# 子非秋月 · 为您讲述

淡黄色纸面与简线风格的非官方阅读站，包含可离线浏览的静态网站，以及支持邀请参与、投稿审核与版本阅读的本地社区应用。

仓库当前不附带文章或金句，社区数据库不随源码分发。转载真实内容前须核对出处与授权，文章及金句分别维护 `demo` 标识。

## 当前状态

社区应用使用 TypeScript、Next.js、Payload 和 PostgreSQL，已实现：

- 公开首页、文章目录、社区帖子、历史版本及旧链接兼容。
- 邀请码注册、用户名密码登录、一次性恢复码与个人中心。
- Markdown 工作稿、图片、修订冲突处理、冻结提交、审核发布。
- 金句管理与首页自动推荐、内容包导入导出、下架恢复和敏感清除。
- 绑定发布快照的精确选字批注、原文查找创建、分页、旧版追溯，以及统一评论、连续回复、举报和讨论管理。

P0–P7 已完成本机功能实现；P3 为初步验收，P4/P5/P6 的人工专项仍待验收。P7 的 128 项自动检查、恢复与桌面浏览器实测见 [P7 验证记录](docs/history/phase-7-validation.md)，手机真机、200% 缩放等专项尚待验收。公网部署继续按 [建设路线图](docs/community-build-roadmap.md) 推进；自动测试不代表全面安全审计或生产就绪。

## 快速开始

### 离线阅读

直接打开根目录的 `index.html`，无需安装依赖、启动服务器或联网。文章来自 `content/`，浏览器读取已纳入 Git 的 `assets/generated/content.js`。

修改内容后执行：

```sh
npm ci
npm run build
npm test
npm run check
```

写作格式、图片与金句维护见 [内容维护指南](docs/content-guide.md#离线内容维护)。

### 社区应用

首次运行需安装 Node.js、准备 PostgreSQL 并初始化数据库，按 [开发与维护指南](docs/development.md) 操作。已完成初始化和生产构建的环境可执行：

```powershell
npm run db:start
npm run app:start
```

打开 [本地首页](http://127.0.0.1:3000/)。开发模式使用 `npm run app:dev`；更新代码后使用生产模式须先执行 `npm run app:build`。

| 入口 | 用途 |
| --- | --- |
| `/articles`、`/articles/<slug>` | 站方文章目录与阅读 |
| `/community`、`/posts/<slug>` | 社区帖子目录与阅读 |
| `/login`、`/register`、`/recover` | 登录、邀请注册、恢复账号 |
| `/account` | 个人中心、安全设置与邀请码管理入口 |
| `/workspace` | 发布文章、编辑与审核 |
| `/workspace/discussions` | 管理员举报队列与讨论处理 |
| `/admin` | Payload 管理后台 |

离线站读取仓库文件，社区应用读取数据库，两者不会自动同步。当前默认内容为空，初始化仅创建一个 `admin` 管理员，密码由本地环境变量提供，不写入仓库。测试账号和合成内容只由测试流程创建于专用测试库。

## 仓库导航

```text
src/                  社区应用：页面、组件、业务模块、集合与迁移
content/              离线文章、金句和首页推荐源文件
assets/               离线样式、脚本、示例图片和生成数据
scripts/              静态构建、数据库和内容维护工具
tests/                离线测试及数据库/HTTP 集成测试
docs/                 当前指南、建设路线图、模板及历史阶段记录
index.html 等         离线页面入口，保留旧链接
```

| 文档 | 内容 |
| --- | --- |
| [开发与维护指南](docs/development.md) | 安装、命令、测试、仓库职责和协作 |
| [本机公网部署](docs/local-deployment.md) | 完整应用的生产环境、Tunnel、私密配置与备份 |
| [内容维护指南](docs/content-guide.md) | 离线内容、社区格式、媒体和内容包 |
| [批注与版本阅读](docs/annotation-guide.md) | 规范文本、选字、键盘创建、版本与回退规则 |
| [建设路线图](docs/community-build-roadmap.md) | 当前进展、阶段任务与待验收项 |
| [历史记录](docs/history/README.md) | P0–P7 原计划、交付与验证证据 |

## 上传 GitHub 前

提交源码、锁文件、迁移、示例内容，以及离线内容和后台组件映射等必要生成文件。`.env.local`、`.local/`、`storage/`、`backups/`、上传文件、账号凭据、清除清单及私有导出包不进入 Git。

分享源码不能恢复社区运行数据；数据库、媒体和最新清除清单需独立保管。上传前检查步骤见 [开发与维护指南](docs/development.md#上传-github-前)。

## 开源许可

本项目原创代码、文档与演示内容采用 [MIT 许可证](LICENSE)。第三方依赖保留各自许可证；作者姓名、品牌、真实文案及视频等第三方材料不因本仓库开源而获得授权。本项目为非官方阅读站。
