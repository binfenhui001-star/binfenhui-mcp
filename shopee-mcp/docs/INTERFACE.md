# shopee-mcp 接口说明

Shopee **开放平台 API**（Open Platform）MCP 服务，基于 `@congminh1254/shopee-sdk`。  
与 `shopee-seller-center-api`（卖家中心内部 Web API）**不是同一套接口**。

## 部署与调用

| 项 | 说明 |
|----|------|
| MCP 服务名 | `shopee-mcp`（缤纷汇内置 dynamic MCP） |
| 传输 | stdio |
| 启动 | `node --env-file=.env dist/mcp-server.js` |
| 项目路径 | `binfenhui-switch/mcp/shopee-mcp/` |

Agent 侧工具命名：`mcp__shopee-mcp__{tool_name}`

默认 **`SHOPEE_MCP_REGISTER_MODE=lazy`**：仅向模型暴露目录工具 + `shopee_sdk_invoke` 单入口（避免 430+ 工具 schema 撑爆 32k 上下文）。  
设置 `SHOPEE_MCP_REGISTER_MODE=full` 时，会将 **全部 Manager 方法** 注册为独立 MCP 工具，命名规则：

| 类型 | MCP 工具名示例 |
|------|----------------|
| Manager 方法 | `shopee_order_get_order_list` → `sdk.order.getOrderList(params)` |
| SDK 根方法 | `shopee_sdk_get_auth_token` → `sdk.getAuthToken()` |
| 目录 | `shopee_tools_list`（按 manager 列出工具名） |
| 复合同步 | `shopee_sync_shop_items_to_redis` |

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `SHOPEE_ENVIRONMENT` | 是 | `sandbox` / `live` / `china` / `brazil`，或完整基址如 `https://openplatform.shopee.cn` |
| `SHOPEE_PARTNER_ID` | 是 | 开放平台 Partner ID |
| `SHOPEE_PARTNER_KEY` | 是 | Partner Key |
| `REDIS_HOST` | 否 | 默认 `127.0.0.1` |
| `REDIS_PORT` | 否 | 默认 `6379` |
| `REDIS_PASS` | 否 | 密码，空则无 |
| `REDIS_DB` | 否 | 默认 `0` |
| `SHOPEE_MCP_REGISTER_MODE` | 否 | `lazy`（默认）或 `full`；lazy 用 `shopee_sdk_invoke` 调用 catalog |
| `SHOPEE_MCP_REGISTER_ALL` | 否 | 设为 `1` 等同 `REGISTER_MODE=full`（兼容旧配置） |
| `SHOPEE_MCP_MAX_TOOLS` | 否 | `full` 模式下限制注册数量（调试用） |
| `SHOPEE_MCP_TOOL_PREFIX` | 否 | `full` 模式下仅注册指定前缀的工具名 |
| `MABANG_APPKEY` | 马帮工具必填 | gwapi v2 `appkey` |
| `MABANG_SECRET` | 马帮工具必填 | HMAC-SHA256 密钥 |
| `MABANG_API_BASE` | 否 | 默认 `https://gwapi.mabangerp.com/api/v2` |

`SHOPEE_ENVIRONMENT=https://openplatform.shopee.cn` 会映射为 `https://openplatform.shopee.cn/api/v2`（**不含** `/public`；`/public` 仅用于 partner 级接口）。

### 马帮 ERP 库存（gwapi v2）

| MCP 工具名 | 说明 |
|------------|------|
| `mabang_stock_get_stock_quantity` | `stock-get-stock-quantity`，按 SKU 或按天查询 ERP 库存 |
| `mabang_stock_search_by_prefix` | 按 `update_time` 分页拉列表 + 本地 `sku_prefix` 模糊匹配（如 `swi116` → `SWI116-1-M`） |

签名：对请求体 JSON 字符串（字段顺序 `api` → `appkey` → `data` → `timestamp`）做 HMAC-SHA256，十六进制写入 `Authorization`。

参数（snake_case 入参，映射到马帮 `data` 驼峰字段）：

| 参数 | 马帮字段 | 说明 |
|------|----------|------|
| `update_time` | `updateTime` | 按天查询；未传 `stock_skus` 时必填 |
| `stock_skus` | `stockSkus` | 逗号分隔 SKU，最多 100；有则忽略 `update_time` |
| `warehouse_name` | `warehouseName` | 仓库名 |
| `page` | `page` | 页码，默认 1 |

**`mabang_stock_search_by_prefix` 参数：**

