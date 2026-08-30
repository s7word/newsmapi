# 平台报价对接状态

目标字段：国家 / 产品名 / 价格 / 库存（`makeOffer` + `tiers`）。  
核对基准：Telegram 服务刷新（2026-08-24），以及 `node src/scripts/probe-provider-offers.js --diagnose` 实机探测。

| 平台 | provider_key | 状态 | 原因 | 国家 | 产品名 | 价格 | 库存 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hero SMS | `hero-sms` | 正常 | activate `getPrices` | 有（193） | 有（service=`tg`） | 有 | 有 |
| SMSBower | `smsbower` | 正常 | 公开价目 `getPricesByService` | 有（193） | 有 | 有 | 有 |
| 5SIM | `5sim` | 正常 | guest/prices | 有（119） | 有（产品档） | 有 | 有 |
| NexSMS | `nexsms` | 正常 | `priceMap` 多档 | 有（185） | 有 | 有 | 有 |
| Grizzly SMS | `grizzlysms` | 正常 | activate `getPricesV3` | 有（201） | 有 | 有 | 有 |
| SMS Verification Number | `sms-verification-number` | 正常 | `getServicesAndCost` | 有（211） | 有 | 有 | 有 |
| SMSPool | `smspool` | 正常 | 服务价 + pool 库存 | 有（114） | 有（pool） | 有 | 有 |
| OnlineSim | `onlinesim` | 已修复 | 连刷多个服务时目录请求会撞 `INTERVAL_CONCURRENT_REQUESTS_ERROR`（Twitter/Instagram 因此变 stale）。现默认顺序拉价、服务间冷却、目录短缓存。实机 Telegram **76** / Instagram **75** / Twitter **74** 国有价有库存。 | 有 | 有（`telegram` 等） | 有 | 有 |
| SMSPVA | `smspva` | 正常 | activation 价目 | 有（68） | 有 | 有 | 有 |
| CodesVerify | `codesverify` | 已修复 | `get_rates.php` USA 可用。实机 Telegram 10 档、Instagram 8 档、Twitter 8 档（含 `X / Twitter*`）。**无库存字段**，有报价记 `stock=1`。库内 Instagram/Twitter 旧错「不支持批量报价」是修复前残留，重新刷新即可。 | 有（USA） | 有（app 名） | 有 | 仅「有货标记」 |
| SMSCode.net | `smscode` | 无法对接 | Key **有效**（`get_balance` 正常，`get_number` 返回余额不足）。官方 `get_rates.php` 对 USA/UK/India 等均 **HTTP 500**；POST 返回 Customer Not Found；`get_countries` 可用但价目接口坏。首页只有营销卡片，无完整国家×产品价目可抓。不能编造报价。 | — | — | — | — |
| SMS-Rooms | `sms-rooms` | 需配置 | 适配器已优先 `getPricesV3` 再回退 `getPrices`。实机 `getBalance` / `getPricesV3` / `getPrices` / `getCountries` 全部 **BAD_KEY**（Key 无效，不是端点错）。前台 `/services` 为 Nuxt 壳，无稳定公开价目；`/prices` 为 410。换有效 Key 即可。 | — | — | — | — |
| SMS-Bus | `sms-bus` | 正常 | control 价目 | 有（29） | 有 | 有 | 有 |
| Vibe SMS | `vibe-sms` | 正常 | activate 兼容 | 有（193） | 有 | 有 | 有 |
| CyberYozh | `cyberyozh` | 正常 | v1 价目 | 有（192） | 有 | 有 | 有 |
| Vak SMS | `vak-sms` | 正常 | activate `getPrices` | 有（65） | 有 | 有 | 有 |
| Give SMS | `give-sms` | 正常 | v1 价目 | 有（132） | 有 | 有 | 有 |
| 365SMS | `365sms` | 正常 | activate `getPrices` | 有（182） | 有 | 有 | 有 |
| JuicySMS | `juicy-sms` | 正常 | v2 价目 | 有（4） | 有 | 有 | 有 |
| PVAPins | `pvapins` | 正常 | `get_rates.php` 按国 | 有（59） | 有 | 有 | 有 |
| SimSMS | `simsms` | 正常 | priemnik `get_prices` | 有（69） | 有 | 有 | 有 |
| GetSMS | `getsms` | 需配置 | `list_services` **必须** `user` + `api_key`。仅 Key 实机返回 Unauthorized。首页营销价无国家/库存，不能当实时报价。设置里填 `user\|api_key`，或 `GETSMS_USER` + Key。 | — | — | — | — |
| Tiger SMS | `tiger-sms` | 正常 | activate `getPrices` | 有（197） | 有 | 有 | 有 |
| SMSTG | `smstg` | 正常 | 公开页抓取（可无 Key） | 有（24） | 有 | 有 | 有 |
| SMS-Activate | `sms-activate` | 无法对接 | **不在** `providers-catalog.js`。历史 SQLite `provider_states` 孤儿会在打开数据库时清理。未纳入本项目。 | — | — | — | — |

