# 本机公网部署

当前阶段为部署准备，不能将这些命令执行成功视为已完成公网验收。运行完整 Next.js/Payload 应用，保留账号、审核、媒体、评论、举报和版本批注。

## 访问链路

访客 HTTPS 域名 → Cloudflare Tunnel → `http://127.0.0.1:3010` → 本机 PostgreSQL 与私有媒体。开发站仍使用 3000；数据库只监听 `127.0.0.1:55432`。不要给 3000、3010、55432 设置公网端口映射。

正式 Tunnel 需要维护者自己的域名和 Cloudflare 账号。Quick Tunnel 仅用于链路测试，不能作为稳定发布入口。大陆访问效果应由真实手机网络验证。

## 生产环境准备

先按开发指南准备本机 PostgreSQL 二进制和独立集群，再执行：

```powershell
npm run prod:prepare -- --origin=https://你的域名
npm run prod:migrate
npm run prod:admin
npm run prod:build
npm run prod:start
```

`prod:admin` 在本机终端隐藏输入初始密码，要求 12–128 个字符，不回显、不保存明文，不使用聊天里出现过的密码。已有管理员时初始化保持其密码不变。首次通过正式域名登录后，在账号安全页生成恢复码并离线保存。

准备命令创建独立 `zifeiqiuyue_prod`、`zifeiqiuyue_prod_restore` 数据库及专用应用/迁移角色，不复制开发或测试账号和内容。重复准备保留已生成的生产秘密，不重置数据库密码。

私密配置分别为 `.env.deploy.local`（应用）、`.env.deploy-migrate.local`（迁移）和 `.local/production-access.json`（本机配置恢复资料）。这些文件必须限制 Windows 文件权限，不进入 Git 或普通源码压缩包。使用显式加载，避免 Next.js 自动加载生产配置污染开发和测试。

生产媒体在 `storage/production-media/`，独立清除清单在 `.local/production-purge-ledger/`，构建产物在 `.next-production/`。启动器不把开发库、迁移角色或初始管理员密码提供给正常运行的应用。

## 域名与入口

1. 在自己的账号中注册域名，检查续费价格并启用双重验证。
2. 将域名加入 Cloudflare，选择所需 DNS 方案，在注册商处将权威域名服务器改为 Cloudflare 分配的两个地址，等待激活。
3. 在 Cloudflare 的 Tunnels 中建立正式 Tunnel，按控制台提供的 Windows 安装方式配置连接器；令牌仅保存在本机受限位置。
4. 为选定域名建立 Published application，服务地址为 `http://127.0.0.1:3010`。保留原始 Host/Origin，不把用户 Cookie 和业务响应缓存到共享 CDN。
5. 仅在 Tunnel 入口下信任 `CF-Connecting-IP`。应用使用按访客 IP 与账号分别限流，缺少合法代理 IP 的生产写请求会被拒绝。不要额外公开回环服务。

修改正式域名后，重新运行带 `--origin=` 的准备命令，并重新构建、重启生产应用；它会更新域名但保留既有数据库秘密。

## 备份与恢复检查

```powershell
npm run prod:backup
npm run prod:restore-check -- --backup=backups/production-实际时间戳
```

备份在短暂阻塞业务写入的锁内保存数据库、媒体及当时的清除清单；文件位于私有 `backups/`。验证命令只覆盖专用生产恢复库，比较表记录数、媒体哈希与引用，并验证恢复库写入。备份需要另存到受保护的异机位置；本机同盘备份不能抵御硬盘故障。

这项检查不是完整事故恢复：未包含集群角色与 Windows 配置，恢复旧备份后还必须取得**最新**独立清除清单并在隔离环境重放，完成前不能开放读取。不能直接把开发版恢复工具指向生产库。

## 正式开放前的运行要求

- 用独立普通 Windows 服务账号与专用发布目录运行应用；不要把 Administrator 桌面下的手动启动进程作为长期部署。
- 为 PostgreSQL、生产应用及 cloudflared 配置开机运行、异常重启和明确的工作目录；修改 Windows 权限时只授予必要目录的读写权限。
- 禁止睡眠导致服务中断；安排系统更新维护窗口、备份计划和磁盘/服务异常通知。
- 默认每账号媒体预算为 100 MiB，可通过私密配置 `MEDIA_QUOTA_MIB` 调整。保留 5 MiB 单图、像素与解码验证，上传前检查磁盘余量。
- 首次公网验收覆盖 HTTPS、登录退出、恢复码、邀请注册、图片隐私、投稿审核、评论批注、下架和清除；检查草稿、私有图片、历史版本和 Cookie 不被代理缓存。
- 当前 CSP 只限制对象、基础 URL 和页面嵌入，未宣称为完整脚本注入防护。依赖告警需按生产可达性持续核查。

域名激活、独立服务账号、自启动、异机备份及完整公网验收没有完成前，保持“部署准备”状态。
