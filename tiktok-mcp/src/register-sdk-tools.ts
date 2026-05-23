import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type {
  TiktokAppProfile,
  TiktokCredentialsRegistry,
} from "./config.js";
import {
  attachCacheMeta,
  buildApiCacheKey,
  getCachedApiResponse,
  invalidateShopApiCache,
  isReadOnlySdkTool,
  isSuccessfulTiktokResponse,
  loadApiCacheConfigFromEnv,
  resolveCacheTtlSec,
  setCachedApiResponse,
  apiCacheIndexKey,
} from "./api-cache.js";
import { getSharedRedis } from "./redis-pool.js";
import { getTiktokAccessToken } from "./redis-token-storage.js";
import { fetchAuthorizedShops } from "./tiktok-auth.js";
import { SDK_TOOL_CATALOG, type SdkToolDefinition } from "./sdk-tool-catalog.js";
import {
  createTiktokApiClient,
  getTiktokApiClient,
} from "./tiktok-sdk-client.js";
import { invokeSdkTool, serializeApiResult } from "./sdk-tool-invoke.js";
import { normalizeInvokeEnvelope } from "./sdk-param-normalize.js";
import {
  buildParamsZodSchema,
  formatToolDescription,
  getToolMeta,
} from "./sdk-tool-metadata.js";
import { TIKTOK_ALWAYS_LOAD_META } from "./mcp-meta.js";

export type SdkCatalogToolInput = {
  shop_id?: string | number;
  app_key?: string;
  app_label?: string;
  params?: Record<string, unknown>;
};

const appKeyField = z
  .string()
  .optional()
  .describe("Open API app_key；多应用时必填，或依赖 Redis token 内的 app_key");
const appLabelField = z
  .string()
  .optional()
  .describe("应用别名（TIKTOK_APP_LABEL / TIKTOK_APPS 中的 label）");

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

function buildInputSchema(def: SdkToolDefinition) {
  const meta = getToolMeta(def.toolName);
  const paramsSchema = buildParamsZodSchema(meta);
  const needsShop = meta?.needsShopAuth !== false;

  if (needsShop) {
    return z.object({
      shop_id: z
        .union([z.string(), z.number()])
        .describe("店铺 ID；Redis 键 tiktok:token:{app_key}:{shop_id}"),
      app_key: appKeyField,
      app_label: appLabelField,
      params: paramsSchema,
    });
  }

  return z.object({
    params: paramsSchema,
  });
}

function pickAppSelector(
  input: SdkCatalogToolInput,
  params: Record<string, unknown>
): { app_key?: string; app_label?: string } {
  const appKey =
    input.app_key ??
    (typeof params.app_key === "string" ? params.app_key : undefined) ??
    (typeof params.appKey === "string" ? params.appKey : undefined);
  const appLabel =
    input.app_label ??
    (typeof params.app_label === "string" ? params.app_label : undefined) ??
    (typeof params.appLabel === "string" ? params.appLabel : undefined);
  return { app_key: appKey?.trim(), app_label: appLabel?.trim() };
}

