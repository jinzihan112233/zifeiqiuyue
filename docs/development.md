# 开发与维护指南

本仓库包含离线站和社区应用两条独立运行路径。仅阅读离线站时直接打开根目录 `index.html`；以下准备供社区开发使用。

## 环境与首次安装

`package.json` 要求 Node.js >=20.19.0；已有阶段验证环境为 Node.js 24.20.0、npm 11.19.0 和 PostgreSQL 17.11。依赖精确版本与 `package-lock.json` 一起提交，使用 `npm ci` 安装。

内置数据库脚本针对 Windows PowerShell 和本机 PostgreSQL 17。它不是跨平台安装器，也不下载数据库程序。从 PostgreSQL 官方 Windows 下载入口获取二进制包并解压，确认存在：

```text
.local/postgres/pgsql/bin/pg_ctl.exe
.local/postgres/pgsql/bin/initdb.exe
.local/postgres/pgsql/bin/pg_dump.exe
.local/postgres/pgsql/bin/pg_restore.exe
```

在仓库根目录执行：

```powershell
npm ci
npm run db:start
npm run app:migrate -- --test
npm run app:migrate
npm run app:seed
npm run app:importmap
npm run app:typecheck
npm run app:build
npm run app:start
```

`db:start` 在 `127.0.0.1:55432` 准备独立数据库集群、应用和迁移角色，并首次生成 `.env.local`。不要预先把 `.env.example` 的占位值复制成有效配置；脚本不会覆盖已有 `.env.local` 或重置已有角色密码。

当前迁移与恢复工具限制连接本机、使用固定命名的专用数据库；不能直接把这些命令当作任意数据库或生产环境的安装教程。其他系统需要自行准备等价环境，仓库未提供对应启动脚本。

## 登录与页面

