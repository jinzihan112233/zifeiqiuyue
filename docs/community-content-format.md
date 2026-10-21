# 社区内容与内容包规范（P2 / v1）

本规范适用于新社区。旧静态站的 `content/` 暂时继续使用原格式和构建脚本；不要把两者当成自动同步的内容库。

## 1. 内容身份与状态

- `stableId`：跨数据库导入导出的稳定标识。禁止重新生成已有内容或快照的稳定标识。
- `slug`：链接标识，沿用旧文章文件名，全站唯一；改标题不改 slug。
- `kind`：`article` 为站方文章，`post` 为社区帖子。编辑只能维护自己名下的站方文章；管理员可以管理全部内容。
- `visibility`：`unpublished/public/hidden`。与提交的 `pending/approved/returned/withdrawn` 状态分开。
- 工作稿可以修改，提交稿冻结，发布快照不可修改。导入源更新仅更新工作稿，不替换已有公开快照。
- “站方文章”不是“作者官方授权”的声明；站点继续显示非官方标识。

## 2. 文章结构与元数据

站方文章依次且各一次使用顶层二级标题 `开头`、`简介`、`正文`、`后记`，章节不能为空。章节内部使用三级或更低级标题。文章标题在元数据中，不重复放入正文。简介须有文字，列表摘要从简介派生。

缺少章节仍能保存为草稿，提交和发布会拒绝。社区帖子自由使用 Markdown，不要求四段结构。模板见 [文章模板](templates/community-article.md) 和 [金句模板](templates/community-quote.md)。模板用于示例，实际内容包应由导出命令生成完整清单。

| 字段 | 用途 |
| --- | --- |
| `title` | 标题，最多 200 字符 |
| `metadata.category` | 栏目，最多 100 字符 |
| `metadata.demo` | 是否为演示内容；文章与金句独立维护 |
| `metadata.sourceUrl` | HTTP(S) 来源链接，没有时为空字符串 |
| `metadata.originalVideoDate` | 已核验的原视频日期，`YYYY-MM-DD`；未核验时为空 |
| `metadata.legacyDate` | 原数据日期，供整理参考，不自动认定为视频日期 |
| 快照 `publishedAt` | 本站发布版本的时间；归档恢复保留该版本原发布时间 |
| `createdAt` | 系统实际创建记录的时间；导入不伪造 |

旧 `description` 仅存在迁移来源记录/内容包的 `legacy.description` 中，不是第二份可编辑摘要。初次迁移不自动将它改写为简介。

## 3. Markdown 与媒体

支持标题、粗体、斜体、删除线、引用、列表、表格、代码、分隔线和图片。HTML 被转义，危险链接由共用 Markdown 渲染器过滤。预览和发布使用相同渲染器。

- 数据库 Markdown 图片：`![图片说明](media:123)`。
- 内容包 Markdown 图片：`![图片说明](../media/稳定媒体ID.webp)`，版本文件相应使用两层相对路径。
- 图片必须有替代文字，只能引用本包媒体或数据库中获准使用的媒体。
- 不接受远程图片、`data:` 图片和任意嵌入，不自动抓取外部资源。
- 上传输入仅 JPEG/PNG/WebP，最大 5 MiB、单边不超过 8192 像素；转为 WebP 后也不得超过 5 MiB。
- 新上传统一无损 WebP；导入已经验证的历史 WebP 保留原始字节和哈希，缩略图由受控处理生成。
- 迁移支持普通行内图片及单行引用式图片；不能安全转换的复杂目标语法会报错，须先人工整理，不猜测改写。
- 旧仓库内的可信 SVG 做一次转换，原文件仍保留在仓库，并记录原路径、原哈希、媒体稳定 ID；不因此允许上传 SVG。

待审媒体及缩略图为私有；公开内容的历史快照引用可公开读取。下架后若没有其他公开内容引用，该图片不再向游客提供。

## 4. 内容包目录

