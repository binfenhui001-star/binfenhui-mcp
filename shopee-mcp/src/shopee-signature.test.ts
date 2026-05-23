import { describe, expect, it } from "bun:test";

import { buildShopApiSignParts, generateShopeeSignature } from "./shopee-signature.js";

describe("shopee-signature", () => {
  it("GET shop sign excludes body", () => {
    const parts = buildShopApiSignParts({
      partnerId: 2011414,
      apiPath: "/api/v2/product/get_item_list",
      timestamp: 1700000000,
      accessToken: "token_abc",
      shopId: 888003524,
      method: "GET",
    });
    expect(parts).toEqual([
      "2011414",
      "/api/v2/product/get_item_list",
      "1700000000",
      "token_abc",
      "888003524",
    ]);
  });

  it("POST shop sign matches GET (no body by default)", () => {
    const body = {
      start_date: "01-05-2026",
      end_date: "17-05-2026",
      limit: 10,
      offset: 0,
    };
    const parts = buildShopApiSignParts({
      partnerId: 2011414,
      apiPath: "/api/v2/ads/get_gms_item_performance",
      timestamp: 1700000000,
      accessToken: "token_abc",
      shopId: 888003524,
      method: "POST",
      body,
    });
    expect(parts).toHaveLength(5);
    expect(generateShopeeSignature("test_key", parts)).toHaveLength(64);
  });

  it("POST shop sign appends body when SHOPEE_SIGN_POST_BODY=1", () => {
    const prev = process.env.SHOPEE_SIGN_POST_BODY;
    process.env.SHOPEE_SIGN_POST_BODY = "1";
    try {
      const body = { limit: 10, offset: 0 };
      const parts = buildShopApiSignParts({
        partnerId: 1,
        apiPath: "/api/v2/ads/get_gms_item_performance",
        timestamp: 1,
        accessToken: "t",
        shopId: 2,
        method: "POST",
        body,
      });
      expect(parts[5]).toBe(JSON.stringify(body));
    } finally {
      if (prev === undefined) delete process.env.SHOPEE_SIGN_POST_BODY;
      else process.env.SHOPEE_SIGN_POST_BODY = prev;
    }
  });
});
