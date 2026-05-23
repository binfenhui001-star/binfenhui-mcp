#!/usr/bin/env node
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { bootstrapTiktokMcpEnv } from "./bootstrap-env.js";
import {
  invalidateShopApiCache,
  invalidateShopApiCacheByPrefix,
  loadApiCacheConfigFromEnv,
} from "./api-cache.js";
import { loadTiktokCredentialsRegistryOptional } from "./config.js";
import { getSharedRedis } from "./redis-pool.js";
import { syncProductsToRedis } from "./tiktok-sync.js";

bootstrapTiktokMcpEnv();
import { TIKTOK_ALWAYS_LOAD_META } from "./mcp-meta.js";
import { registerAuthTools } from "./register-auth-tools.js";
import {
  registerAllSdkTools,
  registerSdkInvokeTool,
} from "./register-sdk-tools.js";
import { SDK_TOOL_CATALOG } from "./sdk-tool-catalog.js";
import {
  paramFieldAliasGuide,
  requestBodyFieldGuide,
} from "./sdk-param-normalize.js";
import {
  formatToolDescription,
  getToolMeta,
  metaToJsonSchemaParams,
} from "./sdk-tool-metadata.js";
import { resolveTiktokSdkRoot } from "./tiktok-sdk-root.js";

export type TiktokMcpRegisterMode = "lazy" | "full";

