import { ShopeeSDK } from "@congminh1254/shopee-sdk";

import type { ShopeeCredentials } from "./config.js";
import { getSharedRedis } from "./redis-pool.js";
import { RedisTokenStorage } from "./redis-token-storage.js";

export type ShopeeSdkSession = {
  sdk: ShopeeSDK;
};

export async function createShopeeSdkSession(
  credentials: ShopeeCredentials,
  mainId: number,
  shopId: number
): Promise<ShopeeSdkSession> {
  const redis = getSharedRedis();
  const tokenStorage = new RedisTokenStorage(redis, mainId, shopId);
  const sdk = new ShopeeSDK(
    {
      partner_id: credentials.partner_id,
      partner_key: credentials.partner_key,
      base_url: credentials.base_url,
      shop_id: shopId,
    },
    tokenStorage
  );
  return { sdk };
}

export async function closeShopeeSdkSession(_session: ShopeeSdkSession): Promise<void> {
  /* Redis 连接由 redis-pool 进程级复用 */
}
