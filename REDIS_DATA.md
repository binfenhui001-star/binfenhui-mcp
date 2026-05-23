# MCP 拉数进 Redis 约定

Shopee / TikTok 共用 `mcp/.env` 中的 `REDIS_*`。

## Redis 键

| 用途 | Shopee | TikTok |
|------|--------|--------|
| Token | `shopee:token:{main_id}:{shop_id}` | `tiktok:token:{app_key}:{shop_id}` |
| 读 API 缓存 | `shopee:api:{main_id}:{shop_id}:{tool}:{hash}` | `tiktok:api:{app_key}:{shop_id}:{tool}:{hash}` |
| 全店商品 | `shopee:items:{shop_id}` | `tiktok:products:{app_key}:{shop_id}` |

## Agent 约束

桌面/CLI 在检测到内置 Shopee 或 TikTok MCP 时，会向系统提示追加 **Redis 数据策略**（`src/utils/builtinMcp/ecommerceRedisDataPrompt.ts`）；可用 `BINFENHUI_ECOMMERCE_REDIS_PROMPT=0` 关闭。项目内还有 `.Claude/rules/ecommerce-mcp-redis.md`。

1. **禁止**默认把拉数结果写到仓库内 `.json`（除非用户明确要求导出文件）。
2. **Shopee 全店商品**：先 `shopee_sync_shop_items_to_redis`，再读 `shopee:items:{shop_id}`。
3. **TikTok 全店商品**：先 `tiktok_sync_products_to_redis`，再读 `tiktok:products:{app_key}:{shop_id}`。
4. 零散只读查询：`shopee_sdk_invoke` / `tiktok_sdk_invoke`（成功响应自动写入 `*:api:*` 缓存）。
5. 写操作后相关 API 缓存会被自动失效；也可手动 `*_cache_invalidate`。

## 环境变量

见 `mcp/.env.example` 中 `SHOPEE_CACHE_*`、`TIKTOK_CACHE_*`。
