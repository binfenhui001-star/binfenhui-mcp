import type { TiktokTokenRecord } from "./redis-token-storage.js";

type CacheEntry = {
  record: TiktokTokenRecord;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function cacheKey(shopId: string | number, appKey?: string): string {
  return `${appKey?.trim() || "_"}:${shopId}`;
}

export function getCachedToken(
  shopId: string | number,
  appKey?: string
): TiktokTokenRecord | null {
  const hit = cache.get(cacheKey(shopId, appKey));
  if (!hit || hit.expiresAt <= Date.now()) {
    if (hit) cache.delete(cacheKey(shopId, appKey));
    return null;
  }
  return hit.record;
}

export function setCachedToken(
  shopId: string | number,
  record: TiktokTokenRecord,
  appKey?: string,
  ttlMs = DEFAULT_TTL_MS
): void {
  cache.set(cacheKey(shopId, appKey ?? record.app_key), {
    record,
    expiresAt: Date.now() + ttlMs,
  });
}

export function clearTokenCache(shopId?: string | number, appKey?: string): void {
  if (shopId === undefined) {
    cache.clear();
    return;
  }
  cache.delete(cacheKey(shopId, appKey));
}
