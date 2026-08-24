# SMSBazaar

SMSBazaar 是一个用于对比多家短信接码平台、多种目标服务价格和库存的单页面看板。

项目通过服务端定时拉取多家短信平台 API，把不同平台的国家、价格、库存统一归一化，然后在前端按国家维度展示最低价、总库存、在线平台数和各平台明细。支持在前端登录管理员后配置各平台 API Key。

上游项目：[https://github.com/FoundZiGu/SMSBazaar](https://github.com/FoundZiGu/SMSBazaar) · 在线示例：[https://sms.fur.li/](https://sms.fur.li/)

## 功能特性

- 多服务对比：OPENAI(ChatGPT)、Telegram、WhatsApp、Google、Discord、Microsoft、Twitter/X、Instagram、Facebook、TikTok、Amazon、Apple。
- 已接入 24 家短信平台：Hero SMS、SMSBower、5sim、NexSMS、GrizzlySMS、Tiger SMS、SMSTG、SMS Verification Number、SMSPool、OnlineSim、SMSPVA、CodesVerify、SMSCode.net、SMS-Rooms、SMS-Bus、Vibe SMS、CyberYozh、Vak SMS、Give SMS、365SMS、JuicySMS、PVAPins、SimSMS、GetSMS。
- 前端「设置」面板：管理员登录后可写入/更新平台 API Key（存 SQLite，优先于环境变量）。
- 国家统一使用 ISO2 做主键，解决各平台国家 ID 不一致的问题。
- 国家名称显示为中文名，后面带英文名。
- 价格默认显示人民币，同时显示美元换算价。
- 支持按国家、平台、状态和价格/库存排序筛选。
- 支持展开国家查看各平台明细，平台多档价格默认折叠。
- 支持四种业务模式：先手机号注册 OAuth、后手机号绑定 OAuth、目前推荐国家、WhatsApp 接码。
- Node.js 部署每天从 OpenAI 官网同步 API 与 WhatsApp 支持地区，失败时保留上次成功清单。
- 后端默认每 1 分钟自动刷新一次快照。
- **Telegram 补货/上新通知**（可选）：对比 `telegram` 服务快照，向 Telegram Bot 推送新国家上架或库存 0→有货（见下方环境变量）。
- 保留管理员手动刷新接口，公网默认需要管理员密钥。
- 前端支持跟随系统、亮色、暗色主题。

## 技术架构

- 前端：React SPA + Vite。
- 后端：Express API + 静态文件托管。
- 存储：SQLite，保存最近快照、刷新状态、汇率缓存和服务配置。
- 部署：构建后一个 Node.js 进程即可同时提供 API 和前端页面。

## 环境要求

- Node.js 20 或更新版本。
- npm。
- 至少配置你需要启用的平台 API key。

## 本地开发

```bash
npm install
cp .env.example .env
npm run dev
```

本地开发时：

- 前端地址：`http://localhost:5173`（局域网：`http://<本机局域网 IP>:5173`）
- 后端地址：`http://localhost:8787`（局域网：`http://<本机局域网 IP>:8787`）
- 默认监听 `0.0.0.0`（环境变量 `HOST`），便于局域网同事访问；仅本机使用时可在 `.env` 设置 `HOST=127.0.0.1`
- Vite 开发服务器同样默认 `0.0.0.0:5173`（`VITE_HOST` / `VITE_PORT`）
- Vite 会把 `/api` 请求代理到后端

## 生产构建

```bash
npm install
npm run build
npm start
```

默认生产服务监听 `PORT=8787`，并托管 `dist/client` 下的前端构建产物。

## 环境变量

在服务器上复制 `.env.example` 为 `.env`，然后填写真实 API key。

```env
PORT=8787
HOST=0.0.0.0
REFRESH_INTERVAL_MS=60000
REFRESH_COOLDOWN_MS=30000
DATABASE_PATH=./data/app.sqlite
EXCHANGE_RATE_URL=https://api.frankfurter.app/latest?from=USD
RECOMMENDED_COUNTRY_PATHS_FILE=./data/recommended-country-paths.txt
OPENAI_SUPPORTED_COUNTRIES_FILE=./data/openai-supported-api-countries.txt
OPENAI_WHATSAPP_COUNTRIES_FILE=./data/openai-supported-whatsapp-countries.txt
OPENAI_COUNTRY_SYNC_STATE_FILE=./data/openai-country-sync-state.json
OPENAI_COUNTRY_SYNC_ENABLED=true
OPENAI_COUNTRY_SYNC_MODE=browser
OPENAI_COUNTRY_SYNC_INTERVAL_MS=86400000
OPENAI_COUNTRY_SYNC_RETRY_MS=3600000
OPENAI_COUNTRY_SYNC_CHECK_MS=3600000
OPENAI_COUNTRY_SYNC_PAGE_TIMEOUT_MS=120000
OPENAI_COUNTRY_SYNC_BROWSER_HOME=./data/chrome-home
OPENAI_COUNTRY_SYNC_REMOTE_API_URL=https://raw.githubusercontent.com/FoundZiGu/SMSBazaar/main/data/openai-supported-api-countries.txt
OPENAI_COUNTRY_SYNC_REMOTE_WHATSAPP_URL=https://raw.githubusercontent.com/FoundZiGu/SMSBazaar/main/data/openai-supported-whatsapp-countries.txt
OPENAI_COUNTRY_SYNC_PROXY_API_URL=https://r.jina.ai/http://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories
OPENAI_COUNTRY_SYNC_PROXY_WHATSAPP_URL=https://r.jina.ai/http://help.openai.com/en/articles/8983038-which-countries-do-you-support-for-whatsapp-phone-verification
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
ADMIN_REFRESH_TOKEN=
EXPOSE_PROVIDER_ERRORS=false
```

平台 API key：

```env
HERO_SMS_API_KEY=
SMSBOWER_API_KEY=
FIVESIM_API_KEY=
NEXSMS_API_KEY=
GRIZZLYSMS_API_KEY=
SMS_VERIFICATION_API_KEY=
SMSPOOL_API_KEY=
ONLINESIM_API_KEY=
SMSPVA_API_KEY=
CODESVERIFY_API_KEY=
SMSCODE_API_KEY=
SMS_ROOMS_API_KEY=
SMS_BUS_API_KEY=
VIBE_SMS_API_KEY=
CYBERYOZH_API_KEY=
VAK_SMS_API_KEY=
GIVE_SMS_API_KEY=
SMSTG_API_KEY=
TIGER_SMS_API_KEY=

# Telegram 补货/上新 Bot 通知（默认仅 telegram 服务）
TELEGRAM_ALERT_ENABLED=true
TELEGRAM_BOT_TOKEN=
TELEGRAM_NOTIFY_CHAT_ID=
TELEGRAM_ALERT_SERVICE_KEYS=telegram
TELEGRAM_ALERT_RESTOCK_COOLDOWN_MS=21600000
```

**Telegram 通知**：对比 `telegram` 服务每次刷新前后的快照，向 Bot 推送「新国家上架」或「库存 0→有货」。向 Bot 发一条私聊消息后，服务会自动从 `getUpdates` 发现 chat id 并写入数据库；也可手动填入 `TELEGRAM_NOTIFY_CHAT_ID`。**勿将 Bot Token 写入 Git**；若 Token 曾在聊天中泄露，请在 @BotFather 重置。

也可以在启动后打开前端右上角「设置」，用 `ADMIN_PASSWORD`（或兼容的 `ADMIN_REFRESH_TOKEN`）登录，把 Key 写入 SQLite。数据库中的 Key 优先于环境变量。

SMSBower / 5SIM 支持无 Key 拉取公开报价，便于本地先跑通看板；其余平台需要真实 API Key。

平台注册入口（需自行注册并复制 API Key）：

| 平台 | 注册 / 控制台 |
| --- | --- |
| Hero SMS | https://hero-sms.com |
| SMSBower | https://smsbower.app |
| 5SIM | https://5sim.net |
| NexSMS | https://nexsms.net |
| Grizzly SMS | https://grizzlysms.com |
| Tiger SMS | https://tiger-sms.com |
| SMSTG | https://smstg.org |
| SMS Verification Number | https://sms-verification-number.com |
| SMSPool | https://www.smspool.net |
| OnlineSim | https://onlinesim.io |
| SMSPVA | https://smspva.com |
| CodesVerify | https://codesverify.com |
| SMSCode.net | https://smscode.net |
| SMS-Rooms | https://sms-rooms.com |
| SMS-Bus | https://sms-bus.com |
| Vibe SMS | https://vibe-sms.net/profile/api |
| CyberYozh | https://app.cyberyozh.com/docs/ |
| Vak SMS | https://vak-sms.com/api/vak/ |
| Give SMS | https://give-sms.com/api.html |
| 365SMS | https://365sms.com/ |
| JuicySMS | https://juicysms.com/api |
| PVAPins | https://app.pvapins.com/ |
| SimSMS | https://simsms.org/ |
| GetSMS | https://getsms.online/ |

GetSMS 需在 Profile 生成 API Key，并同时提供账号邮箱/用户名：环境变量 `GETSMS_USER`，或在设置里填写 `user|api_key`（例如 `you@mail.com|你的API密钥`）。文档：https://getsms.online/api_command_reference.php

平台服务码也可以通过环境变量覆盖：

```env
HERO_SMS_SERVICE_CODE=dr
SMSBOWER_SERVICE_CODE=dr
FIVESIM_SERVICE_CODE=openai
NEXSMS_SERVICE_CODE=dr
GRIZZLYSMS_SERVICE_CODE=dr
SMS_VERIFICATION_SERVICE_CODE=dr
SMSPOOL_SERVICE_CODE=671
SMSPOOL_NATIVE_SERVICE_NAME=OpenAI / ChatGPT
SMSPOOL_REFRESH_INTERVAL_MS=180000
SMSPOOL_STOCK_MODE=pool
SMSPOOL_STOCK_BATCH_SIZE=20
SMSPOOL_INCLUDE_POOL_NAMES=false
```

SMSPool 使用官方原生 API：`/request/pricing` 获取价格档位，`/sms/stock` 获取库存。`SMSPOOL_SERVICE_CODE=671` 对应 `OpenAI / ChatGPT`；如果你的环境里仍保留旧的 `dr`，程序会通过 `SMSPOOL_NATIVE_SERVICE_NAME` 自动解析原生服务 ID。

`SMSPOOL_STOCK_MODE=pool` 表示按价格池查询库存，库存会挂到真实有库存的 pool 上，避免把国家总库存误挂到最低价但不可购买的 pool。不要用价格阈值过滤低价池，因为 SMSPool 里存在真实有库存的低价池。

`SMSPOOL_REFRESH_INTERVAL_MS=180000` 表示 SMSPool 单独每 3 分钟刷新一次，其它平台仍按全局 `REFRESH_INTERVAL_MS=60000` 刷新。这样可以保留页面 1 分钟更新，同时避开 SMSPool 的 120 秒限流窗口。

`SMSPOOL_STOCK_BATCH_SIZE=20` 表示每次 SMSPool 真实刷新只查询 20 个国家的库存，其他国家沿用上一次成功库存；价格仍然全量刷新。这可以避免一次性查询 155 个国家库存导致 `429`。

## 推荐国家配置

目前推荐国家从 `data/recommended-country-paths.txt` 读取。

每一行格式：

```txt
ISO2 PATH
```

`PATH` 含义：

- `0`：推荐走先手机号注册 OAuth。
- `1`：推荐走后手机号绑定 OAuth。

示例：

```txt
GB 1
PH 0
```

前端只显示业务文案，不展示原始 `0/1`，也不暴露服务器上的配置文件路径。

## OpenAI 支持国家

先手机号注册 OAuth 模式读取 `data/openai-supported-api-countries.txt`，WhatsApp 接码模式读取 `data/openai-supported-whatsapp-countries.txt`。

两个文件都使用一行一个 ISO2 国家或地区代码。Node.js 服务默认每 24 小时使用无头浏览器直接读取对应 OpenAI Help Center 官方页面；同步失败后每小时重试，并始终保留上次成功文件。项目使用 `puppeteer-core`，服务器需安装 Chrome/Chromium；程序会自动查找常见 Linux 路径，也可以通过 `PUPPETEER_EXECUTABLE_PATH` 显式指定。`OPENAI_COUNTRY_SYNC_BROWSER_HOME` 应指向服务进程可写的持久化目录。

低内存 VPS 建议设置 `OPENAI_COUNTRY_SYNC_MODE=remote`：GitHub Actions 每天通过 Jina Reader 读取 OpenAI 官方文章并刷新仓库清单，VPS 只下载经过官方源 URL、数量和 ISO2 校验的清单，不在生产机启动 Chrome。Jina Reader 仅作为 Cloudflare Challenge 的传输代理；无法验证官方源 URL或解析结果时不会覆盖旧清单。

官方来源：

- API 支持国家和地区：[OpenAI API - Supported Countries and Territories](https://help.openai.com/en/articles/5347006-openai-api-supported-countries-and-territories)
- WhatsApp 验证地区：[Which countries do you support for WhatsApp phone verification?](https://help.openai.com/en/articles/8983038-which-countries-do-you-support-for-whatsapp-phone-verification)

需要立即验证或强制同步时，可以运行：

```bash
npm run sync:countries
```

## 统一协议网关（Gateway）

各上游平台的鉴权方式、路径和返回格式差异很大。SMSBazaar 在适配层之上增加了 **统一网关**，对外提供两类能力：

1. **标准化 JSON API**（`smsbazaar.gateway.v1`）——比价、余额、取号、查码、取消订单与协议元数据使用同一响应结构。
2. **SMS-Activate 协议中转**——对 Hero / Grizzly / SMS-Rooms / 365SMS / Vak SMS 等 `handler_api.php` 平台，可按 SMS-Activate 习惯转发 `getBalance`、`getPrices`、`getNumber` 等请求。
3. **统一取号协议**——全部 24 家接入平台均支持同一套 JSON 接口完成 `取号 → 轮询状态 → 取消`（SMS-Activate 系、GetSMS、SimSMS、JuicySMS、5SIM、NexSMS、SMSPool、OnlineSim、SMSPVA、SMSCode、CodesVerify、SMS-Bus、Vibe SMS、CyberYozh、Give SMS、PVAPins、Tiger SMS、SMSTG 等），无需为每家平台写不同调用方式。

### 网关端点

```http
GET /api/gateway/v1/meta
GET /api/gateway/v1/prices?provider=hero-sms&service=telegram&source=snapshot
GET /api/gateway/v1/prices?provider=hero-sms&service=telegram&source=live
GET /api/gateway/v1/balance?provider=hero-sms
GET /api/gateway/v1/activate?provider=hero-sms&action=getBalance&api_key=...
POST /api/gateway/v1/order?provider=hero-sms&service=telegram&country=12
GET  /api/gateway/v1/order?provider=hero-sms&activationId=123&service=telegram&country=US
POST /api/gateway/v1/order/cancel?provider=hero-sms&activationId=123&service=telegram&country=US
```

- `meta`：列出 24 家平台的 **协议类型**（`activate-handler`、`smstg-account-api`、`priemnik`、`getsms-command` 等）与 **能力**；`orderProtocols` 列出支持统一取号的平台。
- `prices`：`source=snapshot` 读本地缓存（公开）；`source=live` 实时拉上游（需鉴权）。
- `activate`：将 query 原样转发到对应平台 `handler_api.php`，响应与 SMS-Activate 一致（文本或 JSON）。
- **统一订单**（需鉴权）：`orderState` 为 `pending | waiting_code | completed | cancelled | expired | rejected`。各平台 `country` 含义不同：SMS-Activate 系传平台国家 ID；SimSMS 传 ISO（如 `US`）；GetSMS 主要美国，可传 `state` / `areacode` / `markup`；JuicySMS 传 `US`/`GB` 等；5SIM 传国家 slug（如 `usa`）；NexSMS 传 `countryId`；OnlineSim 传国际区号数字（如 `1`）；SMSPool 可传 `pool`、`serviceId`；SMS-Bus 可传 `countryId`、`projectId`；NexSMS / PVAPins / SMSCode 查码时 `activationId` 可为手机号，也可额外传 `phoneNumber`。

实现位置：`src/lib/gateway/`（`protocol-registry.js` 登记协议，`gateway-service.js` 统一出口，`activate-bridge.js` SMS-Activate 中转，`order-handlers.js` / `order-bridge.js` 统一取号适配，`order-shared.js` 共享响应结构）。

### 鉴权方式（三选一）

| 方式 | 用途 |
| --- | --- |
| 管理员登录 Cookie / Bearer | 面板同源调用 |
| `GATEWAY_API_TOKEN`（请求头 `X-Gateway-Token` 或 `api_key` 参数） | 脚本/自动化，使用设置里已保存的上游 Key |
| 直接传上游 `api_key` | 透传模式，不经本地存储 |

```env
GATEWAY_API_TOKEN=your-long-random-token
```

## API

```http
GET /api/meta?service=openai_chatgpt|telegram|...
GET /api/compare?service=...&mode=register|bind|recommended|whatsapp|all&country=US&provider=smsbower&status=in_stock&sort=price_asc
POST /api/auth/login
POST /api/auth/logout
GET /api/auth/me
GET /api/settings/keys
GET /api/settings/providers-panel?service=openai_chatgpt
PUT /api/settings/keys
POST /api/settings/keys/test
POST /api/settings/keys/test-all
POST /api/refresh
GET /api/gateway/v1/meta
GET /api/gateway/v1/prices?provider=...&service=...&source=snapshot|live
GET /api/gateway/v1/balance?provider=...
GET /api/gateway/v1/activate?provider=...&action=getBalance&service=tg&country=0
```

对比接口增加 `summary=1` 时仅返回国家摘要，`offers` 为空；省略该参数时返回完整平台与价格档位明细。前端首屏使用摘要模式，展开国家后再按需请求完整明细。

`POST /api/refresh` 需要管理员密钥，二选一传入：

```http
x-admin-refresh-token: your-token
Authorization: Bearer your-token
```

如果 `ADMIN_REFRESH_TOKEN` 为空，手动刷新接口会返回 `503 admin_refresh_not_configured`。

## VPS 部署建议

推荐部署方式：

- 使用 `pm2` 或 `systemd` 守护 Node.js 进程。
- 使用 Nginx 反向代理到 `127.0.0.1:8787`。
- 开启 HTTPS。
- `.env` 不要提交到仓库。
- SQLite 数据库建议放在持久化目录，例如 `/var/lib/smsbazaar/app.sqlite`。
- 公网部署保持 `EXPOSE_PROVIDER_ERRORS=false`，避免暴露上游平台的详细错误。
- 设置强随机 `ADMIN_REFRESH_TOKEN`。

PM2 示例：

```bash
npm install
npm run build
pm2 start src/server.js --name smsbazaar
pm2 save
```

Nginx 反向代理示例：

```nginx
server {
  listen 80;
  server_name example.com;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Cloudflare Workers 部署（可选）

除了 VPS 部署，项目也支持部署到 Cloudflare Workers（入口在 `workers/`，与 Node.js 部署方式互不影响）：

- API 和静态前端由同一个 Worker 提供（Workers Assets 托管 `dist/client`）。
- 存储使用 Workers KV 替代 SQLite（快照、平台状态、汇率缓存合并为一个 KV key）。
- 定时刷新使用 Cron Triggers 替代 Node 进程里的 `setInterval`。

部署步骤：

```bash
npm install

# 1. 登录 Cloudflare
npx wrangler login

# 2. 创建 KV namespace，并把生成的 id 填入 wrangler.toml
npx wrangler kv namespace create SMSBAZAAR_KV

# 3. 配置平台 API key 和管理员密钥（按需）
npx wrangler secret put HERO_SMS_API_KEY
npx wrangler secret put SMSBOWER_API_KEY
npx wrangler secret put FIVESIM_API_KEY
npx wrangler secret put NEXSMS_API_KEY
npx wrangler secret put GRIZZLYSMS_API_KEY
npx wrangler secret put SMS_VERIFICATION_API_KEY
npx wrangler secret put SMSPOOL_API_KEY
npx wrangler secret put ADMIN_REFRESH_TOKEN

# 4. 构建前端并部署
npm run deploy:worker
```

本地调试 Workers 版本：

```bash
npm run dev:worker
# 手动触发一次定时刷新（模拟 Cron）
curl "http://localhost:8787/__scheduled?cron=*%2F2+*+*+*+*"
```

与 Node.js 部署的差异：

- 数据存在 KV 中，不再需要 `DATABASE_PATH`。
- 推荐国家和 OpenAI 支持国家配置在构建时打包进 Worker（`data/*.txt`），修改后需要重新 `wrangler deploy` 生效。Workers 版本不运行 Puppeteer，每日官网同步仅适用于 Node.js 部署。
- 刷新历史只保留最近一次刷新事件。
- 默认 Cron 为每 2 分钟一次：免费版 KV 每天限 1000 次写入，每 2 分钟刷新约 720 次/天可留在免费额度内；Workers 付费版可在 `wrangler.toml` 里改成 `* * * * *` 每分钟刷新。
- 手动刷新接口 `POST /api/refresh` 行为不变，仍需 `ADMIN_REFRESH_TOKEN`。
- 服务码等非敏感覆盖项（如 `SMSPOOL_SERVICE_CODE`）可加到 `wrangler.toml` 的 `[vars]` 中。

## 开源注意事项

- `.env`、SQLite 数据库、构建产物、日志文件和 `node_modules` 已被 `.gitignore` 忽略。
- `data/*.txt` 是公开配置模板，会进入仓库。
- 生产依赖可用 `npm audit --omit=dev` 检查。

## 友情链接

- [LINUX DO - 新的理想型社区](https://linux.do/)

## License

MIT
