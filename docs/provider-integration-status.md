# 平台报价对接状态

目标字段：国家 / 产品名 / 价格 / 库存（`makeOffer` + `tiers`）。  
核对基准：Telegram 服务刷新（2026-08-24），以及针对失败平台的实机 API 探测。

| 平台 | provider_key | 状态 | 原因 | 国家 | 产品名 | 价格 | 库存 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Hero SMS | `hero-sms` | 正常 | activate `getPrices` | 有（193） | 有（service=`tg`） | 有 | 有 |
| SMSBower | `smsbower` | 正常 | 公开价目 `getPricesByService` | 有（193） | 有 | 有 | 有 |
| 5SIM | `5sim` | 正常 | guest/prices | 有（119） | 有（产品档） | 有 | 有 |
| NexSMS | `nexsms` | 正常 | `priceMap` 多档 | 有（185） | 有 | 有 | 有 |
| Grizzly SMS | `grizzlysms` | 正常 | activate `getPricesV3` | 有（201） | 有 | 有 | 有 |
| SMS Verification Number | `sms-verification-number` | 正常 | `getServicesAndCost` | 有（211） | 有 | 有 | 有 |
| SMSPool | `smspool` | 正常 | 服务价 + pool 库存 | 有（114） | 有（pool） | 有 | 有 |
| OnlineSim | `onlinesim` | 已修复 | 原并发拉全量国家触发 `INTERVAL_CONCURRENT_REQUESTS_ERROR`。现默认 `ONLINESIM_RATES_CONCURRENCY=2`、请求间隔/重试，目录默认国家先入档。实机 Telegram **95** 国成功。 | 有 | 有（`telegram`） | 有 | 有 |
| SMSPVA | `smspva` | 正常 | activation 价目 | 有（68） | 有 | 有 | 有 |
| CodesVerify | `codesverify` | 已修复 | 官方文档只列 `get_number` / `get_balance` / `get_sms`，但 `get_rates.php` 可用。实机 USA 返回 3000+ 应用价；Telegram 多档（`Telegram7` 等）。**无库存字段**，有报价的档位记 `stock=1`。非 USA 国家名返回空数组（站点以美国号为主）。 | 有（USA） | 有（app 名） | 有 | 仅「有货标记」 |
| SMSCode.net | `smscode` | 无法对接 | 余额接口正常，但 `get_rates.php?country=USA` **HTTP 500**。官网首页无公开价目表，不能编造报价。解析/匹配/错误分类已加强，厂商修好接口后可自动工作。 | — | — | — | — |
| SMS-Rooms | `sms-rooms` | 需配置 | 适配器已改：优先 `getPricesV3`，失败回退 `getPrices`，字符串 `BAD_KEY` 不再报「Unexpected payload」。当前库内 Key 被官方判定 **BAD_KEY**，无公开无 Key 价目。换有效 Key 即可。 | — | — | — | — |
| SMS-Bus | `sms-bus` | 正常 | control 价目 | 有（29） | 有 | 有 | 有 |
| Vibe SMS | `vibe-sms` | 正常 | activate 兼容 | 有（193） | 有 | 有 | 有 |
| CyberYozh | `cyberyozh` | 正常 | v1 价目 | 有（192） | 有 | 有 | 有 |
| Vak SMS | `vak-sms` | 正常 | activate `getPrices` | 有（65） | 有 | 有 | 有 |
| Give SMS | `give-sms` | 正常 | v1 价目 | 有（132） | 有 | 有 | 有 |
| 365SMS | `365sms` | 正常 | activate `getPrices` | 有（182） | 有 | 有 | 有 |
| JuicySMS | `juicy-sms` | 正常 | v2 价目 | 有（4） | 有 | 有 | 有 |
| PVAPins | `pvapins` | 正常 | `get_rates.php` 按国 | 有（59） | 有 | 有 | 有 |
| SimSMS | `simsms` | 正常 | priemnik `get_prices` | 有（69） | 有 | 有 | 有 |
| GetSMS | `getsms` | 需配置 | `list_services` **必须** `user` + `api_key`。仅 Key 返回 Unauthorized。无公开报价。请设 `GETSMS_USER` 或设置里填 `user\|api_key`。`publicWithoutKey=false`。 | — | — | — | — |
| Tiger SMS | `tiger-sms` | 正常 | activate `getPrices` | 有（197） | 有 | 有 | 有 |
| SMSTG | `smstg` | 正常 | 公开页抓取（可无 Key） | 有（24） | 有 | 有 | 有 |
| SMS-Activate | `sms-activate` | 无法对接 | **不在** `providers-catalog.js`。历史 SQLite `provider_states` 孤儿（Missing API key）。打开数据库时会删除目录外的 state/snapshot，meta 不再出现幽灵平台。未纳入本项目，故不对接。 | — | — | — | — |

## 本轮结论

可代码修复并已验证：

- **OnlineSim**：降并发 + 间隔 + 限流重试后 Telegram 95 国有价有库存。
- **CodesVerify**：用未写入官方文档但可用的 `get_rates.php` 拿到 USA Telegram 产品名+价格；库存接口不存在。
- **SMS-Rooms**：解析与错误信息已修好；现网卡在无效 Key。
- **SMS-Activate**：孤儿状态清理，避免幽灵平台。

无法仅靠代码补齐：

- **GetSMS**：厂商鉴权要账号 + Key，没有公开价目。
- **SMSCode.net**：有效 Key 下 `get_rates.php` 对已知国家返回 HTTP 500，官网无报价可抓。
- **SMS-Rooms**：当前 Key 无效，且无公开价目。
- **SMS-Activate**：产品目录未收录，只清理脏数据。

## 环境变量（报价刷新）

- `ONLINESIM_RATES_CONCURRENCY`（默认 2）
- `ONLINESIM_RATES_DELAY_MS`（默认 400）
- `ONLINESIM_RATES_RETRIES`（默认 3）
- `ONLINESIM_REFRESH_INTERVAL_MS`（默认 300000）
- `CODESVERIFY_COUNTRIES`（默认 `USA`）
- `GETSMS_USER` 或设置 `user|api_key`
