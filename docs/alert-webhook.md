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

`items` **已按单价从低到高排序**。

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
6. **单次最多条数**：默认 50

过滤只影响 Webhook，**不影响** Telegram 原文推送。

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

前端 Webhook URL 填：`http://<你的程序主机>:9090/hooks/smsall`

## 测试

设置页点 **发送测试**，会推一条样例 `IN / $0.12 / restock`。也可用：

```bash
curl -s -X POST http://127.0.0.1:8787/api/settings/webhook/test \
  -H "Authorization: Bearer <登录token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```
