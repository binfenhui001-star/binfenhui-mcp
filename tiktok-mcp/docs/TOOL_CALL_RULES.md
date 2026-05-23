# tiktok-mcp 工具调用规则

面向 Agent：调用 **TikTok Shop Open API**（Partner API / nodejs_sdk），**不是**卖家中心 Cookie 接口。

---

## 1. 官方文档 ↔ MCP 工具名

开放平台文档路径通常含版本与资源，例如：

`/product/202502/products/search` → SDK `ProductV202502Api.ProductsSearchPost`

| SDK 客户端 | MCP 工具名模式 |
|------------|----------------|
| `ProductV202502Api` | `tiktok_product_v202502_{method_snake}` |
| `OrderV202309Api` | `tiktok_order_v202309_{method_snake}` |
| `AuthorizationV202403Api` | `tiktok_authorization_v202403_{method_snake}` |

**转换规则（SDK 方法 → MCP）：**

1. `ApiClient` 去掉末尾 `Api`，再 camelCase → snake_case → 前缀 `tiktok_`（如 `ProductV202502` → `tiktok_product_v202502`）。
2. 方法名 `ProductsSearchPost` → snake_case → `products_search_post`。
3. 完整工具名：`tiktok_product_v202502_products_search_post`。

**版本必须一致**：`v202309` 与 `v202502` 是不同 API，禁止混用工具名。

---

## 2. 统一调用信封（店铺 API）

除 **Authorization** 等 Partner 接口外，店铺 API 使用：

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

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `tool_name` | string | 是 | catalog 中的完整工具名 |
| `shop_id` | string \| number | 是 | 卖家店铺 ID；Redis `tiktok:token:{app_key}:{shop_id}` |
| `app_key` / `app_label` | string | 多应用时 | 见 `tiktok_apps_list` |
| `params` | object | 视 API | **仅业务参数**，见下文 |

### 2.1 禁止放进 `params` 的字段

| 字段 | 正确位置 |
|------|----------|
| `shop_id` / `shopId` | invoke **顶层** `shop_id` |
| `app_key` / `app_label` | invoke 顶层 |
| `access_token` | 默认不写；Redis 自动读取，仅调试时可在 `params` 覆盖 |

### 2.2 MCP 自动注入（勿手写）

以下字段由 MCP 在请求 SDK **之前**填入，Agent **不必**、**不应**猜测：

| SDK 参数名 | 注入来源 |
|------------|----------|
| `xTtsAccessToken` | Redis `access_token` 或 `params.access_token` 覆盖 |
| `contentType` | 默认 `application/json` |
| `shopCipher` | Redis / `tiktok_auth_get_authorized_shops` 解析 |

若 `tiktok_tool_schema` 的 `fields[].agentMustProvide === false`，表示该字段已自动处理。

---

## 3. 强制工作流（禁止猜参）

```
1. tiktok_tools_list（可选 prefix，如 tiktok_product_）
      ↓
2. tiktok_tool_schema（必做：确认 tool_name、fields、必填项）
      ↓
3. tiktok_sdk_invoke（shop_id + params）
      ↓
4. 失败：对照 schema 修正，勿自拼 HTTP / 勿换 Python 脚本
```

**禁止：**

- 未查 `tiktok_tool_schema` 就编造 `params` 字段名。
- 把 Open API 参数写成 Shopee 风格（如 `main_id`、HMAC `sign`）。
- 在 `params` 里传 `shop_id` 却省略顶层 `shop_id`。
- 用错误 API 版本工具（如商品搜索应用 `v202502` 却调 `v202309`）。

---

## 4. 参数命名与类型

### 4.1 命名（camelCase ↔ snake_case）

TikTok nodejs_sdk 方法使用 **camelCase** 位置参数名：

