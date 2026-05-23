import { Redis } from "ioredis";

import type { loadRedisConfigFromEnv } from "./config.js";

type RedisConfig = ReturnType<typeof loadRedisConfigFromEnv>;

export function createRedis(config: RedisConfig): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password || undefined,
    db: config.db,
    connectTimeout: 10_000,
    commandTimeout: 20_000,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    retryStrategy: (times: number) => {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
  });
}
