#!/usr/bin/env node
import "./bootstrap-process.js";
import { patchShopeeSdkFetch } from "./patch-shopee-sdk.js";

patchShopeeSdkFetch();

import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { loadCredentialsFromEnvOptional } from "./config.js";
import { loadMabangCredentialsFromEnvOptional } from "./mabang-config.js";
import { registerMabangTools } from "./register-mabang-tools.js";
import { SHOPEE_ALWAYS_LOAD_META } from "./mcp-meta.js";
import { SDK_TOOL_CATALOG } from "./sdk-tool-catalog.js";
import { paramFieldAliasGuide } from "./sdk-param-normalize.js";
import {
  formatToolDescription,
  getToolMeta,
  metaToJsonSchemaParams,
} from "./sdk-tool-metadata.js";
import {
  invalidateShopApiCache,
  invalidateShopApiCacheByPrefix,
  loadApiCacheConfigFromEnv,
} from "./api-cache.js";
import {
  registerAllSdkTools,
  registerSdkInvokeTool,
} from "./register-sdk-tools.js";
import { getSharedRedis } from "./redis-pool.js";
import { syncShopItemsToRedis, type SyncShopSuccess } from "./shopee-sync.js";

const syncToolInputSchema = z.object({
  main_id: z.number().int().positive(),
  shop_id: z.number().int().positive(),
  page_size: z.number().int().min(1).max(100).optional(),
  ttl: z.number().int().min(0).optional(),
  time_range: z.number().int().min(0).optional(),
  enable_ads_query: z.boolean().optional(),
});

export type ShopeeMcpRegisterMode = "lazy" | "full";