| SDK / schema 名 | 可接受的别名 |
|-----------------|--------------|
| `pageSize` | `page_size` |
| `pageToken` | `page_token` |
| `shopCipher` | `shop_cipher` |
| `SearchProductsRequestBody` | `body`、`search_products_request_body` |

**以 `tiktok_tool_schema` 返回的 `fields[].name` 为准**；`fields[].aliases` 列出其它写法。

### 4.2 MCP 调用前自动规范化

`tiktok_sdk_invoke` 与全部店铺工具在请求前会执行 `normalizeSdkParams`：

| 能力 | 说明 |
|------|------|
| 类型强制 | `"20"` → `20`（number） |
| 别名归并 | `page_size` → `pageSize` |
| 剔除未知键 | 不在 schema 中的字段 **直接报错** |
| 默认值 | `options` 缺省为 `{}`；`contentType` 缺省为 `application/json`（注入层） |
| 信封剥离 | `params` 内的 `shop_id` 会提升到顶层 |

### 4.3 分页

商品搜索等接口（如 `tiktok_product_v202502_products_search_post`）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `pageSize` / `page_size` | number | **必填**，常见 1–100 |
| `pageToken` / `page_token` | string | 首页传 `""` 或省略；下一页用响应 `data.next_page_token` |

### 4.4 RequestBody 类型参数（订单时间筛选等）

`createTimeGe`、`createTimeLt` 属于 **HTTP 请求体**，不是 query 顶层参数。

**方式 A（推荐）** — 显式 `body`：

```json
{
  "tool_name": "tiktok_order_v202309_orders_search_post",
  "shop_id": "7123456789",
  "params": {
    "page_size": 50,
    "body": {
      "createTimeGe": 1714521600,
      "createTimeLt": 1715385600
    }
  }
}
```

**方式 B** — 写在 `params` 顶层（MCP 会自动归入 `GetOrderListRequestBody`）：

```json
{
  "params": {
    "page_size": 50,
    "create_time_ge": 1714521600,
    "create_time_lt": 1715385600
  }
}
```

`tiktok_tool_schema` 返回的 `requestBody.fields` 列出所有可填 body 字段（含 `baseName` 别名）。

**SDK 序列化规则（重要）**：nodejs_sdk 的 `ObjectSerializer` 从对象的 **camelCase** 属性读取（`createTimeGe`），HTTP JSON 里才是 `create_time_ge`。MCP 会把 `body` 内的 snake_case 自动转成 camelCase。请使用 **Unix 秒**（约 10 位），不要用毫秒（13 位）。

**仅传 `createTimeLt` 不传 `createTimeGe`**：API 会从店铺**最早**时间起查，看起来像「全部历史订单」——MCP 现在会直接报错提示。

**仍像历史数据**：先 `tiktok_cache_invalidate` 清 Redis 缓存 `tiktok:api:*`，或设 `TIKTOK_API_CACHE=0` 后重试；调试时可设 `TIKTOK_MCP_DEBUG=1` 看响应里的 `_mcp_resolved_request_body`。

商品搜索等同理：`SearchProductsRequestBody` / `body` / `search_products_request_body`。

### 4.5 `options` 参数

SDK 签名中 `options: { headers: {...} }` 为 **必填位置参数**，但可为空对象。Agent **可省略**，MCP 自动补 `{}`。

---

## 5. 高频工具示例

### 5.1 订单列表 `tiktok_order_v202309_orders_search_post`

```json
{
  "tool_name": "tiktok_order_v202309_orders_search_post",
  "shop_id": "7123456789",
  "params": {
    "page_size": 50,
    "create_time_ge": 1714521600,
    "create_time_lt": 1715385600,
    "body": { "orderStatus": "AWAITING_SHIPMENT" }
  }
}
```

**直连 SDK（不经 MCP）**：

```bash
cd binfenhui-switch/mcp/tiktok-mcp
npm run build
node --env-file=../.env scripts/fetch-orders.mjs \
  --shop-id 7495960439579446253 \
  --create-time-ge 1714521600 --create-time-lt 1715385600
```