| 参数 | 说明 |
|------|------|
| `sku_prefix` | 必填，SKU 片段，不区分大小写 |
| `update_time` | 扫描结束日期，默认今天 |
| `lookback_days` | 往前扫描天数，默认 1，最大 14 |
| `max_pages_per_day` | 每日最多页数，默认 50 |
| `warehouse_name` | 可选仓库过滤 |

### 签名（v2）

店铺 API（GET / POST）base string **相同**：

`partner_id` + `api_path` + `timestamp` + `access_token` + `shop_id`

`api_path` 为 URL 的 pathname，例如 `/api/v2/product/get_item_list`。  
本 MCP 在启动时 patch SDK 的 `ShopeeFetch`，修正中国区基址（`/api/v2`，不含 `/public`）与 `shop_id` 来源，避免 **403 error_sign**。

可选：`SHOPEE_SIGN_POST_BODY=1` 时在 POST 签名末尾追加 `JSON.stringify(body)`（非官方默认，一般不需要）。

## Redis 约定

### Token（只读，由外部系统写入）

```text
shopee:token:{main_id}:{shop_id}
```

值为 JSON，需包含 `access_token`（及可选 `expired_at`）。  
MCP **不会**刷新或写入 token，缺失时工具报错：`Redis 里找不到 access_token`。

检查 token：

```bash
cd binfenhui-switch/mcp/shopee-mcp
npm run redis:tokens
# 或指定 pattern
node --env-file=.env scripts/list-redis-tokens.mjs 'shopee:token:*'
```

### 商品缓存（本 MCP 写入）

```text
shopee:items:{shop_id}
```

值为 **JSON 数组**（每个元素为一条商品聚合对象）。默认 TTL **3600** 秒（可用参数覆盖）。

读取示例（配合全局 `redis-mcp`）：

```text
GET shopee:items:888003524
```

### API 响应缓存（本 MCP 自动写入）

所有 **只读** 店铺 API（方法名以 `get` / `list` / `check` / `search` 开头）在首次调用成功后写入 Redis，后续相同 `main_id` + `shop_id` + `params` 直接命中缓存，避免重复打 Open API。

```text
shopee:api:{main_id}:{shop_id}:{tool_name}:{hash16}
shopee:api:index:{main_id}:{shop_id}          # SET，记录该店全部 API 缓存键
```

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `SHOPEE_CACHE_ENABLED` | `1` | `0` / `false` 关闭自动缓存 |
| `SHOPEE_CACHE_DEFAULT_TTL` | `300` | 默认 TTL（秒） |
| `SHOPEE_CACHE_MAX_BYTES` | `2097152` | 单条响应超过此大小不缓存 |
| `SHOPEE_CACHE_META` | `1` | 响应中带 `_cache: { hit, key, ... }` |

按模块默认 TTL：`order` 120s、`product` 600s、`ads`/`ams` 1800s。

- **写操作**（create/edit/update/delete 等）成功后，自动清除该店 **全部** API 缓存。
- **`shopee_sync_shop_items_to_redis`** 完成后，清除 `shopee_product_*` 相关缓存。
- 手动刷新：工具 **`shopee_cache_invalidate`**（可选 `tool_prefix`）。

读取示例：

```text
GET shopee:api:1078087090:888003524:shopee_ads_get_product_level_campaign_id_list:a1b2c3d4e5f67890
```

---

## MCP 工具

### SDK 方法工具（自动注册）

**店铺 API**（绝大多数）统一入参：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `main_id` | integer | 是 | 主账号 ID |
| `shop_id` | integer | 是 | 店铺 ID |
| `params` | object | 否 | 传给 SDK 方法的参数；**每个工具在 MCP 的 inputSchema / description 中已展开字段名、类型与必填**（构建时从 SDK `.d.ts` 生成） |

**调用前查参数（推荐）**：

```text
mcp__shopee-mcp__shopee_tool_schema
{ "tool_name": "shopee_order_get_order_list" }
```

返回 `fields`、`fieldAliases`、`paramsJsonSchema` 与完整 `description`，避免 params 缺字段或类型错误。

**调用时自动规范化**：`shopee_sdk_invoke` 与全部店铺 API 在发往 Open API 前会执行 `normalizeSdkParams`（类型强制、`page_no`↔`pageNo` 别名、剔除未知字段）。详见 [TOOL_CALL_RULES.md](./TOOL_CALL_RULES.md) §4.0。

示例（查订单列表）：

```text
工具: mcp__shopee-mcp__shopee_order_get_order_list
参数: { "main_id": 1078087090, "shop_id": 1078087090, "params": { "time_range_field": "create_time", "time_from": 1714521600, "time_to": 1715385600, "page_size": 20 } }
```

