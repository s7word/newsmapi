# 迁移到服务器 187.127.218.157（`/opt/smsall` · Docker）

**工作目录仅限 `/opt/smsall`。用 Docker 运行，不要在宿主机新建 Node/systemd 运行环境。**

## 方式

| 项 | 值 |
|---|---|
| 路径 | `/opt/smsall` |
| 运行 | `docker compose up -d`（容器 `smsall_smsbazaar`） |
| 端口 | 宿主 `8787` → 容器 `8787` |
| 数据 | `./data` 与 `./.env` 挂载进容器（密钥不进镜像） |

## 服务器安装（仅 Docker）

```bash
# 已装 Docker / Compose 的机器上：
APP_DIR=/opt/smsall bash scripts/xxxtg/install-on-server.sh
# 写入真实 .env + data/app.sqlite 后：
cd /opt/smsall && docker compose up -d
```

`install-on-server.sh` **不会**把应用挂到宿主机 Node；若发现误装的 `smsbazaar.service` 会自动拆除。

## 从 Agent 推密钥并重启容器

```bash
bash scripts/xxxtg/pack-secrets-for-migrate.sh
SSH_USER=root APP_DIR=/opt/smsall bash scripts/xxxtg/push-from-agent.sh
```

## 日常

```bash
cd /opt/smsall
docker compose logs -f smsbazaar
docker compose pull   # 若改用镜像仓库时
git pull && docker compose build && docker compose up -d
curl -s http://127.0.0.1:8787/api/meta | head
```

## 注意

- 不要 `apt install nodejs` / 不要用宿主机 `npm start` 跑本项目
- 不要改 `/opt/xxxtg`、`/opt/scan_xx` 等其他目录
- `.env` 与 `data/*.sqlite*` 禁止提交 Git
