# 迁移到服务器 187.127.218.157（`/opt/xxxtg`）

目标：把当前 Cloud Agent 上的 SMSBazaar（代码 + `.env` + SQLite 密钥/推送配置）迁到固定服务器，供长期运行与远程开发。

## 现状盘点（源环境）

| 项 | 说明 |
|---|---|
| 代码分支 | `cursor/setup-newsmapi-dev-env-cd8d`（已推 GitHub） |
| 运行端口 | API `8787`，开发前端 `5173` |
| 密钥 | `/workspace/.env`（Bot Token、部分 env Key）+ SQLite `provider_api_keys`（24 家平台 Key） |
| 推送对象 | SQLite `app_settings.telegram_notify_recipients` |
| 数据库 | `data/app.sqlite`（约 40MB，含快照与告警去重） |
| 目标路径 | `/opt/xxxtg` |
| 目标主机 | `187.127.218.157` |

**不要把 `.env` / `app.sqlite` 提交进 Git。**

## 前置条件（需你提供）

1. **SSH 登录方式**（任选其一）
   - 把本机/Agent 的公钥加到服务器 `authorized_keys`
   - 或提供可用账号 + 私钥（写入 Cursor Secrets / Agent SSH）
2. 服务器开放 **22**（SSH）与 **8787**（对外看板；若仅内网可只绑防火墙白名单）
3. 确认公网 GitHub 可 `git clone` / `git pull`（或改用你方镜像）

## 一键安装（在服务器上）

```bash
# 首次：把仓库装到 /opt/xxxtg + systemd（不自动启动，等密钥就位）
curl -fsSL https://raw.githubusercontent.com/s7word/newsmapi/cursor/setup-newsmapi-dev-env-cd8d/scripts/xxxtg/install-on-server.sh | bash
# 或克隆后：
# bash /opt/xxxtg/scripts/xxxtg/install-on-server.sh
```

脚本会：安装 Node 22（若无）→ clone/pull 分支 → `npm ci` + `npm run build` → 安装 `smsbazaar.service`。

## 密钥迁移（从当前 Agent）

在 **有 `.env` 和 SQLite 的机器**上：

```bash
bash scripts/xxxtg/pack-secrets-for-migrate.sh
# 生成 /tmp/xxxtg-migrate/smsbazaar-secrets-*.tar.gz（含 .env + app.sqlite）
```

有 SSH 后一键上传并重启：

```bash
SSH_USER=root bash scripts/xxxtg/push-from-agent.sh
```

或手动：

```bash
scp /tmp/xxxtg-migrate/smsbazaar-secrets-XXXX.tar.gz root@187.127.218.157:/tmp/
ssh root@187.127.218.157 'tar -xzf /tmp/smsbazaar-secrets-XXXX.tar.gz -C /opt/xxxtg && systemctl restart smsbazaar'
```

## 验收

```bash
ssh root@187.127.218.157 'systemctl status smsbazaar --no-pager'
ssh root@187.127.218.157 'curl -s http://127.0.0.1:8787/api/meta | head -c 200'
# 浏览器：http://187.127.218.157:8787/
# Telegram：设置里发测试推送，或等下一轮补货告警
```

## 日常运维

| 操作 | 命令 |
|---|---|
| 看日志 | `journalctl -u smsbazaar -f` |
| 重启 | `systemctl restart smsbazaar` |
| 拉代码 | `cd /opt/xxxtg && git pull && npm ci && npm run build && systemctl restart smsbazaar` |
| 开发热更 | `cd /opt/xxxtg && npm run dev`（另开 tmux；生产仍建议 systemd 跑 `npm start`） |

## Cursor 远程开发约定

- 工作目录固定：`/opt/xxxtg`
- Agent **自己**读改验证，不要 Task 委派其他模型
- 与用户用**简体中文**沟通
- 密钥只写服务器本地 `.env` / SQLite，禁止提交

## 防火墙建议

```bash
# 示例（按你实际防火墙工具调整）
ufw allow 22/tcp
ufw allow 8787/tcp
# 5173 仅开发需要，生产可不开放
```
