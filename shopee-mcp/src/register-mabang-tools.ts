import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { MabangCredentials } from "./mabang-config.js";
import { getStockQuantity } from "./mabang-client.js";
import { searchStockByPrefix } from "./mabang-stock-search.js";
import { SHOPEE_ALWAYS_LOAD_META } from "./mcp-meta.js";

const stockQuantityInputSchema = z.object({
  stock_skus: z
    .string()
    .optional()
    .describe(
      "库存 SKU，多个用英文逗号分隔，最多 100 个。提供后 update_time 无效"
    ),
  update_time: z
    .string()
    .optional()
    .describe(
      "更新时间（按天维度查询），如 2021-05-01。未传 stock_skus 时必填"
    ),
  warehouse_name: z.string().optional().describe("仓库名称"),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("当前页码，默认 1"),
});

const stockSearchByPrefixInputSchema = z.object({
  sku_prefix: z
    .string()
    .min(1)
    .describe("SKU 前缀或片段，不区分大小写，如 swi116"),
  update_time: z
    .string()
    .optional()
    .describe("按天扫描库存变动列表的结束日期 YYYY-MM-DD，默认今天"),
  lookback_days: z
    .number()
    .int()
    .min(1)
    .max(14)
    .optional()
    .describe("从 update_time 往前扫描的天数，默认 1（仅当天）"),
  max_pages_per_day: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("每个日期最多拉取页数，默认 50，每页约 100 条"),
  warehouse_name: z.string().optional().describe("仅扫描指定仓库"),
});

function mabangCredentialsError() {
  return {
    content: [
      {
        type: "text" as const,
        text: "马帮 ERP 凭据未配置：请在 mcp/.env 或 mcp/shopee-mcp/.env 设置 MABANG_APPKEY、MABANG_SECRET（可选 MABANG_API_BASE）",
      },
    ],
    isError: true as const,
  };
}

export function registerMabangTools(
  server: McpServer,
  credentials: MabangCredentials | null
): void {
  server.registerTool(
    "mabang_stock_get_stock_quantity",
    {
      title: "马帮 ERP — 查询库存数量",
      description:
        "调用马帮 gwapi v2 `stock-get-stock-quantity`，查询 ERP 库存。需配置 MABANG_APPKEY、MABANG_SECRET。按天查库存传 update_time；按 SKU 查传 stock_skus（逗号分隔，最多 100）。",
      inputSchema: stockQuantityInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: SHOPEE_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!credentials) return mabangCredentialsError();

      try {
        const result = await getStockQuantity(credentials, {
          stockSkus: args.stock_skus,
          updateTime: args.update_time,
          warehouseName: args.warehouse_name,
          page: args.page,
        });
        const payload = {
          ok: true,
          api: "stock-get-stock-quantity",
          response: result,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "mabang_stock_search_by_prefix",
    {
      title: "马帮 ERP — 按 SKU 前缀搜索库存",
      description:
        "按 update_time 分页拉取 stock-get-stock-quantity 当日（或近几天）库存列表，在本地按 sku_prefix 模糊匹配。适用于 SWI116 这类父 SKU 不存在、仅有 SWI116-1-M 等变体的情况。精确查单个 SKU 请用 mabang_stock_get_stock_quantity。",
      inputSchema: stockSearchByPrefixInputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: SHOPEE_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!credentials) return mabangCredentialsError();

      try {
        const payload = await searchStockByPrefix(credentials, {
          skuPrefix: args.sku_prefix,
          updateTime: args.update_time,
          lookbackDays: args.lookback_days,
          maxPagesPerDay: args.max_pages_per_day,
          warehouseName: args.warehouse_name,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
          structuredContent: payload,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    }
  );
}
