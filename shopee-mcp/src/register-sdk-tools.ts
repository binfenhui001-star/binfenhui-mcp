import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  attachCacheMeta,
  buildApiCacheKey,
  getCachedApiResponse,
  invalidateShopApiCache,
  isReadOnlySdkTool,
  loadApiCacheConfigFromEnv,
  resolveCacheTtlSec,
  setCachedApiResponse,
  apiCacheIndexKey,
} from "./api-cache.js";
import type { ShopeeCredentials } from "./config.js";
import { getSharedRedis } from "./redis-pool.js";
import { SDK_TOOL_CATALOG, type SdkToolDefinition } from "./sdk-tool-catalog.js";
import {
  closeShopeeSdkSession,
  createShopeeSdkSession,
} from "./shopee-sdk-client.js";
import { invokeSdkTool, serializeApiResult } from "./sdk-tool-invoke.js";
import {
  buildParamsZodSchema,
  formatToolDescription,
  getToolMeta,
} from "./sdk-tool-metadata.js";
import {
  normalizeInvokeEnvelope,
  normalizeSdkParams,
  positiveIntOrUndef,
} from "./sdk-param-normalize.js";
import { SHOPEE_ALWAYS_LOAD_META } from "./mcp-meta.js";

function buildInputSchema(shopContext: boolean, toolName: string) {
  const meta = getToolMeta(toolName);
  const paramsSchema = buildParamsZodSchema(meta);

  if (shopContext) {
    return z.object({
      main_id: z.coerce
        .number()
        .int()
        .positive()
        .describe("主账号 ID，用于 Redis 键 shopee:token:{main_id}:{shop_id}"),
      shop_id: z.coerce
        .number()
        .int()
        .positive()
        .describe("店铺 ID，写入 SDK config.shop_id"),
      params: paramsSchema,
    });
  }

  return z.object({
    params: paramsSchema,
  });
}

function needsShopContext(def: SdkToolDefinition): boolean {
  if (def.manager === "public") return false;
  if (!def.manager) {
    const noShop = new Set(["getAuthorizationUrl", "authenticateWithCode"]);
    return !noShop.has(def.method);
  }
  return true;
}

export type SdkCatalogToolInput = {
  main_id?: number;
  shop_id?: number;
  params?: Record<string, unknown>;
};

export type SdkCatalogToolResult = ReturnType<typeof toolSuccess> | ReturnType<typeof toolError>;

function toolError(message: string, detail?: unknown) {
  const text =
    detail !== undefined
      ? `${message}\n${JSON.stringify(detail, null, 2)}`
      : message;
  return {
    content: [{ type: "text" as const, text }],
    isError: true,
  };
}