**Partner / 授权**（`public.*`、`shopee_sdk_get_authorization_url` 等）仅需 `params`，不需 `main_id`/`shop_id`。

浏览工具名：

```text
mcp__shopee-mcp__shopee_tools_list
{ "manager": "order" }
```

构建：`npm run build`（含 `generate-sdk-tool-metadata`，从 SDK 提取 params 说明）

本地统计：`npm run tools:count`

### Agent 调用规则

详见 **[TOOL_CALL_RULES.md](./TOOL_CALL_RULES.md)**：官方文档 URL → MCP 工具名、`main_id`/`shop_id`/`params` 约定、分页与时间戳、各 module 速查、AMS/订单示例与禁止事项。

### `shopee_sync_shop_items_to_redis`

分页拉取店铺 **NORMAL** 状态商品，聚合基础信息、变体、活动指标与广告表现，写入 Redis。

#### 请求参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `main_id` | integer | 是 | — | 主账号 ID（对应 token 键） |
| `shop_id` | integer | 是 | — | 店铺 ID |
| `page_size` | integer | 否 | `100` | 列表分页大小，1–100 |
| `ttl` | integer | 否 | `3600` | Redis 缓存秒数；`0` 表示不过期 |
| `time_range` | integer | 否 | `0` | 广告统计结束日 = 今天 − N 天 |
| `enable_ads_query` | boolean | 否 | `true` | 是否拉 extra_info + 广告 GMV |

#### 内部 Open API 调用链（SDK）

1. `product.getItemList` — `item_status: NORMAL`，分页直到无下一页  
2. `product.getItemBaseInfo` — 每批最多 20 个 `item_id`  
3. `product.getModelList` — 仅 `has_model === true` 的商品  
4. `product.getItemExtraInfo` — 销量/浏览/评分等（`enable_ads_query` 时）  
5. `ads.getGmsItemPerformance` — 按 `start_date` / `end_date`（DD-MM-YYYY）分页  

批次间有 200–500ms 延迟；超时批次最多重试 3 次。

#### 成功响应（structured）

```json
{
  "ok": true,
  "summary": {
    "redis_key": "shopee:items:888003524",
    "ttl": 3600,
    "count": 128,
    "message": "商品全量已写入 Redis",
    "shop_id": 888003524,
    "base_info_errors": [],
    "extra_info_errors": []
  },
  "itemCount": 128
}
```

`summary.base_info_errors` / `extra_info_errors` 为部分批次失败时的非致命警告。

#### 单条商品字段（写入 Redis 的元素）

| 字段 | 说明 |
|------|------|
| `main_id` | 主账号 ID |
| `shop_id` | 店铺 ID |
| `item_id` | 商品 ID |
| `item_name` | 标题 |
| `has_model` | 是否多规格 |
| `update_time` | 更新时间 |
| `brand` | 品牌名 |
| `video_info` | 视频信息 |
| `image_info` | 主图等 |
| `models[]` | 变体：价格、库存、SKU、model_id 等 |
| `extra` | `sale`, `views`, `likes`, `rating_star`, `comment_count`（需 `enable_ads_query`） |
| `ads` | `broad_gmv`, `broad_order`, `expense`, `impression`, `clicks`, ROI 等（需 `enable_ads_query`） |

#### 错误

| 场景 | 典型消息 |
|------|----------|
| 缺 Partner 环境变量 | `缺少环境变量 SHOPEE_*` |
| 无 token | `Redis 里找不到 access_token` |
| main_id/shop_id 为 0 | `主账号ID和店铺ID不能为0` |
| 店铺无 NORMAL 商品 | `summary.warning: 店铺无商品`，`count: 0` |

---

## 与相关组件的关系

| 组件 | 用途 |
|------|------|
| **shopee-mcp**（本服务） | Open API 全店商品 → Redis |
| **redis-mcp**（全局 MCP） | 读/写 Redis 任意键（查 `shopee:items:*`） |
| **shopee-seller-center-api** | 卖家中心 Cookie 内部 API |
| **shopee-product-audit** | 架上商品质检（卖家中心） |

推荐流程：先 `shopee_sync_shop_items_to_redis` 写入缓存 → 再用 `redis-mcp` 或脚本分析 `shopee:items:{shop_id}`。

---

## 本地命令

```bash
cd binfenhui-switch/mcp/shopee-mcp
cp .env.example .env   # 填写 Partner / Redis
npm install && npm run build
npm run mcp:stdio      # 本地 stdio 调试
npm run redis:tokens   # 列出 token 键
```
