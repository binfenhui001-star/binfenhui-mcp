# 缤纷汇 MCP

Shopee / TikTok 开放平台、Gmail、邮件、Redis、Chrome Browser Relay 等 **stdio MCP** 服务集合，供缤纷汇电商桌面端（`binfenhui-switch`）内置或开发模式加载。

**GitHub：** https://github.com/binfenhui001-star/binfenhui-mcp

## 目录

| 目录 | 说明 |
|------|------|
| `shopee-mcp/` | Shopee Open Platform API（+ 马帮库存工具） |
| `tiktok-mcp/` | TikTok Shop Open API |
| `tikhub-kol-mcp/` | TikTok 红人建联（TikHub API，基于 [tikhub-kol-sourcing](https://github.com/waynefu2020/tikhub-kol-sourcing)） |
| `gmail-mcp/` | Gmail API（`@shinzolabs/gmail-mcp` 包装） |
| `email-mcp/` | 通用 IMAP/SMTP（Python + uv） |
| `mcp-redis/` | Redis MCP（上游 [redis/mcp-redis](https://github.com/redis/mcp-redis)） |
| `browser-relay/` | Chrome 扩展（浏览器自动化中继） |
| `.env.example` | 共享密钥模板（复制为 `.env`） |

## 配置

```bash
cp .env.example .env
# 编辑 SHOPEE_*、TIKTOK_*、REDIS_*、MABANG_*、GEMINI_API_KEY 等
```

安装桌面端后也可使用：`~/.Claude/mcp/.env`。

Gmail OAuth **不要**写在 `.env`，放在 `~/.gmail-mcp/`（见 `gmail-mcp/README.md`）。

## 各服务安装（克隆后）

```bash
# Shopee
cd shopee-mcp && npm ci && npm run build

# TikTok（SDK 已随仓库 vendor/nodejs_sdk 提交，克隆后直接 build）
cd ../tiktok-mcp && npm ci && npm run build

# TikHub 红人建联
cd ../tikhub-kol-mcp && npm ci && npm run build

# Gmail
cd ../gmail-mcp && npm install --omit=dev

# 邮件 MCP
cd ../email-mcp && uv sync

# Redis MCP
cd ../mcp-redis && uv sync
```

## 本地调试（stdio）

```bash
cd shopee-mcp
node --env-file=../.env dist/mcp-server.js
```

## 与桌面端的关系

- **开发**：在 `binfenhui-switch` 仓库根目录 `bun run tauri dev`，自动发现 `mcp/` 下已构建的服务。
- **安装包（core）**：默认 DMG 仅捆绑 `shopee-mcp`、`tiktok-mcp`；Gmail 等需源码开发或 `BUNDLE_MCP_PROFILE=full` 全量打包。

## 桌面端一键安装

在 **设置 → MCP → 从 GitHub 安装 MCP 套件** 中填入仓库地址（默认官方仓）：

`https://github.com/binfenhui001-star/binfenhui-mcp`

安装位置：`~/.Claude/mcp/servers/binfenhui-mcp`，并写入 `~/.Claude/mcp/active-bundle.json`。安装完成后在 **共享环境配置** 填写 API 密钥。

## 发布到 GitHub

见仓库根目录脚本：

```bash
./scripts/publish-mcp-github.sh --help
```

或阅读下方「独立仓库」步骤。

### 独立仓库（推荐）

1. 删除 `mcp-redis/.git`（避免嵌套仓库），或改为 [git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules) 指向 `redis/mcp-redis`。
2. 确认未提交 `.env`、`node_modules/`、`.venv/`；**需提交** `tiktok-mcp/vendor/nodejs_sdk/`（克隆即用）。
3. 在 GitHub 创建空仓库（如 `your-org/binfenhui-mcp`）。
4. 在**本目录**初始化并推送：

```bash
cd mcp
git init
git branch -M main
git add .
git commit -m "Initial commit: BinFenHui MCP servers"
git remote add origin git@github.com:YOUR_ORG/binfenhui-mcp.git
git push -u origin main
```

### 合入主仓库

在 `binfenhui-switch` 根目录：

```bash
git add mcp/
git commit -m "Add MCP servers directory"
git push
```

## 安全

- 勿提交 `.env`、`credentials.json`、`gcp-oauth.keys.json`。
- 若曾误提交密钥，请轮换密钥并使用 `git filter-repo` 清理历史。
