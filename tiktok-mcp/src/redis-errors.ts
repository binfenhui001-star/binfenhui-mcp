import type { Redis } from "ioredis";

import type { loadRedisConfigFromEnv } from "./config.js";

export function formatRedisTarget(
  config: ReturnType<typeof loadRedisConfigFromEnv>
): string {
  return `${config.host}:${config.port}/${config.db}`;
}

export function isRedisMaxRetriesError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("max retries per request") || msg.includes("MaxRetriesPerRequest");
}

export function wrapRedisError(
  err: unknown,
  config: ReturnType<typeof loadRedisConfigFromEnv>,
  context: string
): Error {
  const target = formatRedisTarget(config);
  const base = err instanceof Error ? err.message : String(err);
  if (isRedisMaxRetriesError(err)) {
    return new Error(
      `${context}：无法连接 Redis（${target}）。请确认 mcp/.env 中 REDIS_HOST/PORT 已加载到 tiktok-mcp 进程，且网络可达。原始错误: ${base}`
    );
  }
  return new Error(`${context}（Redis ${target}）: ${base}`);
}

export async function redisGet(
  redis: Redis,
  key: string,
  config: ReturnType<typeof loadRedisConfigFromEnv>
): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (err) {
    throw wrapRedisError(err, config, `Redis GET ${key} 失败`);
  }
}

export async function redisSet(
  redis: Redis,
  key: string,
  value: string,
  config: ReturnType<typeof loadRedisConfigFromEnv>
): Promise<void> {
  try {
    await redis.set(key, value);
  } catch (err) {
    throw wrapRedisError(err, config, `Redis SET ${key} 失败`);
  }
}
