import type { Redis } from "ioredis";

import type { TiktokCredentials } from "./config.js";
import { getRedisConfig } from "./redis-pool.js";
import { redisGet, redisSet } from "./redis-errors.js";
import {
  clearTokenCache,
  getCachedToken,
  setCachedToken,
} from "./token-memory-cache.js";
import { isRowCipher } from "./tiktok-row-cipher.js";
import {
  refreshAccessToken,
  tokenDataToRecord,
  type TokenResponseBody,
} from "./tiktok-auth.js";

export type TiktokTokenRecord = {
  access_token: string;
  refresh_token?: string;
  shop_cipher?: string;
  open_id?: string;
  shop_code?: string;
  shop_name?: string;
  region?: string;
  access_token_expire_in?: number;
  refresh_token_expire_in?: number;
  updated_at?: string;
  /** 授权时使用的 Open API app_key */
  app_key?: string;
  app_label?: string;
};

/** 旧键（单应用时代） */
export function tiktokTokenKeyLegacy(shopId: string | number): string {
  return `tiktok:token:${shopId}`;
}

/** 推荐：按 app_key + shop_id 隔离 */
export function tiktokTokenKey(
  shopId: string | number,
  appKey?: string
): string {
  const key = String(appKey ?? "").trim();
  if (key) return `tiktok:token:${key}:${shopId}`;
  return tiktokTokenKeyLegacy(shopId);
}

/** refresh 独立键（与内部同步系统一致，值为 ROW_ 密文，原样使用） */
export function tiktokRefreshKeyLegacy(shopId: string | number): string {
  return `tiktok:refresh:${shopId}`;
}

export function tiktokRefreshKey(
  shopId: string | number,
  appKey?: string
): string {
  const key = String(appKey ?? "").trim();
  if (key) return `tiktok:refresh:${key}:${shopId}`;
  return tiktokRefreshKeyLegacy(shopId);
}

function tokenKeyToRefreshKey(tokenKey: string): string {
  if (tokenKey.startsWith("tiktok:token:")) {
    return tokenKey.replace(/^tiktok:token:/, "tiktok:refresh:");
  }
  return tokenKey;
}

function isTokenSuccess(body: TokenResponseBody): boolean {
  return body.code === 0 || body.code === undefined;
}

function isAccessExpired(record: TiktokTokenRecord): boolean {
  const exp = record.access_token_expire_in;
  if (!exp) return false;
  return exp <= Math.floor(Date.now() / 1000) + 120;
}

/** 仅 legacy ROW 明文键或 JSON 中 access 已过期时才刷新 */
export function shouldRefreshToken(
  record: TiktokTokenRecord,
  storedAsJson: boolean
): boolean {
  if (!record.refresh_token?.trim()) return false;
  if (!storedAsJson && isRowCipher(record.access_token)) return true;
  if (storedAsJson && isAccessExpired(record)) return true;
  return false;
}

const refreshInFlight = new Map<string, Promise<TiktokTokenRecord>>();

/** 从 Redis 读取 refresh_token（不解密，含 ROW_ 前缀原样返回） */
export async function getTiktokRefreshToken(
  redis: Redis,
  shopId: string | number,
  appKey?: string
): Promise<string | null> {
  const redisConfig = getRedisConfig();
  const keys: string[] = [];
  const trimmed = appKey?.trim();
  if (trimmed) keys.push(tiktokRefreshKey(shopId, trimmed));
  keys.push(tiktokRefreshKeyLegacy(shopId));

  for (const k of keys) {
    const raw = await redisGet(redis, k, redisConfig);
    if (raw?.trim()) return raw.trim();
  }
  return null;
}

/** ROW_ access 过期时用 refresh 刷新并写回 Redis */
export async function refreshTiktokTokenInRedis(
  redis: Redis,
  shopId: string | number,
  credentials: TiktokCredentials & { label?: string },
  existing?: TiktokTokenRecord | null
): Promise<TiktokTokenRecord> {
  const flightKey = `${credentials.app_key}:${shopId}`;
  const inFlight = refreshInFlight.get(flightKey);
  if (inFlight) return inFlight;

  const task = (async () => {
    const refresh =
      existing?.refresh_token?.trim() ||
      (await getTiktokRefreshToken(redis, shopId, credentials.app_key));
    if (!refresh) {
      throw new Error(
        `缺少 refresh_token：请写入 ${tiktokRefreshKeyLegacy(shopId)} 或传 tiktok_auth_refresh_token`
      );
    }

    const tokenBody = await refreshAccessToken(credentials, refresh);
    if (!isTokenSuccess(tokenBody) || !tokenBody.data?.access_token?.trim()) {
      throw new Error(
        `刷新 token 失败: ${tokenBody.message ?? JSON.stringify(tokenBody)}`
      );
    }

    const record = tokenDataToRecord(
      tokenBody,
      {
        cipher: existing?.shop_cipher,
        id: String(shopId),
        name: existing?.shop_name,
        region: existing?.region,
        code: existing?.shop_code,
      },
      credentials
    );

    await saveTiktokToken(redis, shopId, record, credentials.app_key);
    return record;
  })();

  refreshInFlight.set(flightKey, task);
  try {
    return await task;
  } finally {
    refreshInFlight.delete(flightKey);
  }
}

