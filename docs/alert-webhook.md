# 告警 Webhook（程序推送）接收说明

SMSBazaar 在检测到 **Telegram 服务**补货 / 新上架后，除了发 Telegram Bot，还可以把**简化后的 JSON** `POST` 到你的程序。

配置入口：登录后台 → **设置 → 程序推送**。

## 推荐方式：HTTP Webhook

| 项 | 说明 |
|---|---|
| 方法 | `POST` |
| Content-Type | `application/json; charset=utf-8` |
| Schema | `smsall.alert.v1`（请求头 `X-Smsall-Schema` 同步声明） |
| 超时 | 默认 8s（前端可改 1–30s） |
| 重试 | 当前版本不重试；接收方应尽快返回 2xx |

### 鉴权（可选）

若在前端填写了 **Secret**：

1. 请求头 `Authorization: Bearer <secret>`
2. 请求头 `X-Smsall-Signature: sha256=<hmac_hex>`  
   其中 `hmac_hex = HMAC_SHA256(secret, raw_body_bytes)`

接收方应校验其一或两者都校验。

### 请求体示例

```json
{
  "schema": "smsall.alert.v1",
  "sentAt": "2026-08-28T19:20:00.000Z",
  "serviceKey": "telegram",
  "serviceLabel": "Telegram 接码",
  "itemCount": 2,
  "items": [
    {
      "type": "restock",
      "country": "IN",
      "countryName": "India",
      "priceUsd": 0.12,
      "currency": "USD",
      "stockFrom": 0,
      "stockTo": 18,
      "provider": "SMSTG",
      "providerCode": "P24",
      "balance": 12.5,
      "balanceCurrency": "USD",
      "portalUrl": "https://smstg.org"
    },
    {
      "type": "new_listing",
      "country": "PH",
      "countryName": "Philippines",
      "priceUsd": 0.28,
      "currency": "USD",
      "stockFrom": 0,
      "stockTo": 40,
      "provider": "Hero SMS",
      "providerCode": "P01",
      "balance": 3.1,
      "balanceCurrency": "USD",
      "portalUrl": "https://hero-sms.com"
    }
  ]
}
```

`items` **优先按通知时间从新到旧，其次按单价从低到高**。单次条数上限截断时同样优先最新。

载荷可含 `source`：`auto`（自动刷新）或 `manual_latest`（设置页「手动推送最新」）。

### 字段说明

| 字段 | 含义 |
|---|---|
| `type` | `restock` 补货 / `new_listing` 新上架 |
| `country` | ISO2 |
| `priceUsd` | 最低价（USD） |
| `stockFrom` / `stockTo` | 库存变化 |
| `provider` | 平台展示名 |
| `providerCode` | 内部编号（P01…），便于日志 |
| `balance` | 平台账户余额数字；未知则为 `null` |
| `portalUrl` | 平台入口链接 |

### 期望响应

- `2xx`：视为成功  
- 其他状态码：记入服务日志，不阻断 Telegram 推送  

响应体可为空。

## 前端可配过滤（简化推送）

在「程序推送」页可设置：

1. **最高单价（USD）**：只推 `priceUsd ≤ 阈值` 的条目（适合「只要低价」）
2. **仅有余额平台**：余额未知或 `≤ 0` 的丢弃
3. **最低余额**：例如只推余额 ≥ 1 的平台
4. **事件类型**：新上架 / 补货 可分别开关
5. **平台白名单**：不选=全部；勾选后只推这些平台
6. **单次最多条数**：默认 50；超出时**优先保留最新通知**（其次低价）
7. **手动推送最新**：设置页按钮，把最近 N 分钟告警日志中通过过滤的条目合并成一次推送（`source: "manual_latest"`），避免自动推送堆积时程序拿不到最新
8. **狙击对应表**：每个国家单独设最高狙击价（如 `IR≤0.9`、`IQ≤1.8`）。≤ **该档位价** 打 `sniper` 并立即优先推送；**超过仍通知但不打狙击标签**（上游勿自动动作）。

### 供应商档位（providerRef）

对 SMSBower（`agent_ids`）、5SIM、SMSPool 等带 `providerRef` 的平台，补货/上新按 **供应商 + 价位** 分别检测与推送，不再只报国家汇总最低价。

Webhook 条目新增：

- `providerRef`：供应商 ID（多个时用逗号拼接，如 `"2579,3330"`）
- `supplierIds`：数组形式，便于下单时传 `providerIds`
- `tierKey`：内部档位键（`providerRef|price`）
- `priceUsd`：该档位价格（狙击与过滤均按此价，而非国家最低价）

过滤只影响 Webhook，**不影响** Telegram 原文推送。

### 狙击推送示例

```json
{
  "schema": "smsall.alert.v1",
  "source": "sniper",
  "sniper": true,
  "sniperItemCount": 1,
  "items": [
    {
      "type": "restock",
      "country": "IR",
      "priceUsd": 0.12,
      "providerRef": "3193",
      "supplierIds": ["3193"],
      "tierKey": "3193|0.12",
      "sniper": true,
      "sniperWatched": true,
      "sniperMaxPriceUsd": 0.9,
      "sniperOverPrice": false,
      "tags": ["sniper"],
      "priority": "sniper"
    }
  ]
}
```

超价通知示例（普通推送，无狙击标）：

```json
{
  "source": "auto",
  "items": [
    {
      "country": "IQ",
      "priceUsd": 2.1,
      "sniper": false,
      "sniperWatched": true,
      "sniperMaxPriceUsd": 1.8,
      "sniperOverPrice": true,
      "priority": "normal"
    }
  ]
}
```

### 手动推送最新

```bash
curl -s -X POST http://127.0.0.1:8787/api/settings/webhook/push-latest \
  -H "Authorization: Bearer <登录token>" \
  -H "Content-Type: application/json" \
  -d '{"lookbackMinutes":60,"serviceKey":"telegram"}'
```

请求体字段 `source` 为 `manual_latest`，并带 `manual: true`。
## 最小接收示例（Node）

```js
const express = require('express');
const crypto = require('crypto');
const app = express();

app.post('/hooks/smsall', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.SMSALL_HOOK_SECRET || '';
  const raw = req.body; // Buffer
  if (secret) {
    const expect = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
    if (req.get('x-smsall-signature') !== expect) {
      res.status(401).send('bad signature');
      return;
    }
  }
  const payload = JSON.parse(raw.toString('utf8'));
  for (const item of payload.items || []) {
    console.log(item.country, item.priceUsd, item.provider, item.type);
  }
  res.status(204).end();
});

app.listen(9090);
```

若接收程序与 SMSBazaar 在同一台机器：SMSBazaar 在 Docker 内，`http://127.0.0.1:...` 会打到容器自己。请改用宿主机 IP，或 Docker 网桥网关（常见为 `http://172.17.0.1:<端口>/hooks/smsall`）。

## 测试

设置页点 **发送测试**，会推一条样例 `IN / $0.12 / restock`。也可用：

```bash
curl -s -X POST http://127.0.0.1:8787/api/settings/webhook/test \
  -H "Authorization: Bearer <登录token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