```text
content-export/
├─ manifest.json           格式版本、内容清单、文件哈希、关联映射
├─ articles/<slug>.md      站方文章：工作稿或默认导出的公开版
├─ posts/<slug>.md         社区帖子
├─ versions/<内容ID>/      不可变发布版本，各自一个 Markdown 文件
├─ quotes/<金句ID>.md      一条金句一个文件
├─ media/<媒体ID>.webp     原图；缩略图导入时重新生成
└─ site.json               站点简介、推荐稳定标识与顺序
```

只创建实际有内容的子目录。`manifest.json` 是关联及哈希清单，不是第二份文章正文。文件头中的 `trailingNewline` 保存原正文末尾是否有换行，供无损往返使用。

金句文件头保存 `stableId/attribution/sourceUrl/demo/order/enabled/content/snapshot`，正文是摘句文本。关联内容与版本均使用稳定标识，不能使用另一套数据库的数字 ID。独立金句的两个关联均为 `null`。关联文章不代表摘句自动成为作者原话。

金句可关联历史发布版本；文章下架时，关联金句和推荐通过服务端公开查询隐藏。缺少版本的旧关联金句只作为禁用记录迁入，等待编辑指定版本。

## 5. 导入规则

1. `preview` 读取文件、校验结构/媒体/哈希，生成只读预览；不会写数据库和媒体目录。
2. `import` 必须提供预览报告。执行时再次核对来源、数据库修订及冲突。
3. 新标识创建内容；已导入且相同的内容跳过。
4. 源文件改变且数据库未变：更新工作稿，保留当前公开版本。
5. 数据库已有在线修改、slug 冲突或标识冲突：整批拒绝写入，保留在线修改。
6. 数据库写入在同一事务中进行；普通异常回滚时，只清理本次生成的 UUID 媒体及派生文件。
7. 普通导入默认不公开新内容；归档恢复只有管理员显式指定 `--restore-publication` 才恢复包中的发布/隐藏状态。

需要保留被在线修改的记录时，先备份并导出两份内容，人工合并后通过正常编辑发布；不提供强制覆盖开关。

## 6. 常用命令

在项目根目录运行；本地配置与账号须先按 P1 说明准备。

```powershell
# 旧静态站 -> 社区草稿，先预览后导入
npm run content:transfer -- preview --legacy --report=.local/import-preview.json
npm run content:transfer -- import --legacy --report=.local/import-preview.json

# 默认只导出公开内容；目标必须是不存在的新目录
npm run content:transfer -- export --directory=.local/export-public-001

# 明确包含草稿、隐藏内容；该内容包应按私有资料保存
npm run content:transfer -- export --include-drafts --directory=.local/export-private-001

# 人工修改内容包 Markdown 后，显式重算并校验文件清单
npm run content:transfer -- seal --directory=.local/export-private-001

# 内容包导入；--test 表示使用隔离测试库及其媒体目录
npm run content:transfer -- preview --test --directory=.local/export-private-001 --report=.local/package-preview.json
npm run content:transfer -- import --test --directory=.local/export-private-001 --report=.local/package-preview.json
```

`seal` 不解决在线冲突，也不修改数据库。错误的章节可保存在工作稿中，已发布历史版本必须合法，不能借此改写快照。

CLI 仅允许本机开发库/测试库；默认使用本地管理员，`--user=editor` 可选择已有编辑账号。它是本机维护工具，不是公开认证接口，不应将终端权限提供给不可信用户。

## 7. 来源切换与 Git

当前：旧静态站以 `content/` 为主来源，运行 `npm run build` 更新离线数据；社区工作台以数据库显示已导入内容。仓库修改不会实时覆盖数据库。

P9 正式切换后：数据库为在线唯一主来源，Markdown 用于显式导入、导出和归档；不运行自动双向同步。

`src/` 保存应用与业务模块，`src/migrations/` 保存版本化结构迁移，`scripts/` 保存本机维护命令，`tests/` 保存合成测试，`docs/` 保存规范与记录。`.local/`、`storage/`、`backups/`、`.env.local` 不进入 Git。不要将含私有草稿的导出包直接上传 GitHub。

内容包不包含账号、密码、会话、评论、批注、审核历史和管理记录；需要恢复整站时使用数据库与媒体备份。快照保留规范文本和渲染版本；不支持的渲染版本必须停止导入，不能猜测批注位置。