async function resolveShopContext(
  registry: TiktokCredentialsRegistry,
  input: SdkCatalogToolInput,
  params: Record<string, unknown>
): Promise<{
  app: TiktokAppProfile;
  accessToken: string;
  shopId: string | number;
  record: Awaited<ReturnType<typeof getTiktokAccessToken>>;
}> {
  const shopIdRaw = input.shop_id ?? params.shop_id ?? params.shopId;
  if (
    shopIdRaw === undefined ||
    shopIdRaw === null ||
    shopIdRaw === "" ||
    typeof shopIdRaw === "object"
  ) {
    throw new Error("缺少 shop_id（店铺 API 必填）");
  }
  const shopId =
    typeof shopIdRaw === "number" || typeof shopIdRaw === "string"
      ? shopIdRaw
      : String(shopIdRaw);

  const fromParams = params.access_token ?? params.accessToken;
  if (typeof fromParams === "string" && fromParams.trim()) {
    const app = registry.resolve(pickAppSelector(input, params));
    return { app, accessToken: fromParams.trim(), shopId, record: null };
  }

  const selector = pickAppSelector(input, params);
  const preliminaryApp = registry.resolve(selector);
  const redis = getSharedRedis();
  const record = await getTiktokAccessToken(
    redis,
    shopId,
    selector.app_key ?? preliminaryApp.app_key,
    { autoRefresh: "smart", credentials: preliminaryApp }
  );
  const app = registry.resolve({
    ...selector,
    app_key: selector.app_key ?? record?.app_key ?? preliminaryApp.app_key,
    app_label: selector.app_label ?? record?.app_label ?? preliminaryApp.label,
  });

  if (!record?.access_token) {
    const keyHint = app.app_key
      ? `tiktok:token:${app.app_key}:${shopId}`
      : `tiktok:token:${shopId}`;
    throw new Error(
      `Redis 里找不到店铺 ${shopId}（app_key=${app.app_key}）的 access_token，键 ${keyHint}`
    );
  }
  return { app, accessToken: record.access_token, shopId, record };
}

async function resolveShopCipher(
  app: TiktokAppProfile,
  accessToken: string,
  shopId: string | number,
  record: Awaited<ReturnType<typeof getTiktokAccessToken>>
): Promise<string | undefined> {
  if (record?.shop_cipher?.trim()) return record.shop_cipher.trim();
  const shops = await fetchAuthorizedShops(app, accessToken);
  const match = shops.find((s) => String(s.id) === String(shopId));
  return match?.cipher;
}