打开 [本地首页](http://127.0.0.1:3000/)，在 `/login` 登录后进入 `/workspace`。`/admin` 是 Payload 后台；内容保存、提交和审核应走工作台受控入口。

`/lab/read/<数字ID>` 是早期验证保留的兼容阅读入口，通过原有受控 API 读取数据，不代表可绕过公开状态或版本权限。正式文章与帖子分别使用 `/articles/<slug>`、`/posts/<slug>`；评论与回复在阅读页“读后回响”，管理员举报队列在 `/workspace/discussions`，使用说明见 [P6 记录](history/phase-6-validation.md)。关联历史版本统一使用 `?version=<快照稳定ID>`。新页面和首页金句不再生成 `/lab/` 链接。

`app:seed` 准备 admin、editor、membera、memberb、blocked 五个本地验证账号；blocked 为封禁样例。随机密码只保存在 `.local/p1-accounts.json`，这是沿用早期初始化的文件名，不表示应用仍停留在 P1。重复初始化保留原密码；已有账号而凭据文件丢失时脚本会报错，不擅自重置账号。

管理员从 `/account/invitations` 生成邀请码；受邀者在 `/register` 注册并保存恢复码。账号安全设置在 `/account/security`，账号恢复入口为 `/recover`。旧初始化账号首次生成恢复码需验证密码。

新数据库不会自动得到历史测试内容。可按 [内容维护指南](content-guide.md) 显式预览并导入离线演示文章；这些文章缺少四段结构，导入不会补写正文或自动发布。

## 日常命令

| 命令 | 用途 |
| --- | --- |
| `npm run app:dev` | 开发服务器，监听本机 3000，使用 webpack |
| `npm run app:build` / `npm run app:start` | 构建并运行生产模式；先构建再启动 |
| `npm run app:typecheck` | TypeScript 检查 |
| `npm run app:importmap` | 生成 Payload 后台映射，生成文件纳入 Git |
| `npm run app:migrate -- --create --name=说明` | 结构变更时生成迁移；审阅后提交，不在每次启动时执行 |
| `npm run app:migrate -- --test` / `npm run app:migrate` | 先在测试库验证，再应用到开发库；已有数据先备份 |
| `npm run db:start` / `npm run db:stop` | 启停项目专用数据库集群 |
| `npm run build` / `npm test` / `npm run check` | 仅构建、测试和检查离线内容；`check` 不写文件 |

开发与生产服务器不能同时占用 3000；在运行应用的终端用 Ctrl+C 停止后切换。修改源内容后同时提交 `content/` 与 `assets/generated/content.js`，不要手改生成文件。

## 检查与数据库测试

无需数据库的离线检查：

```sh
npm test
npm run check
```

类型检查使用 `npm run app:typecheck`。数据库和 HTTP 集成测试需要已准备好的专用测试库、迁移、有效 `.env.local` 以及最新生产构建，按顺序执行：

```powershell
npm run test:community
npm run test:content-community
npm run test:reading
npm run test:accounts
npm run test:publication
npm run test:discussion
npm run test:annotations
```

各套件使用合成内容和本机测试库，可能清理或更改测试数据。HTTP 套件共用 3100 端口，不要并行运行；开发库不作为测试目标。历史测试结果见 [阶段记录](history/README.md)，不能用自动测试替代视觉、键盘与真机验收。

## 备份与恢复边界

`npm run content:backup` 备份本机开发/测试库的 `community` schema、已有媒体、清除清单及源文件哈希；`npm run content:audit` 对开发内容作只读检查。私密输出不得上传 GitHub。

`npm run app:restore-check` 将测试库的 `community` schema 恢复到指定隔离恢复库，并检查数据、媒体与恢复后的读写；会覆盖目标 schema 中对应的对象。`npm run content:roundtrip` 使用内容测试写出的 `.local/p2-roundtrip-source.txt`，重建恢复库的 `community` schema 并检查内容包往返；两项演练均不涵盖 PostgreSQL 集群角色、全部数据库或生产环境的完整灾难恢复。

敏感清除清单在 `.local/purge-ledger/` 独立保存。恢复旧备份后必须先在隔离环境核对最新清单并重放，再开放读取；`content:replay-purges` 会实际清除数据。具体命令、不可逆影响与备份限制见 [内容管理记录](history/phase-5-validation.md)。

应用仍限本机使用。公网可信代理、HTTPS、生产存储、备份保留策略和统一安全审查属于后续工作，见 [路线图](community-build-roadmap.md)。


## 仓库结构与协作

### 文件职责

| 路径 | 职责 |
| --- | --- |
| `src/app/(frontend)/` | 公开阅读、账号页面、工作台及前台样式 |
| `src/app/(payload)/` | Payload 后台与框架 REST 接口 |
| `src/app/api/account/`、`src/app/api/community/` | 本站受控账号与内容接口 |
| `src/components/` | 阅读、导航、账号和内容管理组件 |
| `src/modules/` | 业务权限、事务、内容格式、渲染、迁移与公开读取 |
| `src/collections/`、`src/payload.config.ts` | Payload 集合、访问约束和应用配置 |
| `src/migrations/` | 显式数据库迁移、结构快照及迁移索引 |
| `content/`、`assets/`、根目录 HTML | 离线站源内容、资源与入口 |
| `scripts/` | 静态构建、数据库、初始化、导入导出、审计与恢复工具 |
| `tests/` | 离线内容测试、社区数据库与 HTTP 集成测试 |
| `docs/history/` | 历史计划和验证证据，区别于当前使用指南 |

阅读业务代码可先从 `public-reading.ts`（公开读取）、`community.ts`（稿件/发布/批注）、`accounts.ts`（账号）、`content-management.ts`（管理与清除）、`discussion.ts`（评论/举报/讨论状态）、`content-transfer.ts`（内容包）进入。稳定路由、迁移文件名和已有内容标识保持兼容。

### 来源与生成物

```text
离线：content/ → scripts/build-content.cjs → assets/generated/content.js → 根目录 HTML
社区：页面/业务 API → src/modules/ → PostgreSQL + 私有媒体 → 公开发布快照
迁移：仓库内容/内容包 → 显式预览与导入；数据库 → 显式导出包
```

两条内容来源互不实时覆盖。数据库中的账号、草稿、批注和发布快照不靠 Git 保存。

以下生成文件需跟踪：`assets/generated/content.js`（离线必需）、`src/app/(payload)/admin/importMap.ts`（后台组件映射）、`src/migrations/*.json`（结构快照），以及依赖锁文件。`.next/`、`out/`、`*.tsbuildinfo` 等构建缓存忽略。

`.editorconfig` 和 `.gitattributes` 统一 UTF-8、LF、两空格；避免只为格式批量重写正文。框架生成的 `AGENTS.md` 保留，修改 Next.js 代码前阅读安装包内对应版本的 `node_modules/next/dist/docs/`。

### 上传 GitHub 前

1. 阅读 `git status --short` 和 `git diff --stat`，确认每项变更都属于本次提交。
2. 使用 `git diff --check` 检查空白错误；按上文“检查与数据库测试”运行受影响的检查。
3. 检查 `git ls-files`，确认未跟踪 `.env.local`、`.local/`、`storage/`、`uploads/`、`backups/`、数据库转储、真实凭据或私有内容包。仅有 `.gitignore` 无法保护已经跟踪的文件。
4. 检查暂存内容 `git diff --cached`；分享源码使用干净克隆或 Git 跟踪文件，避免把本地运行数据一起压缩上传。
5. 上传前也检查历史提交中的敏感内容；当前工作树没有秘密不代表历史没有。若曾提交真实密钥，应先轮换，再处理历史。

仓库提供 `.env.example` 变量模板，不包含有效凭据。本地账号文件仍沿用 `p1-accounts.json`，备份/测试输出也可能沿用早期阶段前缀；它们属于私密运行文件，保留名称以兼容已有工具。

本项目原创代码、文档与演示内容采用 [MIT 许可证](../LICENSE)。第三方依赖保留各自许可证，真实作者内容及其他第三方材料须另行核对授权，不能沿用本项目或依赖的许可证。

## 精确批注（P7）

阅读页支持选字及键盘原文查找创建，侧栏支持分页、定位与原版本链接。规则见 [批注与版本阅读](annotation-guide.md)，接口、迁移和实测记录见 [P7 验证](history/phase-7-validation.md)。
