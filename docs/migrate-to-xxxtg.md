# 迁移到服务器 187.127.218.157（`/opt/smsall`）

目标：把当前 Cloud Agent 上的 SMSBazaar（代码 + `.env` + SQLite 密钥/推送配置）迁到固定服务器，供长期运行与远程开发。

**工作目录限制：仅 `/opt/smsall`（不要改动 `/opt/xxxtg` 等其他目录）。**

## 现状盘点（源环境）

| 项 | 说明 |
|---|---|
| 代码分支 | `cursor/setup-newsmapi-dev-env-cd8d`（已推 GitHub） |
| 运行端口 | API `8787`，开发前端 `5173` |
| 密钥 | `.env`（Bot Token、部分 env Key）+ SQLite `provider_api_keys`（24 家平台 Key） |
| 推送对象 | SQLite `app_settings.telegram_notify_recipients` |
| 数据库 | `data/app.sqlite`（约 40MB，含快照与告警去重） |
| 目标路径 | `/opt/smsall` |
| 目标主机 | `187.127.218.157` |

**不要把 `.env` / `app.sqlite` 提交进 Git。**

## 前置条件

1. SSH 可用（root 或有 sudo 的部署用户）
2. 开放 **22** 与 **8787**（若仅内网访问可配防火墙白名单）
3. 服务器能访问 GitHub

## 一键安装（在服务器上）

```bash
APP_DIR=/opt/smsall bash scripts/xxxtg/install-on-server.sh
```

脚本会：安装 Node 22（若无）→ clone/pull 到 `/opt/smsall` → `npm ci` + `npm run build` → 安装 `smsbazaar.service`。

## 密钥迁移

```bash
bash scripts/xxxtg/pack-secrets-for-migrate.sh
SSH_USER=root APP_DIR=/opt/smsall bash scripts/xxxtg/push-from-agent.sh
```

## 验收

```bash
ssh root@187.127.218.157 'systemctl status smsbazaar --no-pager'
ssh root@187.127.218.157 'curl -s http://127.0.0.1:8787/api/meta | head -c 200'
# 浏览器：http://187.127.218.157:8787/
```

## Cursor 远程开发约定

- 工作目录固定：`/opt/smsall`（禁止改其他 `/opt/*` 项目）
- Agent 自行读改验证；禁止 Task 委派其他模型；与用户用简体中文沟通
- `.env` 与 `data/app.sqlite` 仅存服务器本地，禁止提交
