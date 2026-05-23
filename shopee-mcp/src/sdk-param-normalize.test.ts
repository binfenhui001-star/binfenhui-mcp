import { describe, expect, test } from "bun:test";

import {
  mergeParamKeysToCanonical,
  normalizeInvokeEnvelope,
  normalizeSdkParams,
} from "./sdk-param-normalize.js";
import type { SdkParamFieldMeta } from "./sdk-tool-metadata.js";

describe("normalizeSdkParams", () => {
  test("order list: string page_size → number, snake_case keys", () => {
    const out = normalizeSdkParams("shopee_order_get_order_list", {
      time_range_field: "create_time",
      time_from: "1714521600",
      time_to: "1715385600",
      page_size: "20",
    });
    expect(out.page_size).toBe(20);
    expect(out.time_from).toBe(1714521600);
    expect(out.time_range_field).toBe("create_time");
  });

  test("video list: page_no alias maps to pageNo", () => {
    const out = normalizeSdkParams("shopee_video_get_video_list", {
      page_no: "1",
      page_size: "10",
      list_type: "0",
    });
    expect(out.pageNo).toBe(1);
    expect(out.pageSize).toBe(10);
    expect((out as Record<string, unknown>).page_no).toBeUndefined();
  });

  test("oauth code must be string", () => {
    const out = normalizeSdkParams("shopee_sdk_authenticate_with_code", {
      code: 123456789,
      shop_id: "888003524",
    });
    expect(out.code).toBe("123456789");
    expect(out.shop_id).toBe(888003524);
  });

  test("rejects unknown keys when schema is strict", () => {
    expect(() =>
      normalizeSdkParams("shopee_order_get_order_list", {
        time_range_field: "create_time",
        time_from: 1,
        time_to: 2,
        page_size: 10,
        typo_field: true,
      })
    ).toThrow();
  });
});

describe("mergeParamKeysToCanonical", () => {
  test("maps snake_case input to camelCase canonical", () => {
    const fields: SdkParamFieldMeta[] = [
      { name: "pageNo", required: true, type: "number", description: "" },
      { name: "pageSize", required: true, type: "number", description: "" },
    ];
    const merged = mergeParamKeysToCanonical(fields, {
      page_no: 2,
      page_size: 50,
    });
    expect(merged.pageNo).toBe(2);
    expect(merged.pageSize).toBe(50);
  });
});

describe("normalizeInvokeEnvelope", () => {
  test("pulls main_id/shop_id from params and normalizes business fields", () => {
    const env = normalizeInvokeEnvelope("shopee_order_get_order_list", {
      params: {
        main_id: "1078087090",
        shop_id: "888003524",
        time_range_field: "create_time",
        time_from: 1,
        time_to: 2,
        page_size: "5",
      },
    });
    expect(env.main_id).toBe(1078087090);
    expect(env.shop_id).toBe(888003524);
    expect(env.params.page_size).toBe(5);
    expect(env.params.main_id).toBeUndefined();
  });
});
