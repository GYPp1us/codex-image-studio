# 部署与维护

## 环境与目录

以 Ubuntu、Python 3.12、Node.js 24 为例，需要 sudo、Python venv、npm、nginx；使用 Let's Encrypt 时还需 certbot。

| 路径 | 内容 |
| --- | --- |
| `/opt/image-studio/current` | 源码 |
| `/opt/image-studio/venv` | Python 环境 |
| `/opt/image-studio/runtime` | 独立 Codex CLI |
| `/var/lib/image-studio` | 数据库、图片、任务、账户缓存 |
| `/var/backups/image-studio` | 备份目录 |

安装命令见 README。安装脚本优先使用锁定依赖，CLI 固定为已验证版本。服务以 `www-data` 运行，数据目录权限 `0700`，后端监听 `127.0.0.1:8788`。

## 域名与 HTTPS

1. 将自己的域名，例如 `image.example.com`，添加 A 记录指向服务器。
2. 用 `deploy/nginx-http.conf.example` 建立临时站点，替换域名。
3. 建立验证目录，检查 nginx、reload 后申请证书。

```bash
sudo mkdir -p /var/www/image-studio-acme
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/image-studio-acme -d image.example.com
```

4. 用 `deploy/nginx.conf.example` 替换临时配置，修改域名和证书路径。
5. `sudo nginx -t` 成功后 reload。

示例不会自动覆盖其他站点。复用已有域名时，先备份旧 nginx 配置和源码。不要将 CLI 或 OAuth 回调端口暴露到公网。

## 初始化和登录

通过 HTTPS 访问，用 `/var/lib/image-studio/setup-token` 创建自己的管理员账户。密钥只在未初始化时有效，不存在通用默认密码。

引导依次检查 CLI、连接 ChatGPT、验证真实生图。浏览器链接登录支持 SSH 回调转发或手动提交完整回调 URL；设备码作为备选。凭据保存在独立 `codex` 子目录，不返回浏览器。不要公开分享回调 URL、设备码、`auth.json` 和 Cookie。

## 管理

```bash
sudo systemctl status image-studio
sudo journalctl -u image-studio -n 100 --no-pager
curl -fsS http://127.0.0.1:8788/api/health
```

账户与调用设置位于头像菜单。建议从 2 路并发开始，按机器资源与订阅额度调整。

`deploy/studio_operator.py` 从标准输入读取包含 `username`、`password` 的 JSON，不将凭据放进命令参数；支持状态、模型、任务和日志查询。`probe`、`smoke` 会发起真实生成并消耗额度。

## 备份与升级

备份整个 `/var/lib/image-studio`，连同源码和 nginx 配置。数据含用户图片、提示词和账户凭据，备份也要限制访问权限。在线数据库通过 SQLite backup 接口备份，或停服务后备份数据库及 WAL，不要只复制正在写入的主文件。

升级流程：暂停队列 → 等待在途任务结束 → 备份 → 更新源码与锁定依赖 → 重启服务 → 检查健康接口和历史数据 → 恢复队列。

启动迁移按需添加字段，保留旧记录。旧任务没有明确模板身份时按提交批次建立独立列表，不按文字相似度猜测模板。旧提示词迁移为模板；能匹配历史生成记录时，从最近记录补回参考图和选项。

## 排障

| 现象 | 处理方向 |
| --- | --- |
| 设备码不可用 | 使用浏览器链接登录 |
| localhost 回调无法访问 | SSH 转发，或在工作台提交完整回调 |
| 登录成功但生图失败 | 查看任务日志；登录不代表工具或账户一定支持生图 |
| bwrap 复制错误 | 更新到后端按线程收集图片的版本，不绕过沙箱复制 |
| 模型或强度错误 | 刷新 CLI 目录，并以实际账户权限为准 |
| 页面 502 | 检查 systemd、8788 端口、nginx upstream |
| 重复调度 | 只启动一个 uvicorn worker |

## 渐进超分升级

安装锁定依赖中的pyvips及二进制库；数据库启动时仅新增润色提示词列，不回填历史。升级前确认无运行任务，备份源码与在线SQLite，随后重启服务。Nginx的`client_max_body_size`设为`0`以移除单图片上传限制，上传和任务写入由工作台总存储限额约束。仅更新本站配置并在`nginx -t`通过后reload。

润色记录优先采集工具参数中的提示词，否则保存执行模型显式回报，界面区分来源。不要把推断的文本写回旧任务。
