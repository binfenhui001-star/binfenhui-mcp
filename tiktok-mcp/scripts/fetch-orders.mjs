#!/usr/bin/env node
/**
 * 直连 SDK 拉取订单列表（含 createTimeGe / createTimeLt 请求体）
 *
 * node --env-file=../.env scripts/fetch-orders.mjs --shop-id 7495960439579446253 \
 *   --create-time-ge 1714521600 --create-time-lt 1715385600
 *
 * node --env-file=../.env scripts/fetch-orders.mjs --shop-id ... --body-json '{"orderStatus":"AWAITING_SHIPMENT"}'
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
    createTimeGe: undefined,
    createTimeLt: undefined,
    bodyJson: "",
    outFile: "",
    noRefresh: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--shop-id") out.shopId = args[++i] ?? "";
    else if (args[i] === "--access-token") out.accessToken = args[++i] ?? "";
    else if (args[i] === "--app-label") out.appLabel = args[++i] ?? "";
    else if (args[i] === "--app-key") out.appKey = args[++i] ?? "";
    else if (args[i] === "--page-size") out.pageSize = Number(args[++i] ?? 50);
    else if (args[i] === "--create-time-ge")
      out.createTimeGe = Number(args[++i]);
    else if (args[i] === "--create-time-lt")
      out.createTimeLt = Number(args[++i]);
    else if (args[i] === "--body-json") out.bodyJson = args[++i] ?? "";
    else if (args[i] === "--out") out.outFile = args[++i] ?? "";
    else if (args[i] === "--no-refresh") out.noRefresh = true;
  }
  if (!out.shopId) throw new Error("需要 --shop-id");
  return out;
}

async function main() {
  const opts = parseArgs();
  let { accessToken, appLabel, appKey } = opts;
  let shopCipher = "";

  const { loadTiktokCredentialsRegistry } = await import("../dist/config.js");
  const { createTiktokApiClient } = await import("../dist/tiktok-sdk-client.js");
  const { getTiktokAccessToken } = await import("../dist/redis-token-storage.js");
  const { fetchAuthorizedShops } = await import("../dist/tiktok-auth.js");

  const registry = loadTiktokCredentialsRegistry();
  if (!registry) throw new Error("未配置 TIKTOK_APP_KEY/SECRET");

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
      const rec = await getTiktokAccessToken(redis, opts.shopId, appKey || undefined, {
        autoRefresh: opts.noRefresh ? "never" : "smart",
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
    throw new Error("无 access_token：传 --access-token 或配置 Redis token");
  }

  const app = registry.resolve({
    app_key: appKey || undefined,
    app_label: appLabel || undefined,
  });

  if (!shopCipher) {
    const shops = await fetchAuthorizedShops(app, accessToken);
    const match = shops.find((s) => String(s.id) === String(opts.shopId));
    shopCipher = match?.cipher ?? "";
    if (!shopCipher) {
      throw new Error(`未找到 shop_id=${opts.shopId} 的 shop_cipher`);
    }
  }

  const requestBody = opts.bodyJson
    ? JSON.parse(opts.bodyJson)
    : {
        ...(Number.isFinite(opts.createTimeGe)
          ? { createTimeGe: opts.createTimeGe }
          : {}),
        ...(Number.isFinite(opts.createTimeLt)
          ? { createTimeLt: opts.createTimeLt }
          : {}),
      };

  const client = await createTiktokApiClient(app);
  const api = client.api.OrderV202309Api;
  if (!api?.OrdersSearchPost) {
    throw new Error("SDK 缺少 OrderV202309Api.OrdersSearchPost");
  }

  const all = [];
  let pageToken;
  let page = 0;

  do {
    page += 1;
    const result = await api.OrdersSearchPost(
      opts.pageSize,
      accessToken,
      "application/json",
      undefined,
      pageToken,
      undefined,
      shopCipher,
      requestBody,
      { headers: {} }
    );
    const body = result.body;
    if (body?.code !== 0 && body?.code !== undefined) {
      throw new Error(`API 错误: code=${body.code} message=${body.message}`);
    }
    const orders = body?.data?.orders ?? [];
    all.push(...orders);
    pageToken = body?.data?.next_page_token;
    console.error(
      `page ${page}: +${orders.length} total=${all.length} body=${JSON.stringify(requestBody)}`
    );
    if (!pageToken) break;
  } while (page < 50);

  const outPath =
    opts.outFile ||
    resolve(__dirname, `../orders-${opts.shopId}-${Date.now()}.json`);
  const payload = {
    shop_id: opts.shopId,
    app_key: app.app_key,
    request_body: requestBody,
    fetched_at: new Date().toISOString(),
    total: all.length,
    orders: all,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`已保存 ${all.length} 条订单 → ${outPath}`);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
