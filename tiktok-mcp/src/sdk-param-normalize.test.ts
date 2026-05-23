import { describe, expect, it } from "bun:test";

import {
  MCP_INJECTED_PARAM_NAMES,
  mergePositionalKeysToCanonical,
  normalizeInvokeEnvelope,
  normalizeSdkParams,
} from "./sdk-param-normalize.js";

describe("normalizeSdkParams", () => {
  it("maps snake_case aliases to SDK positional names", () => {
    const out = normalizeSdkParams("tiktok_product_v202502_products_search_post", {
      page_size: "20",
      page_token: "",
    });
    expect(out.pageSize).toBe(20);
    expect(out.pageToken ?? "").toBe("");
    expect(out.options).toEqual({});
  });

  it("rejects unknown params keys", () => {
    expect(() =>
      normalizeSdkParams("tiktok_product_v202502_products_search_post", {
        page_size: 20,
        foo_bar: 1,
      })
    ).toThrow(/未知 params 字段/);
  });

  it("accepts RequestBody via body alias", () => {
    const out = normalizeSdkParams("tiktok_product_v202502_products_search_post", {
      page_size: 10,
      body: { status: "ACTIVATE" },
    });
    expect(out.SearchProductsRequestBody).toEqual({ status: "ACTIVATE" });
  });

  it("does not require xTtsAccessToken or contentType", () => {
    const out = normalizeSdkParams("tiktok_product_v202502_products_search_post", {
      page_size: 5,
    });
    expect(out.xTtsAccessToken).toBeUndefined();
    expect(out.contentType).toBeUndefined();
    expect(out.pageSize).toBe(5);
  });

  it("hoists createTimeGe/Lt into GetOrderListRequestBody", () => {
    const out = normalizeSdkParams("tiktok_order_v202309_orders_search_post", {
      page_size: 20,
      create_time_ge: 1714521600,
      create_time_lt: 1715385600,
    });
    expect(out.pageSize).toBe(20);
    const body = out.GetOrderListRequestBody as Record<string, unknown>;
    expect(body.createTimeGe).toBe(1714521600);
    expect(body.createTimeLt).toBe(1715385600);
  });

  it("canonicalizes snake_case keys inside body object", () => {
    const out = normalizeSdkParams("tiktok_order_v202309_orders_search_post", {
      page_size: 10,
      body: { create_time_ge: 1714521600, create_time_lt: 1715385600 },
    });
    const body = out.GetOrderListRequestBody as Record<string, unknown>;
    expect(body.createTimeGe).toBe(1714521600);
    expect(body.createTimeLt).toBe(1715385600);
    expect(body).not.toHaveProperty("create_time_ge");
  });

  it("rejects millisecond timestamps", () => {
    expect(() =>
      normalizeSdkParams("tiktok_order_v202309_orders_search_post", {
        page_size: 10,
        createTimeGe: 1714521600000,
        createTimeLt: 1715385600000,
      })
    ).toThrow(/Unix 秒/);
  });

  it("rejects createTimeLt-only (API returns shop earliest history)", () => {
    expect(() =>
      normalizeSdkParams("tiktok_order_v202309_orders_search_post", {
        page_size: 10,
        createTimeLt: 1715385600,
      })
    ).toThrow(/createTimeGe/);
  });
});

describe("normalizeInvokeEnvelope", () => {
  it("lifts shop_id from params to envelope", () => {
    const out = normalizeInvokeEnvelope("tiktok_product_v202502_products_search_post", {
      params: { shop_id: "7123", page_size: 10 },
    });
    expect(out.shop_id).toBe("7123");
    expect(out.params.shop_id).toBeUndefined();
    expect(out.params.pageSize).toBe(10);
  });
});

describe("MCP_INJECTED_PARAM_NAMES", () => {
  it("includes token and cipher", () => {
    expect(MCP_INJECTED_PARAM_NAMES.has("xTtsAccessToken")).toBe(true);
    expect(MCP_INJECTED_PARAM_NAMES.has("shopCipher")).toBe(true);
  });
});

describe("mergePositionalKeysToCanonical", () => {
  it("merges page_size to pageSize", () => {
    const meta = [
      { name: "pageSize", required: true, type: "number" },
      { name: "pageToken", required: false, type: "string" },
    ];
    const merged = mergePositionalKeysToCanonical(meta, {
      page_size: 1,
      page_token: "t",
    });
    expect(merged.pageSize).toBe(1);
    expect(merged.pageToken).toBe("t");
  });
});