export type GetTiktokAccessTokenOptions = {
  /**
   * - `smart`（默认）：仅 legacy ROW 或 access 将过期时刷新
   * - `always`：每次调用都 refresh（调试用）
   * - `never`：不自动刷新
   */
  autoRefresh?: "smart" | "always" | "never";
  credentials?: TiktokCredentials & { label?: string };
};

export async function getTiktokAccessToken(
  redis: Redis,
  shopId: string | number,
  appKey?: string,
  options?: GetTiktokAccessTokenOptions
): Promise<TiktokTokenRecord | null> {
  const trimmed = appKey?.trim();
  const cached = getCachedToken(shopId, trimmed);
  if (cached) return cached;

  const redisConfig = getRedisConfig();
  const keys: string[] = [];
  if (trimmed) {
    keys.push(tiktokTokenKey(shopId, trimmed));
  }
  keys.push(tiktokTokenKeyLegacy(shopId));

  for (const k of keys) {
    const raw = await redisGet(redis, k, redisConfig);
    if (!raw?.trim()) continue;

    let record: TiktokTokenRecord | null = null;
    let storedAsJson = false;

    try {
      const parsed = JSON.parse(raw) as TiktokTokenRecord;
      if (!parsed.access_token?.trim()) continue;
      record = parsed;
      storedAsJson = true;
    } catch {
      if (isRowCipher(raw)) {
        const refreshRaw = await redisGet(
          redis,
          tokenKeyToRefreshKey(k),
          redisConfig
        );
        record = {
          access_token: raw.trim(),
          refresh_token: refreshRaw?.trim() || undefined,
          app_key: trimmed || appKey,
        };
      } else {
        continue;
      }
    }

    if (!record.refresh_token) {
      const fromRefreshKey = await getTiktokRefreshToken(
        redis,
        shopId,
        record.app_key ?? trimmed
      );
      if (fromRefreshKey) record.refresh_token = fromRefreshKey;
    }

    const creds = options?.credentials;
    const mode = options?.autoRefresh ?? "smart";
    const needsRefresh =
      mode === "always" ||
      (mode === "smart" && shouldRefreshToken(record, storedAsJson));

    if (needsRefresh && creds && record.refresh_token) {
      record = await refreshTiktokTokenInRedis(redis, shopId, creds, record);
    }

    setCachedToken(shopId, record, trimmed ?? record.app_key);
    return record;
  }
  return null;
}

export async function saveTiktokToken(
  redis: Redis,
  shopId: string | number,
  record: TiktokTokenRecord,
  appKey?: string
): Promise<string> {
  if (!record.access_token?.trim()) {
    throw new Error("access_token 不能为空");
  }
  const redisConfig = getRedisConfig();
  const resolvedAppKey = (appKey ?? record.app_key)?.trim();
  const payload: TiktokTokenRecord = {
    ...record,
    access_token: record.access_token.trim(),
    app_key: resolvedAppKey || record.app_key,
    updated_at: record.updated_at ?? new Date().toISOString(),
  };

  const primaryKey = tiktokTokenKey(shopId, resolvedAppKey);
  await redisSet(redis, primaryKey, JSON.stringify(payload), redisConfig);

  if (!resolvedAppKey) {
    await redisSet(
      redis,
      tiktokTokenKeyLegacy(shopId),
      JSON.stringify(payload),
      redisConfig
    );
  }

  if (payload.refresh_token?.trim()) {
    await redisSet(
      redis,
      tiktokRefreshKey(shopId, resolvedAppKey),
      payload.refresh_token.trim(),
      redisConfig
    );
    if (!resolvedAppKey) {
      await redisSet(
        redis,
        tiktokRefreshKeyLegacy(shopId),
        payload.refresh_token.trim(),
        redisConfig
      );
    }
  }

  setCachedToken(shopId, payload, resolvedAppKey);

  return primaryKey;
}
