# shopee-mcp 工具调用规则

面向 Agent：调用 **Shopee 开放平台 Open API**（非卖家中心 Cookie API）。规则对齐 [Shopee Open Platform](https://open.shopee.com/documents/v2) 文档结构与 `@congminh1254/shopee-sdk` 实现。

---

## 1. 官方文档 ↔ MCP 工具名映射

开放平台文档 URL 形如：

`https://open.shopee.com/documents/v2/v2.{module}.{api_method}`

示例：[v2.ams.get_open_campaign_added_product](https://open.shopee.com/documents/v2/v2.ams.get_open_campaign_added_product?module=127&type=1)

| 文档片段 | SDK | MCP 工具名（Agent 全名加前缀） |
|----------|-----|--------------------------------|
| `v2.ams.get_open_campaign_added_product` | `sdk.ams.getOpenCampaignAddedProduct(params)` | `mcp__shopee-mcp__shopee_ams_get_open_campaign_added_product` |
| `v2.order.get_order_list` | `sdk.order.getOrderList(params)` | `mcp__shopee-mcp__shopee_order_get_order_list` |
| `v2.product.get_item_list` | `sdk.product.getItemList(params)` | `mcp__shopee-mcp__shopee_product_get_item_list` |

**转换规则（文档 → MCP）：**

1. 取 `{module}`、`{api_method}`（均为 **snake_case**，与文档一致）。
2. MCP 工具名：`shopee_{module}_{api_method}`。
3. `params` 内字段名与文档请求参数一致，使用 **snake_case**（不要用 camelCase）。

**转换规则（文档 → 查参数）：**

调用前必须先执行：

```json
{
  "tool_name": "shopee_ams_get_open_campaign_added_product"
}
```

工具：`mcp__shopee-mcp__shopee_tool_schema`  
返回：`fields`、`paramsJsonSchema`、`description`（来自 SDK 类型定义，等价于文档参数表）。

---

## 2. 统一调用信封（店铺 API）

除 `public` / SDK 根方法外，**所有店铺 API** 使用同一结构：

```json
{
  "main_id": 1078087090,
  "shop_id": 1078087090,
  "params": { }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `main_id` | integer | 是 | 主账号 ID；对应 Redis `shopee:token:{main_id}:{shop_id}` |
| `shop_id` | integer | 是 | 店铺 ID；写入签名与 SDK `config.shop_id` |
| `params` | object | 视 API | 与官方文档 / `shopee_tool_schema` 一致；无参可 `{}` 或省略 |

**不需要**在 `params` 里传 `partner_id`、`sign`、`timestamp`、`access_token`——由 MCP 从环境变量与 Redis 自动处理。

### 2.1 不需 main_id / shop_id 的例外

| 类型 | MCP 示例 | 说明 |
|------|----------|------|
| Partner / 授权 | `shopee_public_*`、`shopee_sdk_get_authorization_url` | 仅 `params` |
| SDK 根 | `shopee_sdk_refresh_token` | 见 `shopee_tool_schema` |

---

## 3. 强制工作流（禁止猜参）

```
1. shopee_tools_list（可选，按 manager 过滤）
      ↓
2. shopee_tool_schema（必做，确认 tool_name 与 params 字段）
      ↓
3. 调用 shopee_{module}_{method}（main_id + shop_id + params）
      ↓
4. 若返回 error / 4xx：对照 schema 修正 params，勿手写签名或换 Python
```

**禁止：**

- 未查 `shopee_tool_schema` 就编造 `params` 字段名或类型。
- 用 Bash / Python 自行拼 HMAC 签名或请求 `openplatform.shopee.cn`。
- 把卖家中心 Cookie API（`shopee-seller-center-api` skill）与 Open API 混用。
- 勿经已移除的 Phoenix MCP CLI 网关调 Shopee Open API（应走 `shopee-mcp`）。

---

## 4. 参数类型与文档常见约定

### 4.0 MCP 自动规范化（调用前）

`shopee_sdk_invoke` 与全部店铺 API 在请求 Open API **之前**会经 `normalizeSdkParams` 处理：

| 能力 | 说明 |
|------|------|
| 类型强制 | `"20"` → `20`（number）；OAuth `code` 数字 → string |
| 字段别名 | `page_no` ↔ `pageNo`、`shop_id` ↔ `shopId`（以 schema 的 **canonical 名**为准） |
| 剔除未知键 | 不在 schema 中的字段直接报错，避免 `error_param` |
| 信封 | `main_id` / `shop_id` 可在 invoke 顶层或 `params` 内，均会合并 |

**务必先** `shopee_tool_schema`，使用返回的 `fields[].name`；`fieldAliases` 列出可接受的其它写法。

### 4.1 命名

- **多数模块**为 **snake_case**：`time_range_field`、`page_size`、`item_id`。
- **video 等少数模块** SDK 为 **camelCase**：`pageNo`、`pageSize`（可用 `page_no` 传入，MCP 会映射）。
- 以 [open.shopee.com](https://open.shopee.com/documents/v2) 与 `shopee_tool_schema` 返回的字段名为准。

### 4.2 时间

- 多为 **Unix 秒级时间戳**（integer），如 `time_from`、`time_to`、`update_time_from`。
- 订单列表需配合 `time_range_field`：`create_time` 或 `update_time`；单次查询跨度通常 ≤ **15 天**（见 order 文档说明）。

### 4.3 分页（两类）

| 风格 | 典型字段 | 适用模块示例 |
|------|----------|----------------|
| **cursor** | `page_size`（必填）, `cursor`（可选） | `ams`、`product` 部分接口 |
| **page_no** | `page_no`, `page_size` | 部分 `accountHealth`、`returns` 等（**order 列表用 cursor，见 schema**） |

规则：

- 先读 `shopee_tool_schema` 确认本 API 用哪种分页。
- `page_size` 遵守文档上限（常见 **1–100**，以 schema 为准）。
- cursor 分页：响应含 `next_cursor` / `has_more` 时，下一页把 `cursor` 原样传入 `params`。

### 4.4 列表 / 枚举

- 文档写「多个值用英文逗号连接」时，SDK 可能为 `string`（如 `order_sn_list` 逗号分隔）或 `string[]`——以 **schema 类型** 为准。
- 枚举值大小写敏感（如订单状态 `UNPAID`、`READY_TO_SHIP`）。

### 4.5 ID 类型

- `item_id`、`shop_id`、`model_id`、`campaign_id` 等为 **number**（integer），不要传字符串。

---

## 5. 模块（manager）速查

MCP 工具名中间一段对应 SDK manager，与开放平台 module 一致：

| manager | 工具数 | 文档领域 | 典型场景 |
|---------|--------|----------|----------|
| `product` | 58 | 商品 | 上架、变体、价格库存、类目 |
| `order` | 21 | 订单 | 订单列表、详情、发货、取消 |
| `logistics` | 46 | 物流 | 渠道、运单、发货 |
| `ams` | 36 | 联盟营销 AMS | 开放活动、定向活动、佣金、达人 |
| `ads` | 25 | 广告 | 广告报告（与 AMS 不同） |
| `returns` | 15 | 退货退款 | 退货单列表、争议 |
| `globalProduct` | 34 | 全球商品 | 跨境全球商品 |
| `merchant` | 6 | 商户 | 商户级 |
| `shop` | 9 | 店铺 | 店铺信息 |
| `voucher` | 6 | 优惠券 |  voucher |
| `discount` | 12 | 折扣 | 折扣活动 |
| `payment` | 16 | 支付 | 支付相关 |
| `accountHealth` | 7 | 账户健康 | 迟发货等 |
| `public` | 3 | Partner | 授权、公共 |
| … | … | … | 完整列表用 `shopee_tools_list` |

浏览命令：

```json
{ "manager": "ams" }
```

→ `mcp__shopee-mcp__shopee_tools_list`

---

## 6. 示例：AMS `get_open_campaign_added_product`

文档：[v2.ams.get_open_campaign_added_product](https://open.shopee.com/documents/v2/v2.ams.get_open_campaign_added_product?module=127&type=1)

**MCP 工具：** `shopee_ams_get_open_campaign_added_product`

**params（来自 SDK / schema）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `page_size` | number | 是 | 每页条数，最大 100 |
| `cursor` | string | 否 | 分页游标 |
| `sort_by` | string | 否 | 排序字段 |
| `search_type` | string | 否 | 搜索类型 |
| `search_content` | string | 否 | 搜索内容 |

**调用示例：**

```json
{
  "main_id": 1078087090,
  "shop_id": 1078087090,
  "params": {
    "page_size": 50,
    "cursor": ""
  }
}
```

**响应要点（业务字段在 `response` 内）：**

- `total_count`、`has_more`、`next_cursor`
- `item_list[]`：`item_id`、`campaign_id`、`commission_rate`、`period_start_time`、`period_end_time` 等

**分页下一页：**

```json
{
  "params": {
    "page_size": 50,
    "cursor": "<上一页返回的 next_cursor>"
  }
}
```

### 6.1 AMS 批量任务模式

部分 AMS 写操作（如 `batch_add_products_to_open_campaign`）返回 **`task_id`**，需再调：

- `shopee_ams_get_open_campaign_batch_task_result`  
- `params`: `{ "task_id": "..." }`

规则：写操作后 **不要** 假设立即生效；先轮询 batch task result。

---

## 7. 其他高频 API 简例

### 订单列表 `shopee_order_get_order_list`

```json
{
  "main_id": 1078087090,
  "shop_id": 1078087090,
  "params": {
    "time_range_field": "create_time",
    "time_from": 1714521600,
    "time_to": 1715385600,
    "page_size": 50,
    "cursor": ""
  }
}
```

### 商品列表 `shopee_product_get_item_list`

```json
{
  "params": {
    "offset": 0,
    "page_size": 100,
    "item_status": ["NORMAL"]
  }
}
```

### 全店商品同步 Redis（复合工具，非单 API）

- 工具：`shopee_sync_shop_items_to_redis`
- 用途：分页拉取 NORMAL 商品 + 变体 + 广告 GMV，写入 `shopee:items:{shop_id}`
- 读结果用 **redis-mcp**，不是再次调 product API

---

## 8. 鉴权与环境

| 项 | 规则 |
|----|------|
| Token | 必须存在 Redis `shopee:token:{main_id}:{shop_id}`，JSON 含 `access_token` |
| 环境 | `SHOPEE_ENVIRONMENT=https://openplatform.shopee.cn`（中国跨境） |
| 签名 | MCP 内置 v2 签名，禁止 Agent 自行实现 |
| 403 `error_sign` | 检查 token 是否过期、shop_id 是否与 token 一致、是否误用 seller center API |

---

## 9. 错误处理

| 现象 | 处理 |
|------|------|
| `parse data failed` / 400 | 对照 `shopee_tool_schema` 检查 params 类型与必填项；勿传文档未定义字段 |
| `Redis 里找不到 access_token` | 先写入 token 或核对 main_id/shop_id |
| 空列表 | 确认时间范围、状态筛选、店铺是否正确 |
| 分页不完整 | 根据 `has_more` / `next_cursor` 继续请求，不要重复同一 cursor |

解析错误时：优先阅读返回 JSON 的 `message` / `error`，再结合官方文档该 API 的 **Request / Response** 表修正。

---

## 10. 与官方文档对照清单

调用任意 API 前，确认：

1. [ ] 已在 [Shopee Open Platform](https://open.shopee.com/documents/v2) 找到对应 `v2.{module}.{method}`。
2. [ ] MCP 工具名 = `shopee_{module}_{method}`。
3. [ ] 已调用 `shopee_tool_schema` 获取 `fields`。
4. [ ] `main_id`、`shop_id` 与 Redis token 一致。
5. [ ] `params` 字段名、类型、必填与 schema 一致。
6. [ ] 分页 / 时间 / 枚举按文档限制填写。

---

## 11. 相关资源

| 资源 | 路径 |
|------|------|
| 本规则 | `mcp/shopee-mcp/docs/TOOL_CALL_RULES.md` |
| 部署与 Redis | `mcp/shopee-mcp/docs/INTERFACE.md` |
| Agent Skill | `~/.claude/skills/shopee-mcp/SKILL.md` |
| SDK 源码 | [congminh1254/shopee-sdk](https://github.com/congminh1254/shopee-sdk) |
| 参数元数据 | 构建时 `src/generated/sdk-tool-metadata.json`（`npm run build` 生成） |
