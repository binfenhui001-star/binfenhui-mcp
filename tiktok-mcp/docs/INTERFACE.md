# tiktok-mcp 接口说明

TikTok Shop **开放平台 API** MCP，基于 `/Users/hblack/Documents/nodejs_sdk`（可通过 `TIKTOK_SDK_ROOT` 覆盖）。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `TIKTOK_APP_KEY` | 是 | Partner App Key |
| `TIKTOK_APP_SECRET` | 是 | Partner App Secret |
| `TIKTOK_ENVIRONMENT` | 否 | `sandbox` 或 `live`（默认 live） |
| `TIKTOK_SDK_ROOT` | 否 | nodejs_sdk 目录，默认 `../../../../nodejs_sdk` |
| `TIKTOK_MCP_REGISTER_MODE` | 否 | `lazy`（默认）或 `full` |
| `REDIS_*` | 否 | 店铺 token：`tiktok:token:{shop_id}` JSON |

## MCP 工具（lazy 模式）

**调用规则（Agent 必读）：** [`docs/TOOL_CALL_RULES.md`](./TOOL_CALL_RULES.md)

| 工具 | 说明 |
|------|------|
| `tiktok_tools_list` | 列出 catalog（可按 `api_client` / `prefix` 过滤） |
| `tiktok_tool_schema` | 查看 positional 参数、别名、`agentMustProvide`、注入规则 |
| `tiktok_sdk_invoke` | 按工具名调用 API（调用前自动规范化 params） |

### 多应用凭据

支持三种配置方式（可混用，按 `app_key` 去重）：

1. **默认**：`TIKTOK_APP_KEY` + `TIKTOK_APP_SECRET`（可选 `TIKTOK_APP_LABEL`）
2. **后缀**：`TIKTOK_APP_KEY_US` + `TIKTOK_APP_SECRET_US` + `TIKTOK_APP_LABEL_US`
3. **JSON**：`TIKTOK_APPS=[{"label":"us","app_key":"...","app_secret":"..."}]`

调用店铺 API / OAuth 时传 `app_key` 或 `app_label`；仅一个应用时可省略。Redis：`tiktok:token:{app_key}:{shop_id}`。

| 工具 | 说明 |
|------|------|
| `tiktok_apps_list` | 列出已配置的全部应用 |

### OAuth / Token

| 工具 | 说明 |
|------|------|
| `tiktok_auth_get_authorization_url` | 生成卖家授权链接（需指定应用） |
| `tiktok_auth_exchange_auth_code` | `auth_code` → token，并写入 Redis |
| `tiktok_auth_refresh_token` | 刷新 token |
| `tiktok_auth_get_authorized_shops` | 查询已授权店铺（id、cipher） |
| `tiktok_auth_save_token_to_redis` | 手动写入 Redis |

授权流程：生成链接 → 卖家授权 → 回调拿 `auth_code` → `tiktok_auth_exchange_auth_code`。

## 调用示例

```json
{
  "tool_name": "tiktok_product_v202502_products_search_post",
  "shop_id": "7123456789",
  "params": {
    "page_size": 20,
    "page_token": ""
  }
}
```

`access_token` 默认从 Redis 读取；也可在 `params.access_token` 中传入。

订单列表（`createTimeGe` / `createTimeLt` 在请求体内）：

```json
{
  "tool_name": "tiktok_order_v202309_orders_search_post",
  "shop_id": "7495960439579446253",
  "params": {
    "page_size": 50,
    "create_time_ge": 1714521600,
    "create_time_lt": 1715385600
  }
}
```

直连 SDK：`node --env-file=../.env scripts/fetch-orders.mjs --shop-id ... --create-time-ge ... --create-time-lt ...`

## 本地命令

```bash
cd binfenhui-switch/mcp/tiktok-mcp
cp .env.example .env
npm install && npm run build
npm run mcp:stdio
```

重新生成 catalog（SDK 升级后）：

```bash
TIKTOK_SDK_ROOT=/Users/hblack/Documents/nodejs_sdk npm run generate:catalog
```
