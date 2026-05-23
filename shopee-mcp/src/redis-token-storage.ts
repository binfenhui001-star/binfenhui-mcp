import type { AccessToken } from "@congminh1254/shopee-sdk/schemas";
import type { Redis } from "ioredis";
import { tokenKey } from "./redis.js";

/** 从 Redis 读取 `shopee:token:{main_id}:{shop_id}`，与 n8n / 旧 MCP 一致 */
export class RedisTokenStorage {
  constructor(
    private readonly redis: Redis,
    private readonly mainId: number,
    private readonly shopId: number
  ) {}

  private getKey(): string {
    return tokenKey(this.mainId, this.shopId);
  }

  async store(token: AccessToken): Promise<void> {
    const key = this.getKey();
    const value = JSON.stringify(token);
    if (token.expired_at) {
      const ttl = Math.floor((token.expired_at - Date.now()) / 1000);
      if (ttl > 0) {
        await this.redis.setex(key, ttl, value);
        return;
      }
    }
    await this.redis.setex(key, 14400, value);
  }

  async get(): Promise<AccessToken | null> {
    const value = await this.redis.get(this.getKey());
    if (!value) {
      return null;
    }
    return JSON.parse(value) as AccessToken;
  }

  async clear(): Promise<void> {
    await this.redis.del(this.getKey());
  }
}
