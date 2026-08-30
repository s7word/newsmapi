## Cursor Cloud specific instructions

### 开发服务

- 开发：`npm run dev`（Express `8787` + Vite `5173`，Vite 会代理 API）。
- **端口映射**：API 与 Vite 须监听 `0.0.0.0`（`HOST=0.0.0.0`、`npm run dev:client -- --host 0.0.0.0`）。云端本地映射请用 **5173**（前端）或 **8787**（API）；若打不开先 `lsof -i :5173 -i :8787` 并重启 tmux `smsbazaar-server` / `smsbazaar-vite-live`。
- 定时刷新：**Telegram（告警）先于 OpenAI** 执行；OpenAI 全量刷新在后台独立运行，**不会阻塞**每分钟 Telegram 补货推送（按服务分锁）。
- 生产静态资源：`npm run build` 后 `npm start`（`client/dist`）。
- 测试：`npm test`。

### 新增短信平台后

- 平台列表由后端 `providers-catalog.js` 驱动，前端 **无硬编码平台名单**；`/api/meta` 的 `providers` 长度应等于目录中的平台数。
- **必须重启 Node 进程**（旧进程会继续返回旧平台数，例如仍显示 23 家而缺少 SMSTG/Tiger）。
- 强刷浏览器或清缓存后再看 UI 顶部「已配置/在线平台」计数。
- 部分平台仅映射特定服务（如 SMSTG 仅 **Telegram**）：在 OPENAI 默认视图下设置里能看到平台，但比价表无数据；需切换到 Telegram 服务并刷新报价。

### 报价刷新注意

- **OnlineSim** 全量按国拉价容易触发 `INTERVAL_CONCURRENT_REQUESTS_ERROR`。默认**顺序**拉价（`ONLINESIM_RATES_SEQUENTIAL=1`）、请求间隔 400ms、服务之间冷却 2.5s、目录缓存 90s；可用 `ONLINESIM_RATES_CONCURRENCY` / `ONLINESIM_RATES_DELAY_MS` / `ONLINESIM_SERVICE_COOLDOWN_MS` 调整。最短刷新间隔默认 5 分钟。连续刷新多个服务时不要并行打 OnlineSim。
- **CodesVerify** 官方文档无批量报价，但 `https://api.codesverify.com/get_rates.php` 对 USA 可用；无库存字段。
- **GetSMS** 必须 `GETSMS_USER` + Key，或设置里 `user|api_key`；只填 Key 会 Unauthorized。
- 打开 SQLite 时会删除不在 `providers-catalog.js` 的 `provider_states` / `provider_snapshots`（例如历史 `sms-activate` 孤儿行）。

### FangyuanSms

- API 根：`http://www.getfangyuan.com:{8818|8858|8868}/api/openApi`（端口自动故障切换）。
- 鉴权：`clientId`（数字用户 ID）+ `apiKey`；设置填写 `clientId|apiKey`，或 `FANGYUAN_CLIENT_ID` + `FANGYUAN_SMS_API_KEY`。
- 查询：`userInfo`（积分余额）、`getPrice`（按 product_id 查价；积分按 1 积分=0.01 CNY 换算）。当前账号侧报价多为产品统一价，无分国家库存字段。
- 产品映射见 `services-catalog.js`（Telegram=`5`，OpenAI=`127` 等）。

### 程序推送 Webhook

- 设置 → 程序推送；协议 `docs/alert-webhook.md`（`smsall.alert.v1`）。
- **手动推送最新**：`POST /api/settings/webhook/push-latest`，合并最近窗口内过滤后的最新条目。
- **狙击**：配置 `sniper.countries`（ISO2）。有余额平台命中补货/上新时立刻单独推送 `source=sniper`，条目含 `sniper:true` / `tags:["sniper"]`，请求头 `X-Smsall-Sniper: 1`。不受 `maxItemsPerPush` 截断。

### SMSTG

- API 根：`https://smstg.org/api`（`getBalance` / `buy` / `getOtp`）。
- Key 环境变量：`SMSTG_API_KEY`；公开页抓取报价，可无 Key 刷新 Telegram 服务快照。

### Telegram 补货 / 上新通知

- 环境变量：`TELEGRAM_BOT_TOKEN`（写入 `/workspace/.env`，**勿提交**）；`TELEGRAM_NOTIFY_CHAT_ID` 可选。
- **Chat ID 自动发现**：若未配置 `TELEGRAM_NOTIFY_CHAT_ID`，服务会每 30s 轮询 `getUpdates`；用户向 Bot（如 `rscbot2026_bot`）发一条私聊后，chat id 会写入 SQLite `app_settings.telegram_notify_chat_id` 并发送确认消息。
- 云端 Agent 应自行：更新 `.env` 中的 Token、重启 Node（`8787`）、确认 `/api/meta` 平台数正确；无需用户手动重启。
- 默认仅监听 `telegram` 服务快照 diff（新国家上架、库存 0→有货）。补货对每次 0→有货都会推送，默认无 6 小时静音。
- 推送对象按人配置：`includeSource` 控制是否带内部来源编号（P01…），`providerKeys` 为 `null` 表示全部平台、数组为过滤名单。`includeSource=true` 时正文显示编号、展示名、账户余额（`provider_connectivity_tests` 缓存，缺/超过 24h 且有 Key 才现场测）、`打开平台查看` HTML 链接，以及明文 `🔗 平台链接：https://...` 兜底（部分 Telegram 客户端不易察觉纯 `<a>` 文案）。`includeSource=false` 时这些都不带。不要带 `baseUrl` / `keyEnv` / `providerKey`。
- 启用后 Telegram 服务会每个刷新周期拉价（不再每 5 轮才刷一次）。
- **程序推送（Webhook）**：设置 →「程序推送」。把简化 JSON 推到外部程序；可过滤最高单价、仅有余额平台、平台白名单。协议见 `docs/alert-webhook.md`（`smsall.alert.v1`）。
- **勿将 Bot Token 提交到仓库**；已在聊天中泄露的 Token 建议在 @BotFather 重置。

### 远程服务器开发（smsall · Docker）

- 主机：`187.127.218.157`，**工作目录仅限** `/opt/smsall`（不要改动 `/opt/xxxtg` 等其他目录）
- **运行方式：Docker Compose**（`docker-compose.yml` / `Dockerfile`），容器名 `smsall_smsbazaar`，端口 `8787`
- **禁止**在宿主机为该项目新建 Node/systemd 运行环境；改代码后在 `/opt/smsall` 内 `docker compose build && docker compose up -d`
- 迁移说明：`docs/migrate-to-xxxtg.md`；安装：`scripts/xxxtg/install-on-server.sh`；密钥：`scripts/xxxtg/pack-secrets-for-migrate.sh`
- Agent 自行读改验证；禁止 Task 委派其他模型/子代理；与用户用简体中文沟通
- `.env` 与 `data/app.sqlite` 挂载进容器，禁止 `git add`
