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

### SMSTG

- API 根：`https://smstg.org/api`（`getBalance` / `buy` / `getOtp`）。
- Key 环境变量：`SMSTG_API_KEY`；公开页抓取报价，可无 Key 刷新 Telegram 服务快照。
