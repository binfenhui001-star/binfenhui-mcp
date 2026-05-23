#!/usr/bin/env node
/**
 * 拉取店铺商品列表并保存 JSON（开发调试用）
 * 生产/Agent 请用 MCP 工具 tiktok_sync_products_to_redis → Redis tiktok:products:{app_key}:{shop_id}
 *
 * node --env-file=../.env scripts/fetch-shop-products.mjs --shop-id 7495960439579446253
 * node --env-file=../.env scripts/fetch-shop-products.mjs --shop-id ... --access-token ROW_xxx --app-label binfenhui
 */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    shopId: "",
    accessToken: "",
    appLabel: "",
    appKey: "",
    pageSize: 50,
    noRefresh: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--shop-id") out.shopId = args[++i] ?? "";
    else if (args[i] === "--access-token") out.accessToken = args[++i] ?? "";
    else if (args[i] === "--app-label") out.appLabel = args[++i] ?? "";
    else if (args[i] === "--app-key") out.appKey = args[++i] ?? "";
    else if (args[i] === "--page-size") out.pageSize = Number(args[++i] ?? 50);
    else if (args[i] === "--no-refresh") out.noRefresh = true;
  }
  if (!out.shopId) throw new Error("需要 --shop-id");
  return out;
}

async function main() {
  const { shopId, pageSize, noRefresh } = parseArgs();
  let { accessToken, appLabel, appKey } = parseArgs();

  const { loadTiktokCredentialsRegistry } = await import("../dist/config.js");
  const { createTiktokApiClient } = await import("../dist/tiktok-sdk-client.js");
  const { getTiktokAccessToken } = await import("../dist/redis-token-storage.js");
  const { fetchAuthorizedShops } = await import("../dist/tiktok-auth.js");

  const registry = loadTiktokCredentialsRegistry();
  if (!registry) throw new Error("未配置 TIKTOK_APP_KEY/SECRET");

  let shopCipher = "";

  if (!accessToken) {
    const redis = new Redis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASS || undefined,
      db: Number(process.env.REDIS_DB || 0),
    });
    try {
      const preliminary = registry.resolve({
        app_key: appKey || undefined,
        app_label: appLabel || undefined,
      });
      const rec = await getTiktokAccessToken(redis, shopId, appKey || undefined, {
        autoRefresh: noRefresh ? "never" : "smart",
        credentials: preliminary,
      });
      accessToken = rec?.access_token ?? "";
      appKey = appKey || rec?.app_key || preliminary.app_key;
      appLabel = appLabel || rec?.app_label || preliminary.label || "";
      shopCipher = rec?.shop_cipher ?? "";
    } finally {
      await redis.quit();
    }
  }

  if (!accessToken) {
    throw new Error("无可用 access_token，请传 --access-token 或修复 Redis token");
  }

  const app = registry.resolve({
    app_key: appKey || undefined,
    app_label: appLabel || undefined,
  });

  if (!shopCipher) {
    const shops = await fetchAuthorizedShops(app, accessToken);
    const match = shops.find((s) => String(s.id) === String(shopId));
    shopCipher = match?.cipher ?? "";
    if (!shopCipher) {
      throw new Error(`未找到 shop_id=${shopId} 的 shop_cipher，已授权店铺: ${shops.map((s) => s.id).join(", ")}`);
    }
  }

  const client = await createTiktokApiClient(app);
  const api = client.api.ProductV202502Api;
  if (!api?.ProductsSearchPost) {
    throw new Error("SDK 缺少 ProductV202502Api.ProductsSearchPost");
  }

  const all = [];
  let pageToken;
  let page = 0;
  do {
    page += 1;
    const result = await api.ProductsSearchPost(
      pageSize,
      accessToken,
      "application/json",
      pageToken,
      shopCipher,
      {},
      { headers: {} }
    );
    const body = result.body;
    if (body?.code !== 0 && body?.code !== undefined) {
      throw new Error(`API 错误: code=${body.code} message=${body.message}`);
    }
    const products = body?.data?.products ?? [];
    all.push(...products);
    pageToken = body?.data?.next_page_token;
    console.error(`page ${page}: +${products.length} total=${all.length}`);
    if (!pageToken) break;
  } while (page < 20);

  const outPath = resolve(__dirname, `../products-${shopId}.json`);
  const payload = {
    shop_id: shopId,
    app_key: app.app_key,
    app_label: app.label,
    shop_cipher: shopCipher,
    fetched_at: new Date().toISOString(),
    total: all.length,
    products: all,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`已保存 ${all.length} 个商品 → ${outPath}`);
  if (all[0]) {
    console.log("示例:", all[0].id, all[0].title ?? all[0].name);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
