import { Redis } from "ioredis";
import type { RedisConfig } from "./config.js";

export function createRedis(config: RedisConfig): Redis {
  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password || undefined,
    db: config.db,
    retryStrategy: (times: number) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });
}

export const tokenKey = (mainId: number, shopId: number) =>
  `shopee:token:${mainId}:${shopId}`;

export const itemsKey = (shopId: number) => `shopee:items:${shopId}`;