function toolSuccess(data: unknown) {
  const text = JSON.stringify(data, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent:
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : { result: data },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSuccessfulShopeeResponse(data: unknown): boolean {
  if (!isPlainObject(data)) return true;
  const err = data.error;
  return err === undefined || err === null || err === "";
}

async function runWithShop(
  credentials: ShopeeCredentials,
  mainId: number,
  shopId: number,
  def: SdkToolDefinition,
  params: Record<string, unknown>
) {
  const cacheCfg = loadApiCacheConfigFromEnv();
  const redis = getSharedRedis();
  const readOnly = isReadOnlySdkTool(def);
  const cacheKey =
    cacheCfg.enabled && readOnly
      ? buildApiCacheKey(mainId, shopId, def.toolName, params)
      : null;

  if (cacheKey) {
    const hit = await getCachedApiResponse(redis, cacheKey);
    if (hit) {
      return attachCacheMeta(hit.data, {
        hit: true,
        key: cacheKey,
        ttl_sec: hit.ttl_sec,
        cached_at: hit.cached_at,
      });
    }
  }

  const session = await createShopeeSdkSession(credentials, mainId, shopId);
  try {
    const raw = await invokeSdkTool(session.sdk, def, params);
    const data = serializeApiResult(raw);

    if (cacheKey && isSuccessfulShopeeResponse(data)) {
      const ttlSec = resolveCacheTtlSec(def);
      await setCachedApiResponse(
        redis,
        cacheKey,
        apiCacheIndexKey(mainId, shopId),
        {
          data,
          cached_at: new Date().toISOString(),
          tool_name: def.toolName,
          ttl_sec: ttlSec,
        },
        ttlSec,
        cacheCfg.maxPayloadBytes
      );
    }

    if (cacheCfg.enabled && !readOnly) {
      await invalidateShopApiCache(redis, mainId, shopId);
    }

    return cacheKey
      ? attachCacheMeta(data, { hit: false, key: cacheKey })
      : data;
  } finally {
    await closeShopeeSdkSession(session);
  }
}

export type RegisterSdkToolsOptions = {
  credentials: ShopeeCredentials | null;
  /** 仅注册名称前缀匹配的工具（调试用） */
  namePrefix?: string;
  /** 最多注册数量（调试用，0=不限制） */
  maxTools?: number;
};

/** 按 catalog 工具名执行 SDK 调用（lazy / full 模式共用） */
export async function executeSdkCatalogTool(
  credentials: ShopeeCredentials | null,
  toolName: string,
  input: SdkCatalogToolInput
): Promise<SdkCatalogToolResult> {
  if (!credentials) {
    return toolError(
      "Shopee API 凭据未配置：请在共享 mcp/.env（或 MCP 设置 → 编辑共享配置）设置 SHOPEE_PARTNER_ID、SHOPEE_PARTNER_KEY、SHOPEE_ENVIRONMENT"
    );
  }
  const name = toolName.trim();
  const def = SDK_TOOL_CATALOG.find((t) => t.toolName === name);
  if (!def) {
    const suggestions = SDK_TOOL_CATALOG.filter((t) => t.toolName.includes(name))
      .slice(0, 10)
      .map((t) => t.toolName);
    return toolError(`未知工具: ${name}`, { suggestions });
  }

  const shopContext = needsShopContext(def);

  let envelope: ReturnType<typeof normalizeInvokeEnvelope>;
  try {
    envelope = normalizeInvokeEnvelope(name, input);
  } catch (err: unknown) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
  const params = envelope.params;

  try {
    if (shopContext) {
      const mainId = envelope.main_id;
      const shopId = envelope.shop_id;
      if (!mainId || !shopId) {
        return toolError("缺少 main_id 或 shop_id（整数，可写在 invoke 顶层或 params 内）");
      }
      const data = await runWithShop(credentials, mainId, shopId, def, params);
      return toolSuccess(data);
    }

    const { ShopeeSDK } = await import("@congminh1254/shopee-sdk");
    const sdk = new ShopeeSDK({
      partner_id: credentials.partner_id,
      partner_key: credentials.partner_key,
      base_url: credentials.base_url,
    });
    const raw = await invokeSdkTool(sdk, def, params);
    return toolSuccess(serializeApiResult(raw));
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number; data?: unknown };
    return toolError(
      e.message ?? String(err),
      e.data !== undefined ? { status: e.status, data: e.data } : undefined
    );
  }
}

/** lazy 模式：单入口调用全部 catalog，避免向模型暴露 400+ 工具 schema */
export function registerSdkInvokeTool(
  server: McpServer,
  credentials: ShopeeCredentials | null
): void {
  server.registerTool(
    "shopee_sdk_invoke",
    {
      title: "调用 Shopee SDK 工具（按工具名）",
      description:
        "按 catalog 工具名调用任意 Shopee Open API（如 shopee_order_get_order_list）。" +
        "先用 shopee_tools_list 发现工具名，再用 shopee_tool_schema 查看 params 字段。",
      inputSchema: z.object({
        tool_name: z
          .string()
          .describe("catalog 工具名，如 shopee_order_get_order_list"),
        main_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe("店铺 API 必填：主账号 ID"),
        shop_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe("店铺 API 必填：店铺 ID"),
        params: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("SDK params（snake_case）；无参可省略或 {}"),
      }),
      annotations: {
        destructiveHint: false,
        readOnlyHint: false,
      },
      _meta: SHOPEE_ALWAYS_LOAD_META,
    },
    async (args) => {
      let input: SdkCatalogToolInput;
      try {
        const envelope = normalizeInvokeEnvelope(args.tool_name.trim(), {
          main_id: args.main_id,
          shop_id: args.shop_id,
          params: args.params,
        });
        input = {
          main_id: envelope.main_id,
          shop_id: envelope.shop_id,
          params: envelope.params,
        };
      } catch (err: unknown) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
      return executeSdkCatalogTool(credentials, args.tool_name, input);
    }
  );
}

export function registerAllSdkTools(
  server: McpServer,
  options: RegisterSdkToolsOptions
): number {
  const prefix = options.namePrefix?.trim();
  const max = options.maxTools ?? 0;
  let registered = 0;

  for (const def of SDK_TOOL_CATALOG) {
    if (prefix && !def.toolName.startsWith(prefix)) continue;
    if (max > 0 && registered >= max) break;

    const shopContext = needsShopContext(def);
    const meta = getToolMeta(def.toolName);
    const inputSchema = buildInputSchema(shopContext, def.toolName);

    server.registerTool(
      def.toolName,
      {
        title: def.toolName,
        description: formatToolDescription(def, meta),
        inputSchema,
        annotations: {
          destructiveHint: false,
          readOnlyHint: def.method.toLowerCase().startsWith("get"),
        },
      },
      async (args) => {
        const input = args as SdkCatalogToolInput;
        return executeSdkCatalogTool(options.credentials, def.toolName, input);
      }
    );
    registered++;
  }

  return registered;
}