## 需您操作

1. **GetSMS**：在设置里把 Key 改成 `邮箱或用户名|API密钥`，或在 `.env` 增加 `GETSMS_USER`（官网 Profile 里的登录名/邮箱）。只有 Key 无法鉴权。
2. **SMS-Rooms**：当前库内 Key 被官方判定无效（`BAD_KEY`）。请到 [sms-rooms.com](https://sms-rooms.com/) 重新生成 API Key 后贴进设置。
3. **SMSCode.net**：Key 本身可用，但厂商 `get_rates.php` 对已知国家全部 500。请向 SMSCode 工单催修价目接口；修好后现有解析会自动工作。不要用首页营销价当库存。

## 本轮结论

可代码修复并已验证：

- **OnlineSim**：顺序拉价 + 服务间冷却 + 目录短缓存，避免连刷 Telegram 后再刷 Twitter/Instagram 时目录直接限流。
- **CodesVerify**：`get_rates.php` 已能拿到 USA 的 Telegram / Instagram / Twitter / OpenAI 产品名+价格；匹配覆盖 `X / Twitter*`；无库存字段记 `stock=1`。
- **SMS-Rooms**：解析与错误信息保持 BAD_KEY 直出；现网卡在无效 Key。
- **GetSMS**：设置页增加 `user|api_key` 提示；无用户名无法对接。

无法仅靠代码补齐：

- **GetSMS**：厂商鉴权要账号 + Key，没有可用的公开实时价目。
- **SMSCode.net**：有效 Key 下官方价目接口 HTTP 500，官网无完整报价可抓。
- **SMS-Rooms**：当前 Key 无效，且无稳定公开价目。
- **SMS-Activate**：产品目录未收录。

## 探测脚本

```bash
node src/scripts/probe-provider-offers.js
node src/scripts/probe-provider-offers.js --providers getsms,sms-rooms,smscode,codesverify,onlinesim --services telegram,openai_chatgpt --diagnose
```

脚本只打印 Key 掩码（长度 + 首尾），不会输出完整密钥。

## 环境变量（报价刷新）

- `ONLINESIM_RATES_SEQUENTIAL`（默认 1，顺序拉各国）
- `ONLINESIM_RATES_CONCURRENCY`（仅 Sequential 关闭时生效，默认 1）
- `ONLINESIM_RATES_DELAY_MS`（默认 400）
- `ONLINESIM_RATES_RETRIES`（默认 5）
- `ONLINESIM_SERVICE_COOLDOWN_MS`（默认 2500，两次 `fetchProviderOffers` 之间）
- `ONLINESIM_CATALOG_TTL_MS`（默认 90000，复用国家目录）
- `ONLINESIM_REFRESH_INTERVAL_MS`（默认 300000）
- `CODESVERIFY_COUNTRIES`（默认 `USA`）
- `GETSMS_USER` 或设置 `user|api_key`
