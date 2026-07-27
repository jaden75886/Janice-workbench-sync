# Janice 工作台 · 云端同步服务器

零依赖的 Node 同步后端，配合工作台前端的「🔄 云端同步」使用，让多台设备（两台 PC / 手机 / 平板）实时共享同一份数据。

## 它做什么
- 提供 `GET/POST /api/data` 接口，保存整个工作台数据（last-write-wins 整包合并）
- 数据落盘在运行目录的 `data.json`
- 自带 CORS，任意前端域名都能访问
- 端口取环境变量 `PORT`，默认 `8787`

## 三种启动方式

### 方式 A：本地一台常开机器（最快，零注册）
1. 这台机器装好 Node.js（≥18）
2. 进入本目录，运行：`node server.js`
3. 用内网穿透拿到公网地址（任选其一）：
   - `cloudflared tunnel --url http://localhost:8787`（免费，给一个 `*.trycloudflare.com` 临时地址；正式用可在 Cloudflare 绑自己域名）
   - 或 ngrok、花生壳等
4. 把穿透得到的 `https://xxxx` 地址填进工作台 ⚙️ → 同步服务器地址

> 注意：本地机器关机 / 断网，同步就停。适合有台一直开着的电脑。

### 方式 B：Railway（免费额度，最省心）
1. 注册 https://railway.app （可用 GitHub 登录）
2. 新建 Project → Deploy from GitHub repo（先把这个目录 push 到你的 GitHub 仓库）
3. 或直接本地用 Railway CLI：`railway login` → `railway link` → `railway up`
4. 部署完成后 Railway 会给你一个 `https://xxx.railway.app` 地址
5. 填进工作台设置即可

### 方式 C：Render（免费额度）
1. 注册 https://render.com
2. New → Web Service → 连你的 GitHub 仓库（选本目录）
3. Render 读取 `render.yaml` 自动配置，免费套餐即可
4. 部署完给 `https://xxx.onrender.com` 地址，填进工作台

## 工作台里怎么填
打开工作台 → 右上角 ⚙️ → 「🔄 云端同步」：
- **同步服务器地址**：上面拿到的 `https://...` 地址（不用加 /api/data，代码会自动补）
- **本机设备名**：每台设备取不同名，如 `PC-A` / `PC-B` / `iPhone`
- 勾选 **开启同步** → 保存
- 之后每 30 秒自动双向同步，也可点「立即同步」手动触发

两台设备填**同一个服务器地址**、不同设备名 → 数据实时共享。

## 文件说明
- `server.js`：同步服务本体
- `package.json`：启动脚本（Railway/Render 用）
- `railway.json` / `render.yaml` / `Dockerfile`：各平台部署配置（按你用的平台选，平台只会读自己认识的那个）
- `.gitignore`：忽略运行产生的 `data.json`
