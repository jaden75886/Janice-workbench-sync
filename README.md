# Janice 工作台 · 云端同步服务器

这是工作台的轻量同步后端。它保存浏览器工作台的 JSON 数据，并提供认证、版本冲突检测、原子写入和备份恢复。

## 接口

- `GET /healthz`：健康检查，不需要 Token，可用于 Railway / Render 探活。
- `GET /api/data`：读取当前数据，需要 `Authorization: Bearer <SYNC_TOKEN>`。
- `POST /api/data`：提交数据，需要 Token。客户端应携带 `base_revision`；服务器发现版本已变化时返回 `409 conflict`，避免静默覆盖另一台设备的修改。

工作台设置里填写“服务器地址”时只填域名，例如 `https://your-sync.example.com`，不要加 `/api/data`。

## 环境变量

复制 `.env.example` 作为部署参考：

- `PORT`：监听端口，默认 `8787`。
- `DATA_DIR`：数据目录，默认 `./data`。目录中会生成 `data.json` 和上一版备份 `data.json.bak`。
- `SYNC_TOKEN`：必须设置的长随机 Token；未设置时数据接口返回 `503`。
- `CORS_ORIGINS`：允许的前端来源，多个来源用逗号分隔。生产环境请填写工作台的实际 HTTPS 地址，不要使用 `*`；使用 `file://` 本地预览时可临时填写 `null`。
- `MAX_BODY_BYTES`：请求体上限，默认 5 MiB。

## 部署建议

### Railway

连接本仓库后直接部署即可。建议添加 Volume，并把 `DATA_DIR` 设置为 Volume 的挂载路径（例如 `/data`），这样重启或重新部署不会丢数据。

### Render

`render.yaml` 已将探活地址改为 `/healthz`，并预留了 `DATA_DIR=/var/data`。但 Render 免费 Web Service 的本地磁盘不是持久存储；如果要长期保存数据，请使用带持久磁盘的套餐，或改用 Railway Volume 等持久化方案。

### 本地运行

```powershell
$env:SYNC_TOKEN = "请替换为长随机字符串"
$env:CORS_ORIGINS = "http://localhost:3000"
node server.js
```

## 文件说明

- `server.js`：同步 API、Token 校验、冲突检测、原子保存和备份恢复。
- `test/smoke.test.js`：认证、写入、冲突和路由的冒烟测试。
- `.github/workflows/ci.yml`：Node 18 / 20 / 22 自动测试。
- `railway.json` / `render.yaml`：部署配置。
