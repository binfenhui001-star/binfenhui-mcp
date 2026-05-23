# gmail-mcp（缤纷汇内置）

基于 [@shinzolabs/gmail-mcp](https://www.npmjs.com/package/@shinzolabs/gmail-mcp) 的 Gmail API stdio MCP，依赖安装在本地 `node_modules/`。

## OAuth 配置

1. 在 [Google Cloud Console](https://console.cloud.google.com/) 创建 OAuth 客户端（桌面应用）。
2. 将 `gcp-oauth.keys.json` 放到 `~/.gmail-mcp/`（或通过 `MCP_CONFIG_DIR` 指定目录）。
3. 首次授权（任选其一）：
   - **会话内**：让助手调用工具 `mcp__gmail__authenticate`，在对话里打开返回的 Google 链接
   - **命令行**：

```bash
cd mcp/gmail-mcp
npm install --omit=dev
npx @shinzolabs/gmail-mcp auth
```

   Google Cloud 控制台需配置重定向 URI：`http://localhost:38472/oauth2callback`（或你设置的 `GMAIL_MCP_HTTP_PORT`）

## 依赖安装

```bash
cd mcp/gmail-mcp
npm install --omit=dev
# 或: npm run prepare
```

桌面端打包前 `desktop/scripts/build-sidecars.ts` 会安装依赖并复制到 `desktop/bundle-resources/mcp/gmail-mcp`（含 `node_modules`，因 Tauri 不会复制被 gitignore 的依赖）。

开发时若 MCP 连接挂起，请执行：

```bash
cd desktop && bun run build:sidecars
```

然后重启 `bun run tauri dev`。

## 本地调试

```bash
export MCP_CONFIG_DIR=~/.gmail-mcp
node node_modules/@shinzolabs/gmail-mcp/dist/index.js
```

## MCP 工具前缀

服务端名称：`gmail` → 工具名 `mcp__gmail__*`（如 `search_gmail_messages`、`send_gmail_message`）。

收发邮件（IMAP/SMTP）请用同目录下的 **`email-mcp`**，二者互补。