function parseRegisterLimit(): number {
  const raw = process.env.SHOPEE_MCP_MAX_TOOLS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 默认 lazy：不向模型注册 400+ 独立工具 schema，避免撑爆 32k 上下文 */
export function resolveShopeeMcpRegisterMode(): ShopeeMcpRegisterMode {
  const explicit = process.env.SHOPEE_MCP_REGISTER_MODE?.trim().toLowerCase();
  if (explicit === "full" || explicit === "lazy") {
    return explicit;
  }
  if (
    process.env.SHOPEE_MCP_REGISTER_ALL === "1" ||
    process.env.SHOPEE_MCP_REGISTER_ALL === "true"
  ) {
    return "full";
  }
  if (parseRegisterLimit() > 0) {
    return "full";
  }
  return "lazy";
}

async function main(): Promise<void> {
  const credentials = loadCredentialsFromEnvOptional();
  const mabangCredentials = loadMabangCredentialsFromEnvOptional();
  if (!credentials) {
    console.error(
      "[shopee-mcp] 未配置 SHOPEE_PARTNER_ID/KEY/ENVIRONMENT：目录工具可用，invoke/同步类调用将返回凭据错误"
    );
  }
  if (!mabangCredentials) {
    console.error(
      "[shopee-mcp] 未配置 MABANG_APPKEY/SECRET：mabang_stock_get_stock_quantity 将返回凭据错误"
    );
  }
  const toolCount = SDK_TOOL_CATALOG.length;

  const server = new McpServer(
    { name: "shopee-sdk-mcp", version: "1.0.0" },
    {
      instructions:
        `Shopee Open API MCP（catalog ${toolCount}）。lazy：shopee_tools_list → shopee_tool_schema → shopee_sdk_invoke。店铺 API 需 main_id+shop_id+params；token：Redis shopee:token:{main_id}:{shop_id}。马帮 ERP：mabang_stock_get_stock_quantity、mabang_stock_search_by_prefix（MABANG_APPKEY/SECRET）。`,
    }
  );

  server.registerTool(
    "shopee_tool_schema",
    {
      title: "查询 Shopee MCP 工具的 params 参数说明",
      description:
        "返回指定 MCP 工具（如 shopee_order_get_order_list）的 params 字段名、类型、必填与说明。调用 SDK 工具前应先查此接口，避免参数错误。",
      inputSchema: z.object({
        tool_name: z
          .string()
          .describe("MCP 工具名，如 shopee_order_get_order_list"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: SHOPEE_ALWAYS_LOAD_META,
    },
    async (args) => {
      const name = args.tool_name.trim();
      const def = SDK_TOOL_CATALOG.find((t) => t.toolName === name);
      const meta = getToolMeta(name);
      if (!def || !meta) {
        const suggestions = SDK_TOOL_CATALOG.filter((t) =>
          t.toolName.includes(name)
        )
          .slice(0, 10)
          .map((t) => t.toolName);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  error: "unknown_tool",
                  tool_name: name,
                  suggestions,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
      const payload = {
        tool_name: name,
        description: formatToolDescription(def, meta),
        sdkPath: meta.sdkPath,
        paramsType: meta.paramsType,
        paramsOptional: meta.paramsOptional,
        fields: meta.fields,
        fieldAliases: paramFieldAliasGuide(meta),
        paramsJsonSchema: metaToJsonSchemaParams(meta),
        paramRules: [
          "Use canonical field names from fields[].name (video APIs may use pageNo; order APIs use page_no).",
          "Numeric fields accept JSON numbers or numeric strings; strings accept string values.",
          "Unknown keys are stripped before calling the API.",
        ],
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    "shopee_tools_list",
    {
      title: "列出 Shopee MCP 工具目录",
      description:
        "返回已注册的 SDK 工具名列表，可按 manager 过滤。用于查找订单、商品等 API 对应的 MCP 工具名。",
      inputSchema: z.object({
        manager: z
          .string()
          .optional()
          .describe("SDK 管理器名，如 order、product、ads"),
        prefix: z.string().optional().describe("工具名前缀过滤，如 shopee_order"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: SHOPEE_ALWAYS_LOAD_META,
    },
    async (args) => {
      let list = SDK_TOOL_CATALOG;
      const manager = args.manager?.trim();
      const prefix = args.prefix?.trim();
      if (manager) {
        list = list.filter((t) => t.manager === manager);
      }
      if (prefix) {
        list = list.filter((t) => t.toolName.startsWith(prefix));
      }
      const grouped: Record<string, string[]> = {};
      const withParamsHint: string[] = [];
      for (const t of list) {
        const key = t.manager || "_sdk";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(t.toolName);
        const meta = getToolMeta(t.toolName);
        if (meta?.fields?.length) {
          withParamsHint.push(t.toolName);
        }
      }
      const payload = {
        total: list.length,
        catalogSize: toolCount,
        grouped,
        hint: "调用任意工具前请用 shopee_tool_schema 查看 params 字段；工具 description 已含字段摘要。",
        sampleWithParams: withParamsHint.slice(0, 5),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    "shopee_cache_invalidate",
    {
      title: "清除 Shopee API Redis 缓存",
      description:
        "删除 shopee:api:{main_id}:{shop_id}:* 缓存。可选 tool_prefix 仅清除某类工具（如 shopee_product_）。下次只读 API 将重新拉取。",
      inputSchema: z.object({
        main_id: z.number().int().positive(),
        shop_id: z.number().int().positive(),
        tool_prefix: z
          .string()
          .optional()
          .describe("工具名前缀，如 shopee_product_、shopee_ads_"),
      }),
      annotations: { destructiveHint: true, readOnlyHint: false },
      _meta: SHOPEE_ALWAYS_LOAD_META,
    },
    async (args) => {
      const redis = getSharedRedis();
      const prefix = args.tool_prefix?.trim();
      const deleted = prefix
        ? await invalidateShopApiCacheByPrefix(
            redis,
            args.main_id,
            args.shop_id,
            prefix
          )
        : await invalidateShopApiCache(redis, args.main_id, args.shop_id);
      const payload = {
        ok: true,
        deleted_keys: deleted,
        scope: prefix ?? "all",
        cache_enabled: loadApiCacheConfigFromEnv().enabled,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  const registerMode = resolveShopeeMcpRegisterMode();
  let registered = 0;

  if (registerMode === "full") {
    registered = registerAllSdkTools(server, {
      credentials,
      namePrefix: process.env.SHOPEE_MCP_TOOL_PREFIX?.trim() || undefined,
      maxTools: parseRegisterLimit(),
    });
    console.error(
      `[shopee-mcp] register_mode=full registered ${registered} SDK tools (catalog ${toolCount})`
    );
  } else {
    registerSdkInvokeTool(server, credentials);
    console.error(
      `[shopee-mcp] register_mode=lazy catalog ${toolCount} tools via shopee_sdk_invoke (+ meta tools)`
    );
  }

  registerMabangTools(server, mabangCredentials);

  server.registerTool(
    "shopee_sync_shop_items_to_redis",
    {
      title: "Shopee 全店商品同步到 Redis",
      description:
        "分页拉取商品列表 → base_info → model → extra_info → 广告 GMV，整包 JSON 写入 Redis `shopee:items:{shop_id}`。",
      inputSchema: syncToolInputSchema,
      outputSchema: z.object({
        ok: z.literal(true),
        summary: z.record(z.string(), z.unknown()),
        itemCount: z.number(),
      }),
      annotations: {
        destructiveHint: false,
      },
      _meta: SHOPEE_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!credentials) {
        return {
          content: [
            {
              type: "text",
              text: "Shopee API 凭据未配置：请在共享 mcp/.env（或 MCP 设置 → 编辑共享配置）设置 SHOPEE_PARTNER_ID、SHOPEE_PARTNER_KEY、SHOPEE_ENVIRONMENT",
            },
          ],
          isError: true,
        };
      }
      try {
        const result: SyncShopSuccess = await syncShopItemsToRedis({
          credentials,
          main_id: args.main_id,
          shop_id: args.shop_id,
          page_size: args.page_size,
          ttl: args.ttl,
          time_range: args.time_range,
          enable_ads_query: args.enable_ads_query,
        });

        const structured = {
          ok: true as const,
          summary: { ...result.summary } as Record<string, unknown>,
          itemCount: result.items.length,
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(structured, null, 2),
            },
          ],
          structuredContent: structured,
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
