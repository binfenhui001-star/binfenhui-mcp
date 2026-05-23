import type { Redis } from "ioredis";

import { invalidateShopApiCacheByPrefix } from "./api-cache.js";
import type { TiktokAppProfile, TiktokCredentialsRegistry } from "./config.js";
import { getSharedRedis } from "./redis-pool.js";
import { getRedisConfig } from "./redis-pool.js";
import { wrapRedisError } from "./redis-errors.js";
import { productsKey } from "./redis-keys.js";
import { SDK_TOOL_CATALOG } from "./sdk-tool-catalog.js";
import {
  createTiktokApiClient,
  getTiktokApiClient,
} from "./tiktok-sdk-client.js";
import { getTiktokAccessToken } from "./redis-token-storage.js";
import { fetchAuthorizedShops } from "./tiktok-auth.js";
import { invokeSdkTool, serializeApiResult } from "./sdk-tool-invoke.js";

const DEFAULT_SEARCH_TOOL =
  "tiktok_product_v202502_products_search_post";

export type SyncProductsParams = {
  registry: TiktokCredentialsRegistry;
  shop_id: string | number;
  app_key?: string;
  app_label?: string;
  page_size?: number;
  max_pages?: number;
  ttl?: number;
  search_tool?: string;
};

export type SyncProductsSuccess = {
  ok: true;
  summary: {
    redis_key: string;
    ttl: number;
    count: number;
    pages: number;
    message: string;
    shop_id: string | number;
    app_key: string;
    app_label: string;
    shop_cipher: string;
    fetched_at: string;
    api_cache_invalidated?: number;
  };
};

function resolveSearchToolName(override?: string): string {
  const fromEnv = process.env.TIKTOK_SYNC_PRODUCTS_TOOL?.trim();
  const name = override?.trim() || fromEnv || DEFAULT_SEARCH_TOOL;
  if (!SDK_TOOL_CATALOG.some((t) => t.toolName === name)) {
    throw new Error(`未知商品搜索工具: ${name}`);
  }
  return name;
}

function parseProductsPage(body: unknown): {
  products: unknown[];
  nextPageToken?: string;
  code?: number;
  message?: string;
} {
  if (typeof body !== "object" || body === null) {
    return { products: [] };
  }
  const record = body as Record<string, unknown>;
  const code = record.code as number | undefined;
  const message = record.message as string | undefined;
  const data = record.data;
  if (typeof data !== "object" || data === null) {
    return { products: [], code, message };
  }
  const dataRec = data as Record<string, unknown>;
  const products = Array.isArray(dataRec.products) ? dataRec.products : [];
  const nextPageToken =
    typeof dataRec.next_page_token === "string" && dataRec.next_page_token
      ? dataRec.next_page_token
      : undefined;
  return { products, nextPageToken, code, message };
}

async function resolveShopCipher(
  app: TiktokAppProfile,
  accessToken: string,
  shopId: string | number,
  record: Awaited<ReturnType<typeof getTiktokAccessToken>>
): Promise<string> {
  if (record?.shop_cipher?.trim()) return record.shop_cipher.trim();
  const shops = await fetchAuthorizedShops(app, accessToken);
  const match = shops.find((s) => String(s.id) === String(shopId));
  if (!match?.cipher) {
    throw new Error(
      `未找到 shop_id=${shopId} 的 shop_cipher，已授权: ${shops.map((s) => s.id).join(", ")}`
    );
  }
  return match.cipher;
}

/** 分页拉取店铺商品并写入 Redis `tiktok:products:{app_key}:{shop_id}` */
export async function syncProductsToRedis(
  params: SyncProductsParams
): Promise<SyncProductsSuccess> {
  const shopId = params.shop_id;
  const pageSize = Math.min(100, Math.max(1, params.page_size ?? 50));
  const maxPages = Math.min(
    200,
    Math.max(
      1,
      params.max_pages ??
        (Number(process.env.TIKTOK_SYNC_MAX_PAGES ?? 50) || 50)
    )
  );
  const ttl =
    params.ttl ?? (Number(process.env.TIKTOK_PRODUCTS_TTL ?? 0) || 0);
  const toolName = resolveSearchToolName(params.search_tool);
  const def = SDK_TOOL_CATALOG.find((t) => t.toolName === toolName)!;

  const preliminary = params.registry.resolve({
    app_key: params.app_key,
    app_label: params.app_label,
  });
  const redis = getSharedRedis();
  const redisConfig = getRedisConfig();
  const record = await getTiktokAccessToken(
    redis,
    shopId,
    params.app_key ?? preliminary.app_key,
    { autoRefresh: "smart", credentials: preliminary }
  );
  const app = params.registry.resolve({
    app_key: params.app_key ?? record?.app_key ?? preliminary.app_key,
    app_label: params.app_label ?? record?.app_label ?? preliminary.label,
  });

  if (!record?.access_token) {
    throw new Error(
      `Redis 无 token：tiktok:token:${app.app_key}:${shopId}，请先 OAuth`
    );
  }

  const accessToken = record.access_token;
  const shopCipher = await resolveShopCipher(app, accessToken, shopId, record);

  await createTiktokApiClient(app);
  const client = getTiktokApiClient(app);

  const all: unknown[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    pages += 1;
    const invokeParams: Record<string, unknown> = {
      shop_cipher: shopCipher,
      pageSize,
      pageToken,
      SearchProductsRequestBody: {},
    };
    const raw = await invokeSdkTool(client, def, invokeParams, accessToken);
    const body = serializeApiResult(raw);
    const parsed = parseProductsPage(body);
    if (parsed.code !== undefined && parsed.code !== 0) {
      throw new Error(
        `商品搜索失败: code=${parsed.code} message=${parsed.message ?? ""}`
      );
    }
    all.push(...parsed.products);
    pageToken = parsed.nextPageToken;
    if (!pageToken) break;
  } while (pages < maxPages);

  const payload = {
    shop_id: String(shopId),
    app_key: app.app_key,
    app_label: app.label,
    shop_cipher: shopCipher,
    fetched_at: new Date().toISOString(),
    total: all.length,
    pages,
    search_tool: toolName,
    products: all,
  };

  const key = productsKey(app.app_key, shopId);
  const serialized = JSON.stringify(payload);
  try {
    if (ttl > 0) {
      await redis.setex(key, ttl, serialized);
    } else {
      await redis.set(key, serialized);
    }
  } catch (err) {
    throw wrapRedisError(err, redisConfig, `写入 ${key} 失败`);
  }

  const invalidated = await invalidateShopApiCacheByPrefix(
    redis,
    app.app_key,
    shopId,
    "tiktok_product_"
  );

  return {
    ok: true,
    summary: {
      redis_key: key,
      ttl,
      count: all.length,
      pages,
      message: "商品全量已写入 Redis",
      shop_id: shopId,
      app_key: app.app_key,
      app_label: app.label,
      shop_cipher: shopCipher,
      fetched_at: payload.fetched_at,
      api_cache_invalidated: invalidated,
    },
  };
}
