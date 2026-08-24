## Cursor Cloud specific instructions

### 开发服务

- 开发：`npm run dev`（Express `8787` + Vite `5173`，Vite 会代理 API）。
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

### SMSTG

- API 根：`https://smstg.org/api`（`getBalance` / `buy` / `getOtp`）。
- Key 环境变量：`SMSTG_API_KEY`；公开页抓取报价，可无 Key 刷新 Telegram 服务快照。

### Telegram 补货 / 上新通知

- 环境变量：`TELEGRAM_BOT_TOKEN`（写入 `/workspace/.env`，**勿提交**）；`TELEGRAM_NOTIFY_CHAT_ID` 可选。
- **Chat ID 自动发现**：若未配置 `TELEGRAM_NOTIFY_CHAT_ID`，服务会每 30s 轮询 `getUpdates`；用户向 Bot（如 `rscbot2026_bot`）发一条私聊后，chat id 会写入 SQLite `app_settings.telegram_notify_chat_id` 并发送确认消息。
- 云端 Agent 应自行：更新 `.env` 中的 Token、重启 Node（`8787`）、确认 `/api/meta` 平台数正确；无需用户手动重启。
- 默认仅监听 `telegram` 服务快照 diff（新国家上架、库存 0→有货）。
- 推送对象按人配置：`includeSource` 控制是否带内部来源编号（P01…），`providerKeys` 为 `null` 表示全部平台、数组为过滤名单。`includeSource=true` 时正文显示编号、展示名、账户余额（`provider_connectivity_tests` 缓存，缺/超过 24h 且有 Key 才现场测）、`打开平台查看` HTML 链接，以及明文 `🔗 平台链接：https://...` 兜底（部分 Telegram 客户端不易察觉纯 `<a>` 文案）。`includeSource=false` 时这些都不带。不要带 `baseUrl` / `keyEnv` / `providerKey`。
- 启用后 Telegram 服务会每个刷新周期拉价（不再每 5 轮才刷一次）。
- **勿将 Bot Token 提交到仓库**；已在聊天中泄露的 Token 建议在 @BotFather 重置。