function parseRegisterLimit(): number {
  const raw = process.env.TIKTOK_MCP_MAX_TOOLS?.trim();
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function resolveTiktokMcpRegisterMode(): TiktokMcpRegisterMode {
  const explicit = process.env.TIKTOK_MCP_REGISTER_MODE?.trim().toLowerCase();
  if (explicit === "full" || explicit === "lazy") return explicit;
  if (
    process.env.TIKTOK_MCP_REGISTER_ALL === "1" ||
    process.env.TIKTOK_MCP_REGISTER_ALL === "true"
  ) {
    return "full";
  }
  if (parseRegisterLimit() > 0) return "full";
  return "lazy";
}

async function main(): Promise<void> {
  const registry = loadTiktokCredentialsRegistryOptional();
  const toolCount = SDK_TOOL_CATALOG.length;

  try {
    console.error(`[tiktok-mcp] SDK root: ${resolveTiktokSdkRoot()}`);
  } catch (err: unknown) {
    console.error(
      `[tiktok-mcp] SDK root 未配置: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!registry) {
    console.error(
      "[tiktok-mcp] 未配置 TikTok 应用：invoke 将返回凭据错误"
    );
  } else {
    console.error(
      `[tiktok-mcp] 已加载 ${registry.apps.length} 个应用，默认 label=${registry.defaultLabel}`
    );
  }

  const server = new McpServer(
    { name: "tiktok-sdk-mcp", version: "1.0.0" },
    {
      instructions:
        `TikTok Shop Open API MCP（catalog ${toolCount}）。强制流程：tiktok_tools_list → tiktok_tool_schema → tiktok_sdk_invoke。店铺 API：shop_id + params（业务字段用 schema 的 camelCase 名或 snake_case 别名）。token/shop_cipher/contentType 由 MCP 注入。规则见 docs/TOOL_CALL_RULES.md。`,
    }
  );

  server.registerTool(
    "tiktok_tool_schema",
    {
      title: "查询 TikTok MCP 工具参数",
      description: "返回指定工具的 positional 参数说明（page_size、access_token 等）。",
      inputSchema: z.object({
        tool_name: z.string(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      const name = args.tool_name.trim();
      const def = SDK_TOOL_CATALOG.find((t) => t.toolName === name);
      const meta = getToolMeta(name);
      if (!def || !meta) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ error: "unknown_tool", tool_name: name }, null, 2),
            },
          ],
          isError: true,
        };
      }
      const payload = {
        tool_name: name,
        description: formatToolDescription(name, meta),
        sdkPath: meta.sdkPath,
        positionalParams: meta.positionalParams,
        fields: paramFieldAliasGuide(meta),
        requestBody: meta.requestBody
          ? {
              paramName: meta.requestBody.paramName,
              type: meta.requestBody.type,
              fields: requestBodyFieldGuide(meta),
              hint: "createTimeGe/createTimeLt 等须放在 body 内，或写在 params 顶层由 MCP 自动归入 body",
            }
          : undefined,
        needsShopAuth: meta.needsShopAuth,
        paramsJsonSchema: metaToJsonSchemaParams(meta),
        rules: {
          workflow: "tiktok_tools_list → tiktok_tool_schema → tiktok_sdk_invoke",
          envelope: meta.needsShopAuth
            ? { shop_id: "required on invoke", params: "business fields only" }
            : { params: "only" },
          mcpInjected: ["xTtsAccessToken", "contentType", "shopCipher"],
          naming: "SDK uses camelCase (pageSize); snake_case aliases accepted (page_size)",
          doc: "docs/TOOL_CALL_RULES.md",
        },
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  server.registerTool(
    "tiktok_tools_list",
    {
      title: "列出 TikTok MCP 工具目录",
      description: "按 API 客户端分组列出工具名，可用 prefix 过滤。",
      inputSchema: z.object({
        api_client: z.string().optional().describe("如 ProductV202502Api"),
        prefix: z.string().optional().describe("工具名前缀，如 tiktok_product"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      let list = SDK_TOOL_CATALOG;
      const apiClient = args.api_client?.trim();
      const prefix = args.prefix?.trim();
      if (apiClient) {
        list = list.filter((t) => t.apiClient === apiClient);
      }
      if (prefix) {
        list = list.filter((t) => t.toolName.startsWith(prefix));
      }
      const grouped: Record<string, string[]> = {};
      for (const t of list) {
        if (!grouped[t.apiClient]) grouped[t.apiClient] = [];
        grouped[t.apiClient].push(t.toolName);
      }
      const payload = {
        total: list.length,
        catalogSize: toolCount,
        grouped,
        hint: "店铺 API 需 shop_id；全店商品用 tiktok_sync_products_to_redis；零散读 API 用 tiktok_sdk_invoke（自动缓存）",
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    }
  );

  registerAuthTools(server, registry);

  const syncInputSchema = z.object({
    shop_id: z.union([z.string(), z.number()]),
    app_key: z.string().optional(),
    app_label: z.string().optional(),
    page_size: z.number().int().min(1).max(100).optional(),
    max_pages: z.number().int().min(1).max(200).optional(),
    ttl: z.number().int().min(0).optional(),
    search_tool: z.string().optional(),
  });

  server.registerTool(
    "tiktok_cache_invalidate",
    {
      title: "清除 TikTok API Redis 缓存",
      description:
        "删除 tiktok:api:{app_key}:{shop_id}:* 缓存。可选 tool_prefix（如 tiktok_product_）。",
      inputSchema: z.object({
        shop_id: z.union([z.string(), z.number()]),
        app_key: z.string().optional(),
        app_label: z.string().optional(),
        tool_prefix: z
          .string()
          .optional()
          .describe("工具名前缀，如 tiktok_product_"),
      }),
      annotations: { destructiveHint: true, readOnlyHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!registry) {
        return {
          content: [
            {
              type: "text",
              text: "TikTok 凭据未配置",
            },
          ],
          isError: true,
        };
      }
      const app = registry.resolve({
        app_key: args.app_key,
        app_label: args.app_label,
      });
      const redis = getSharedRedis();
      const prefix = args.tool_prefix?.trim();
      const deleted = prefix
        ? await invalidateShopApiCacheByPrefix(
            redis,
            app.app_key,
            args.shop_id,
            prefix
          )
        : await invalidateShopApiCache(redis, app.app_key, args.shop_id);
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

  server.registerTool(
    "tiktok_sync_products_to_redis",
    {
      title: "TikTok 全店商品同步到 Redis",
      description:
        "分页拉取商品列表，整包 JSON 写入 Redis `tiktok:products:{app_key}:{shop_id}`（默认 ProductsSearchPost）。",
      inputSchema: syncInputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!registry) {
        return {
          content: [
            {
              type: "text",
              text: "TikTok 凭据未配置：请在共享 mcp/.env 设置 TIKTOK_APP_KEY/SECRET 或 TIKTOK_APPS",
            },
          ],
          isError: true,
        };
      }
      try {
        const result = await syncProductsToRedis({
          registry,
          shop_id: args.shop_id,
          app_key: args.app_key,
          app_label: args.app_label,
          page_size: args.page_size,
          max_pages: args.max_pages,
          ttl: args.ttl,
          search_tool: args.search_tool,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
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

  const registerMode = resolveTiktokMcpRegisterMode();
  if (registerMode === "full") {
    const n = registerAllSdkTools(server, registry, parseRegisterLimit());
    console.error(`[tiktok-mcp] register_mode=full registered ${n} tools`);
  } else {
    registerSdkInvokeTool(server, registry);
    console.error(
      `[tiktok-mcp] register_mode=lazy catalog ${toolCount} via tiktok_sdk_invoke`
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
