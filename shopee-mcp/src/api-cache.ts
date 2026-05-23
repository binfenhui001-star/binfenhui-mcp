import { createHash } from "node:crypto";

import type { Redis } from "ioredis";

import type { SdkToolDefinition } from "./sdk-tool-catalog.js";

export interface ApiCacheConfig {
  enabled: boolean;
  defaultTtlSec: number;
  maxPayloadBytes: number;
  includeMeta: boolean;
}

const NEVER_CACHE_TOOLS = new Set([
  "shopee_sdk_get_authorization_url",
  "shopee_sdk_authenticate_with_code",
  "shopee_sdk_get_auth_token",
  "shopee_sdk_refresh_token",
]);

const MANAGER_TTL_SEC: Record<string, number> = {
  order: 120,
  product: 600,
  ads: 1800,
  ams: 1800,
  payment: 300,
  logistics: 300,
};

export function loadApiCacheConfigFromEnv(): ApiCacheConfig {
  const enabledRaw = process.env.SHOPEE_CACHE_ENABLED?.trim();
  const enabled =
    enabledRaw === undefined ||
    enabledRaw === "" ||
    enabledRaw === "1" ||
    enabledRaw.toLowerCase() === "true";

  return {
    enabled,
    defaultTtlSec: Math.max(
      30,
      Number(process.env.SHOPEE_CACHE_DEFAULT_TTL ?? 300) || 300
    ),
    maxPayloadBytes: Math.max(
      4096,
      Number(process.env.SHOPEE_CACHE_MAX_BYTES ?? 2_097_152) || 2_097_152
    ),
    includeMeta:
      process.env.SHOPEE_CACHE_META !== "0" &&
      process.env.SHOPEE_CACHE_META?.toLowerCase() !== "false",
  };
}

export const apiCacheIndexKey = (mainId: number, shopId: number) =>
  `shopee:api:index:${mainId}:${shopId}`;

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableSerialize(obj[k])}`).join(",")}}`;
}

export function buildApiCacheKey(
  mainId: number,
  shopId: number,
  toolName: string,
  params: Record<string, unknown>
): string {
  const digest = createHash("sha256")
    .update(stableSerialize({ tool: toolName, params }))
    .digest("hex")
    .slice(0, 16);
  return `shopee:api:${mainId}:${shopId}:${toolName}:${digest}`;
}

const WRITE_METHOD_PREFIXES = [
  "create",
  "edit",
  "update",
  "delete",
  "add",
  "remove",
  "set",
  "cancel",
  "publish",
  "unpublish",
  "upload",
  "bind",
  "unbind",
  "confirm",
  "ship",
  "split",
  "merge",
  "boost",
  "pause",
  "resume",
  "stop",
  "start",
];

export function isReadOnlySdkTool(def: SdkToolDefinition): boolean {
  if (NEVER_CACHE_TOOLS.has(def.toolName)) return false;
  if (!def.manager) return false;

  const m = def.method;
  const lower = m.toLowerCase();
  if (WRITE_METHOD_PREFIXES.some((p) => lower.startsWith(p))) return false;
  return (
    lower.startsWith("get") ||
    lower.startsWith("list") ||
    lower.startsWith("check") ||
    lower.startsWith("search")
  );
}

export function resolveCacheTtlSec(def: SdkToolDefinition): number {
  if (def.manager && MANAGER_TTL_SEC[def.manager]) {
    return MANAGER_TTL_SEC[def.manager];
  }
  return loadApiCacheConfigFromEnv().defaultTtlSec;
}

export type CachedApiPayload = {
  data: unknown;
  cached_at: string;
  tool_name: string;
  ttl_sec: number;
};

export async function getCachedApiResponse(
  redis: Redis,
  key: string
): Promise<CachedApiPayload | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedApiPayload;
  } catch {
    await redis.del(key);
    return null;
  }
}

export async function setCachedApiResponse(
  redis: Redis,
  key: string,
  indexKey: string,
  payload: CachedApiPayload,
  ttlSec: number,
  maxBytes: number
): Promise<boolean> {
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    return false;
  }
  const pipeline = redis.pipeline();
  pipeline.setex(key, ttlSec, serialized);
  pipeline.sadd(indexKey, key);
  pipeline.expire(indexKey, Math.max(ttlSec * 2, 86400));
  await pipeline.exec();
  return true;
}

async function deleteIndexedKeys(
  redis: Redis,
  indexKey: string,
  keys: string[]
): Promise<number> {
  if (keys.length === 0) return 0;
  const pipeline = redis.pipeline();
  for (const key of keys) {
    pipeline.del(key);
    pipeline.srem(indexKey, key);
  }
  const remaining = await redis.scard(indexKey);
  if (remaining === 0) {
    pipeline.del(indexKey);
  }
  await pipeline.exec();
  return keys.length;
}

/** 写操作后失效该店铺全部 API 缓存 */
export async function invalidateShopApiCache(
  redis: Redis,
  mainId: number,
  shopId: number
): Promise<number> {
  const indexKey = apiCacheIndexKey(mainId, shopId);
  const keys = await redis.smembers(indexKey);
  return deleteIndexedKeys(redis, indexKey, keys);
}

/** 按工具名前缀失效（如 shopee_product_） */
export async function invalidateShopApiCacheByPrefix(
  redis: Redis,
  mainId: number,
  shopId: number,
  toolNamePrefix: string
): Promise<number> {
  const indexKey = apiCacheIndexKey(mainId, shopId);
  const allKeys = await redis.smembers(indexKey);
  const needle = `:${toolNamePrefix}`;
  const keys = allKeys.filter((k) => k.includes(needle));
  return deleteIndexedKeys(redis, indexKey, keys);
}

export function attachCacheMeta(
  data: unknown,
  meta: { hit: boolean; key: string; ttl_sec?: number; cached_at?: string }
): unknown {
  const cfg = loadApiCacheConfigFromEnv();
  if (!cfg.includeMeta) return data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { result: data, _cache: meta };
  }
  return { ...(data as Record<string, unknown>), _cache: meta };
}
