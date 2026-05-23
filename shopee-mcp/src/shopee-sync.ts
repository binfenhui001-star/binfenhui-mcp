import { ShopeeSDK } from "@congminh1254/shopee-sdk";
import { ItemStatus } from "@congminh1254/shopee-sdk/schemas";
import type { Redis } from "ioredis";
import type { ShopeeCredentials } from "./config.js";
import { invalidateShopApiCacheByPrefix } from "./api-cache.js";
import { patchShopeeSdkFetch } from "./patch-shopee-sdk.js";

patchShopeeSdkFetch();
import { getSharedRedis } from "./redis-pool.js";
import { itemsKey } from "./redis.js";
import { RedisTokenStorage } from "./redis-token-storage.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function toShopeeDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function mapExtraFields(extra: Record<string, unknown> | undefined) {
  const saleInfo = extra?.sale_info as { sale?: number } | undefined;
  return {
    sale: Number(extra?.sale ?? saleInfo?.sale ?? 0),
    views: Number(extra?.views ?? extra?.view ?? 0),
    likes: Number(extra?.likes ?? extra?.liked_count ?? 0),
    rating_star: Number(extra?.rating_star ?? 0),
    comment_count: Number(extra?.comment_count ?? extra?.cmt_count ?? 0),
  };
}

function mapAdsFields(report: Record<string, unknown> | undefined) {
  const r = report ?? {};
  return {
    broad_cir: Number(r.broad_cir ?? 0),
    broad_gmv: Number(r.broad_gmv ?? r.gmv ?? 0),
    broad_order: Number(r.broad_order ?? r.orders ?? 0),
    broad_order_amount: Number(r.broad_order_amount ?? 0),
    broad_roi: Number(r.broad_roi ?? r.roas ?? 0),
    clicks: Number(r.clicks ?? 0),
    expense: Number(r.expense ?? 0),
    cr: Number(r.cr ?? 0),
    direct_cr: Number(r.direct_cr ?? 0),
    direct_cir: Number(r.direct_cir ?? 0),
    direct_order: Number(r.direct_order ?? 0),
    direct_order_amount: Number(r.direct_order_amount ?? 0),
    direct_roi: Number(r.direct_roi ?? 0),
    impression: Number(r.impression ?? 0),
  };
}

export interface SyncShopParams {
  credentials: ShopeeCredentials;
  main_id: number;
  shop_id: number;
  page_size?: number;
  ttl?: number;
  time_range?: number;
  enable_ads_query?: boolean;
}

export interface SyncShopSummary {
  redis_key?: string;
  ttl?: number;
  count: number;
  message?: string;
  warning?: string;
  shop_id?: number;
  base_info_errors?: string[];
  api_cache_invalidated?: number;
  extra_info_errors?: string[];
}

export interface SyncShopSuccess {
  ok: true;
  summary: SyncShopSummary;
  items: unknown[];
}