### 5.2 商品搜索 `tiktok_product_v202502_products_search_post`

```json
{
  "tool_name": "tiktok_product_v202502_products_search_post",
  "shop_id": "7123456789",
  "params": {
    "page_size": 50,
    "page_token": ""
  }
}
```

带状态筛选：

```json
{
  "params": {
    "page_size": 50,
    "body": { "status": "ACTIVATE" }
  }
}
```

### 5.3 全店商品同步 Redis（复合工具）

- 工具：`tiktok_sync_products_to_redis`
- 默认内部调用 `tiktok_product_v202502_products_search_post` 分页
- 结果键：`tiktok:products:{app_key}:{shop_id}`
- **不要**用手动分页代替该工具做「拉全店 SKU」

### 5.4 授权（无需 shop_id）

| 工具 | 说明 |
|------|------|
| `tiktok_auth_get_authorization_url` | 生成授权链接 |
| `tiktok_auth_exchange_auth_code` | `auth_code` → token 写 Redis |
| `tiktok_auth_get_authorized_shops` | 获取 `id`、`cipher` |

---

## 6. 模块（apiClient）速查

| 前缀 | 领域 |
|------|------|
| `tiktok_product_` | 商品、类目、库存 |
| `tiktok_order_` | 订单 |
| `tiktok_fulfillment_` | 履约 |
| `tiktok_logistics_` | 物流 |
| `tiktok_return_refund_` | 退货退款 |
| `tiktok_promotion_` | 促销 |
| `tiktok_analytics_` | 分析 |
| `tiktok_affiliate_` | 联盟 |
| `tiktok_authorization_` | OAuth（通常不需 shop_id） |

浏览：`tiktok_tools_list` + `prefix: "tiktok_product_v202502"`。

---

## 7. 鉴权与环境

| 项 | 规则 |
|----|------|
| Token | Redis `tiktok:token:{app_key}:{shop_id}` |
| 环境 | `TIKTOK_ENVIRONMENT=sandbox` 或 `live` |
| 签名 | SDK / MCP 内置，禁止 Agent 自实现 |
| 403 / invalid token | 检查 shop_id、app_key 是否与 token 一致 |

---

## 8. 错误处理

| 现象 | 处理 |
|------|------|
| `未知 params 字段` | 仅保留 `tiktok_tool_schema` 中 `fields[].name` 及别名 |
| `缺少必填 params: pageSize` | 传 `page_size` 或 `pageSize`，类型为 number |
| `Redis 里找不到 access_token` | 先 `tiktok_auth_exchange_auth_code` 或核对 shop_id |
| `Required parameter pageSize was null` | 规范化未生效或工具名错误，先 schema 再 invoke |
| 空 `data.products` | 检查 RequestBody 筛选、店铺区域、API 版本 |

---

## 9. 调用前检查清单

1. [ ] 已 `tiktok_tool_schema` 获取 `fields` 与 `rules`。
2. [ ] 工具名版本与业务一致（如商品用 `v202502`）。
3. [ ] `shop_id` 在 invoke 顶层（店铺 API）。
4. [ ] 未传 MCP 注入字段（token、cipher、contentType）除非有意覆盖。
5. [ ] 分页字段类型为 number / string，非嵌套错误对象。
6. [ ] 筛选条件在 `body` / `*RequestBody` 内，而非随意顶层键名。

---

## 10. 相关资源

| 资源 | 路径 |
|------|------|
| 本规则 | `mcp/tiktok-mcp/docs/TOOL_CALL_RULES.md` |
| 部署与 Redis | `mcp/tiktok-mcp/docs/INTERFACE.md` |
| 参数元数据 | `src/generated/sdk-tool-metadata.json`（`npm run generate:catalog`） |
| 规范化实现 | `src/sdk-param-normalize.ts` |
