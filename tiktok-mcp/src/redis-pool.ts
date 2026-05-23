import type { Redis } from "ioredis";

import { loadRedisConfigFromEnv } from "./config.js";
import { formatRedisTarget } from "./redis-errors.js";
import { createRedis } from "./redis.js";

let shared: Redis | null = null;
let loggedTarget = false;

export function getRedisConfig() {
  return loadRedisConfigFromEnv();
}

export function getSharedRedis(): Redis {
  if (!shared) {
    const config = getRedisConfig();
    if (!loggedTarget) {
      loggedTarget = true;
      const fromEnv = process.env.REDIS_HOST?.trim();
      console.error(
        `[tiktok-mcp] Redis → ${formatRedisTarget(config)}${fromEnv ? "" : " (警告: 未设置 REDIS_HOST，已用默认 127.0.0.1)"}`
      );
    }
    shared = createRedis(config);
    shared.on("error", (err: Error) => {
      console.error("[tiktok-mcp] Redis error:", err.message);
    });
  }
  return shared;
}