/** 使用 shopee-sdk 拉取全店商品并写入 Redis（与原 n8n / product-ads-mcp 输出格式兼容） */
export async function syncShopItemsToRedis(
  params: SyncShopParams
): Promise<SyncShopSuccess> {
  const mainId = Number(params.main_id);
  const shopId = Number(params.shop_id);
  const pageSize = Number(params.page_size ?? 100);
  const ttl = Number(params.ttl ?? 3600);
  const timeRange = Number(params.time_range ?? 0);
  const enableAdsQuery = params.enable_ads_query ?? true;

  if (!mainId || !shopId) {
    throw new Error("主账号ID和店铺ID不能为0");
  }

  const today = new Date();
  const endDate = new Date(today);
  endDate.setDate(endDate.getDate() - timeRange);
  const start = toShopeeDate(endDate);
  const end = toShopeeDate(today);

  const redis: Redis = getSharedRedis();

  try {
    const tokenStorage = new RedisTokenStorage(redis, mainId, shopId);
    const token = await tokenStorage.get();
    if (!token?.access_token) {
      throw new Error("Redis 里找不到 access_token");
    }

    const sdk = new ShopeeSDK(
      {
        partner_id: params.credentials.partner_id,
        partner_key: params.credentials.partner_key,
        base_url: params.credentials.base_url,
        shop_id: shopId,
      },
      tokenStorage
    );

    const itemIdPool: number[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const listRes = await sdk.product.getItemList({
        offset,
        page_size: pageSize,
        item_status: [ItemStatus.NORMAL],
      });
      const list = listRes.response?.item ?? [];
      list.forEach((it) => itemIdPool.push(it.item_id));
      hasMore = listRes.response?.has_next_page ?? false;
      offset = listRes.response?.next_offset ?? offset + pageSize;
      if (hasMore) {
        await delay(500);
      }
    }

    if (itemIdPool.length === 0) {
      return {
        ok: true,
        summary: { warning: "店铺无商品", shop_id: shopId, count: 0 },
        items: [],
      };
    }

    const baseMap: Record<number, Record<string, unknown>> = {};
    const baseInfoErrors: string[] = [];
    const batchSize = 20;

    for (let j = 0; j < itemIdPool.length; j += batchSize) {
      const ids = itemIdPool.slice(j, j + batchSize);
      let retryCount = 0;
      const maxRetries = 3;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          const baseRes = await sdk.product.getItemBaseInfo({ item_id_list: ids });
          const itemList = baseRes.response?.item_list ?? [];
          itemList.forEach((it) => {
            if (it?.item_id != null) {
              baseMap[it.item_id] = it as unknown as Record<string, unknown>;
            }
          });
          success = true;
          if (j + batchSize < itemIdPool.length) {
            await delay(500);
          }
        } catch (error: unknown) {
          retryCount++;
          const message = error instanceof Error ? error.message : String(error);
          const isTimeout = message.includes("timeout") || message.includes("ETIMEDOUT");
          if (retryCount < maxRetries && isTimeout) {
            await delay(retryCount * 2000);
          } else {
            baseInfoErrors.push(
              `base_info 批次 ${Math.floor(j / batchSize) + 1} 获取失败: ${message}`
            );
            break;
          }
        }
      }
    }

    const modelMap: Record<string, unknown[]> = {};
    const needModelIds = Object.values(baseMap)
      .filter((it) => it.has_model)
      .map((it) => Number(it.item_id));

    for (const itemId of needModelIds) {
      try {
        const modelRes = await sdk.product.getModelList({ item_id: itemId });
        modelMap[String(itemId)] = (modelRes.response?.model as unknown[]) ?? [];
        await delay(200);
      } catch {
        modelMap[String(itemId)] = [];
      }
    }

    const extraMap: Record<number, Record<string, unknown>> = {};
    const extraInfoErrors: string[] = [];

    if (enableAdsQuery) {
      for (let j = 0; j < itemIdPool.length; j += batchSize) {
        const ids = itemIdPool.slice(j, j + batchSize);
        let retryCount = 0;
        const maxRetries = 3;
        let success = false;

        while (retryCount < maxRetries && !success) {
          try {
            const extraRes = await sdk.product.getItemExtraInfo({ item_id_list: ids });
            const extraItemList = extraRes.response?.item_list ?? [];
            extraItemList.forEach((it) => {
              if (it?.item_id != null) {
                extraMap[it.item_id] = it as unknown as Record<string, unknown>;
              }
            });
            success = true;
            if (j + batchSize < itemIdPool.length) {
              await delay(500);
            }
          } catch (error: unknown) {
            retryCount++;
            const message = error instanceof Error ? error.message : String(error);
            const isTimeout = message.includes("timeout") || message.includes("ETIMEDOUT");
            if (retryCount < maxRetries && isTimeout) {
              await delay(retryCount * 2000);
            } else {
              extraInfoErrors.push(
                `extra_info 批次 ${Math.floor(j / batchSize) + 1} 获取失败: ${message}`
              );
              break;
            }
          }
        }
      }
    }

    const adsMap: Record<number, Record<string, unknown>> = {};

    if (enableAdsQuery) {
      let adsOffset = 0;
      let adsHasMore = true;

      while (adsHasMore) {
        try {
          const adsRes = await sdk.ads.getGmsItemPerformance({
            start_date: start,
            end_date: end,
            limit: Math.min(pageSize, 100),
            offset: adsOffset,
          });
          const resultList = (adsRes.response?.result_list ?? []) as Array<{
            item_id: number;
            report?: Record<string, unknown>;
          }>;

          resultList.forEach((it) => {
            if (it.item_id) {
              adsMap[it.item_id] = {
                ...(it.report ?? (it as unknown as Record<string, unknown>)),
                item_id: it.item_id,
              };
            }
          });

          adsHasMore = adsRes.response?.has_next_page ?? false;
          adsOffset += resultList.length;
          if (adsHasMore) {
            await delay(200);
          }
        } catch {
          adsHasMore = false;
        }
      }
    }

    const finalMap: Record<number, Record<string, unknown>> = {};
    const pushedItems: unknown[] = [];

    Object.values(baseMap).forEach((it) => {
      const itemId = Number(it.item_id);
      const extra = extraMap[itemId];
      const ads = adsMap[itemId];
      const models = modelMap[String(itemId)] ?? [];

      const processedModels = models.map((m) => {
        const model = m as Record<string, unknown>;
        const priceInfo = (model.price_info as Array<Record<string, unknown>>) ?? [];
        const stockInfo = model.stock_info_v2 as Record<string, unknown> | undefined;
        const summaryInfo = stockInfo?.summary_info as Record<string, unknown> | undefined;
        const sellerStock = (stockInfo?.seller_stock as Array<Record<string, unknown>>) ?? [];

        return {
          model_id: model.model_id,
          promotion_id: model.promotion_id,
          model_name: model.model_name,
          model_sku: model.model_sku,
          model_status: model.model_status,
          currency: priceInfo[0]?.currency ?? 0,
          original_price: priceInfo[0]?.original_price ?? 0,
          current_price: priceInfo[0]?.current_price ?? 0,
          total_reserved_stock: summaryInfo?.total_reserved_stock ?? 0,
          total_available_stock: summaryInfo?.total_available_stock ?? 0,
          location_id: sellerStock[0]?.location_id ?? "",
          stock: sellerStock[0]?.stock ?? "",
        };
      });

      const baseItem: Record<string, unknown> = {
        main_id: mainId,
        shop_id: shopId,
        item_id: itemId,
        item_name: it.item_name,
        has_model: it.has_model,
        update_time: it.update_time,
        brand: (it.brand as { original_brand_name?: string })?.original_brand_name ?? it.brand ?? "",
        video_info: it.video_info ?? [],
        image_info: it.image ?? {},
        models: processedModels,
      };

      if (enableAdsQuery) {
        baseItem.extra = mapExtraFields(extra);
        baseItem.ads = mapAdsFields(ads);
      }

      finalMap[itemId] = baseItem;
      pushedItems.push(baseItem);
    });

    const redisKey = itemsKey(shopId);
    const payload = JSON.stringify(Object.values(finalMap));
    if (ttl > 0) {
      await redis.setex(redisKey, ttl, payload);
    } else {
      await redis.set(redisKey, payload);
    }

    const summary: SyncShopSummary = {
      redis_key: redisKey,
      ttl,
      count: Object.keys(finalMap).length,
      message: "商品全量已写入 Redis",
      shop_id: shopId,
    };

    if (baseInfoErrors.length > 0) {
      summary.base_info_errors = baseInfoErrors;
    }
    if (extraInfoErrors.length > 0) {
      summary.extra_info_errors = extraInfoErrors;
    }

    const invalidated = await invalidateShopApiCacheByPrefix(
      redis,
      mainId,
      shopId,
      "shopee_product_"
    );
    summary.api_cache_invalidated = invalidated;

    return { ok: true, summary, items: pushedItems };
  } finally {
    /* 复用 redis-pool，不在此 quit */
  }
}