export async function executeSdkCatalogTool(
  registry: TiktokCredentialsRegistry | null,
  toolName: string,
  input: SdkCatalogToolInput
): Promise<ReturnType<typeof toolSuccess> | ReturnType<typeof toolError>> {
  if (!registry) {
    return toolError(
      "TikTok API 凭据未配置：请在 mcp/.env 设置 TIKTOK_APP_KEY/SECRET 或 TIKTOK_APPS"
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

  const meta = getToolMeta(name);
  let normalized: ReturnType<typeof normalizeInvokeEnvelope>;
  try {
    normalized = normalizeInvokeEnvelope(name, {
      shop_id: input.shop_id,
      app_key: input.app_key,
      app_label: input.app_label,
      params: input.params,
    });
  } catch (err: unknown) {
    return toolError(err instanceof Error ? err.message : String(err));
  }

  const invokeInput: SdkCatalogToolInput = {
    shop_id: normalized.shop_id ?? input.shop_id,
    app_key: normalized.app_key ?? input.app_key,
    app_label: normalized.app_label ?? input.app_label,
    params: normalized.params,
  };

  const params = { ...invokeInput.params };
  let accessToken = "";
  let credentials = registry.resolve(pickAppSelector(input, params));
  const cacheCfg = loadApiCacheConfigFromEnv();
  const redis = getSharedRedis();
  const readOnly = isReadOnlySdkTool(def);
  let cacheKey: string | null = null;
  let cacheIndexKey: string | null = null;
  let shopContext: Awaited<ReturnType<typeof resolveShopContext>> | null = null;

  try {
    if (meta?.needsShopAuth !== false) {
      shopContext = await resolveShopContext(registry, invokeInput, params);
      credentials = shopContext.app;
      accessToken = shopContext.accessToken;
      if (!params.shop_cipher && !params.shopCipher) {
        const cipher = await resolveShopCipher(
          credentials,
          shopContext.accessToken,
          shopContext.shopId,
          shopContext.record
        );
        if (cipher) {
          params.shop_cipher = cipher;
        }
      }
      if (cacheCfg.enabled && readOnly) {
        cacheKey = buildApiCacheKey(
          credentials.app_key,
          shopContext.shopId,
          name,
          params
        );
        cacheIndexKey = apiCacheIndexKey(credentials.app_key, shopContext.shopId);
        const hit = await getCachedApiResponse(redis, cacheKey);
        if (hit) {
          return toolSuccess(
            attachCacheMeta(hit.data, {
              hit: true,
              key: cacheKey,
              ttl_sec: hit.ttl_sec,
              cached_at: hit.cached_at,
            })
          );
        }
      }
    } else if (typeof params.access_token === "string") {
      accessToken = params.access_token;
    }

    await createTiktokApiClient(credentials);
    const client = getTiktokApiClient(credentials);

    const raw = await invokeSdkTool(client, def, params, accessToken);
    let data = serializeApiResult(raw);
    if (process.env.TIKTOK_MCP_DEBUG === "1" && meta?.requestBody) {
      const body = params[meta.requestBody.paramName];
      if (body && typeof body === "object") {
        data = {
          ...(typeof data === "object" && data !== null
            ? (data as Record<string, unknown>)
            : { result: data }),
          _mcp_resolved_request_body: body,
        };
      }
    }

    if (cacheKey && cacheIndexKey && isSuccessfulTiktokResponse(data)) {
      const ttlSec = resolveCacheTtlSec(def);
      await setCachedApiResponse(
        redis,
        cacheKey,
        cacheIndexKey,
        {
          data,
          cached_at: new Date().toISOString(),
          tool_name: name,
          ttl_sec: ttlSec,
        },
        ttlSec,
        cacheCfg.maxPayloadBytes
      );
    }

    if (
      cacheCfg.enabled &&
      !readOnly &&
      shopContext &&
      credentials.app_key
    ) {
      await invalidateShopApiCache(
        redis,
        credentials.app_key,
        shopContext.shopId
      );
    }

    return toolSuccess(
      cacheKey
        ? attachCacheMeta(data, { hit: false, key: cacheKey })
        : data
    );
  } catch (err: unknown) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

export function registerSdkInvokeTool(
  server: McpServer,
  registry: TiktokCredentialsRegistry | null
): void {
  server.registerTool(
    "tiktok_sdk_invoke",
    {
      title: "调用 TikTok Shop SDK 工具（按工具名）",
      description:
        "按 catalog 工具名调用 TikTok Shop Open API。必须先 tiktok_tool_schema。params 自动规范化（snake_case 别名、剔除未知键）。只读缓存 tiktok:api:*；全店商品用 tiktok_sync_products_to_redis。规则见 docs/TOOL_CALL_RULES.md。",
      inputSchema: z.object({
        tool_name: z.string().describe("如 tiktok_product_v202502_products_search_post"),
        shop_id: z.union([z.string(), z.number()]).optional(),
        app_key: appKeyField,
        app_label: appLabelField,
        params: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) =>
      executeSdkCatalogTool(registry, args.tool_name, {
        shop_id: args.shop_id,
        app_key: args.app_key,
        app_label: args.app_label,
        params: args.params,
      })
  );
}

export function registerAllSdkTools(
  server: McpServer,
  registry: TiktokCredentialsRegistry | null,
  maxTools = 0
): number {
  let registered = 0;
  for (const def of SDK_TOOL_CATALOG) {
    if (maxTools > 0 && registered >= maxTools) break;
    const meta = getToolMeta(def.toolName);
    server.registerTool(
      def.toolName,
      {
        title: def.toolName,
        description: meta ? formatToolDescription(def.toolName, meta) : def.toolName,
        inputSchema: buildInputSchema(def),
        annotations: {
          readOnlyHint: isReadOnlySdkTool(def),
          destructiveHint: false,
        },
      },
      async (args) => {
        const a = args as SdkCatalogToolInput;
        return executeSdkCatalogTool(registry, def.toolName, a);
      }
    );
    registered++;
  }
  return registered;
}
