#!/usr/bin/env node
/**
 * Smoke test: get_item_list with patched sign + China base URL.
 * Usage: node --env-file=.env scripts/smoke-api.mjs <main_id> <shop_id>
 */
import { ShopeeSDK } from "@congminh1254/shopee-sdk";
import { ItemStatus } from "@congminh1254/shopee-sdk/schemas";
import { Redis } from "ioredis";

// dynamic import compiled patch after build
const { patchShopeeSdkFetch } = await import("../dist/patch-shopee-sdk.js");
const { loadCredentialsFromEnv, loadRedisConfigFromEnv } = await import(
  "../dist/config.js"
);
const { createRedis, tokenKey } = await import("../dist/redis.js");
const { RedisTokenStorage } = await import("../dist/redis-token-storage.js");

patchShopeeSdkFetch();

const mainId = Number(process.argv[2] || 0);
const shopId = Number(process.argv[3] || 0);
if (!mainId || !shopId) {
  console.error("Usage: node --env-file=.env scripts/smoke-api.mjs <main_id> <shop_id>");
  process.exit(2);
}

const credentials = loadCredentialsFromEnv();
console.log("base_url:", credentials.base_url);

const redis = createRedis(loadRedisConfigFromEnv());
const tokenStorage = new RedisTokenStorage(redis, mainId, shopId);
const token = await tokenStorage.get();
if (!token?.access_token) {
  console.error("No token in", tokenKey(mainId, shopId));
  process.exit(1);
}

const sdk = new ShopeeSDK(
  {
    partner_id: credentials.partner_id,
    partner_key: credentials.partner_key,
    base_url: credentials.base_url,
    shop_id: shopId,
  },
  tokenStorage
);

function formatDdMmYyyy(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
}

try {
  const res = await sdk.product.getItemList({
    offset: 0,
    page_size: 5,
    item_status: [ItemStatus.NORMAL],
  });
  const count = res.response?.item?.length ?? 0;
  console.log("OK get_item_list items:", count, "error:", res.error || "-");
  if (res.error) process.exit(1);

  const today = new Date();
  const ads = await sdk.ads.getGmsItemPerformance({
    start_date: "01-05-2026",
    end_date: formatDdMmYyyy(today),
    limit: 5,
    offset: 0,
  });
  const rows = ads.response?.result_list?.length ?? 0;
  console.log("OK get_gms_item_performance rows:", rows, "error:", ads.error || "-");
  if (ads.error) process.exit(1);
} catch (e) {
  console.error("FAIL:", e.message);
  process.exit(1);
} finally {
  await redis.quit();
}
