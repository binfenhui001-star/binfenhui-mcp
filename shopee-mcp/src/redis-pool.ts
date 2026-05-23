import type { Redis } from "ioredis";

import { loadRedisConfigFromEnv } from "./config.js";
import { createRedis } from "./redis.js";

let shared: Redis | null = null;

/** 进程级复用 Redis 连接，避免每次 MCP 工具调用 connect/quit */
export function getSharedRedis(): Redis {
  if (!shared) {
    shared = createRedis(loadRedisConfigFromEnv());
    shared.on("error", (err) => {
      console.error("[shopee-mcp] Redis error:", err.message);
    });
  }
  return shared;
}

export async function closeSharedRedis(): Promise<void> {
  if (shared) {
    const client = shared;
    shared = null;
    await client.quit();
  }
}
