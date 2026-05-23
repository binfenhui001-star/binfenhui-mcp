import { createHash } from "node:crypto";

import type { Redis } from "ioredis";

import type { SdkToolDefinition } from "./sdk-tool-catalog.js";

export interface ApiCacheConfig {
  enabled: boolean;
  defaultTtlSec: number;
  maxPayloadBytes: number;
  includeMeta: boolean;
}

const NEVER_CACHE_TOOL_PREFIXES = ["tiktok_auth_", "tiktok_tool_schema", "tiktok_tools_list"];

const API_CLIENT_TTL_SEC: Record<string, number> = {
  Product: 600,
  Order: 120,
  Fulfillment: 300,
  Finance: 300,
  Promotion: 600,
  Analytics: 1800,
  Affiliate: 1800,
  Seller: 600,
};

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
  "activate",
  "deactivate",
  "submit",
  "approve",
  "reject",
  "close",
  "open",
  "start",
  "stop",
  "pause",
  "resume",
];

export function loadApiCacheConfigFromEnv(): ApiCacheConfig {
  const enabledRaw = process.env.TIKTOK_CACHE_ENABLED?.trim();
  const enabled =
    enabledRaw === undefined ||
    enabledRaw === "" ||
    enabledRaw === "1" ||
    enabledRaw.toLowerCase() === "true";

  return {
    enabled,
    defaultTtlSec: Math.max(
      30,
      Number(process.env.TIKTOK_CACHE_DEFAULT_TTL ?? process.env.MCP_REDIS_DEFAULT_TTL ?? 300) ||
        300
    ),
    maxPayloadBytes: Math.max(
      4096,
      Number(process.env.TIKTOK_CACHE_MAX_BYTES ?? 2_097_152) || 2_097_152
    ),
    includeMeta:
      process.env.TIKTOK_CACHE_META !== "0" &&
      process.env.TIKTOK_CACHE_META?.toLowerCase() !== "false",
  };
}

export const apiCacheIndexKey = (appKey: string, shopId: string | number) =>
  `tiktok:api:index:${appKey}:${shopId}`;

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
  appKey: string,
  shopId: string | number,
  toolName: string,
  params: Record<string, unknown>
): string {
  const digest = createHash("sha256")
    .update(stableSerialize({ tool: toolName, params }))
    .digest("hex")
    .slice(0, 16);
  return `tiktok:api:${appKey}:${shopId}:${toolName}:${digest}`;
}

export function isReadOnlySdkTool(def: SdkToolDefinition): boolean {
  if (NEVER_CACHE_TOOL_PREFIXES.some((p) => def.toolName.startsWith(p))) {
    return false;
  }
  const lower = def.method.toLowerCase();
  if (WRITE_METHOD_PREFIXES.some((p) => lower.startsWith(p))) return false;
  return (
    lower.includes("get") ||
    lower.includes("search") ||
    lower.includes("list") ||
    lower.includes("query") ||
    lower.includes("check")
  );
}

export function resolveCacheTtlSec(def: SdkToolDefinition): number {
  for (const [prefix, ttl] of Object.entries(API_CLIENT_TTL_SEC)) {
    if (def.apiClient.includes(prefix)) return ttl;
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

export async function invalidateShopApiCache(
  redis: Redis,
  appKey: string,
  shopId: string | number
): Promise<number> {
  const indexKey = apiCacheIndexKey(appKey, shopId);
  const keys = await redis.smembers(indexKey);
  return deleteIndexedKeys(redis, indexKey, keys);
}

export async function invalidateShopApiCacheByPrefix(
  redis: Redis,
  appKey: string,
  shopId: string | number,
  toolNamePrefix: string
): Promise<number> {
  const indexKey = apiCacheIndexKey(appKey, shopId);
  const allKeys = await redis.smembers(indexKey);
  const needle = `:${toolNamePrefix}`;
  const keys = allKeys.filter((k) => k.includes(needle));
  return deleteIndexedKeys(redis, indexKey, keys);
}

export function isSuccessfulTiktokResponse(data: unknown): boolean {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return true;
  }
  const code = (data as Record<string, unknown>).code;
  return code === 0 || code === undefined;
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
