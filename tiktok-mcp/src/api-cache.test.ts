import { describe, expect, it } from "bun:test";

import {
  buildApiCacheKey,
  isReadOnlySdkTool,
  isSuccessfulTiktokResponse,
} from "./api-cache.js";
import type { SdkToolDefinition } from "./sdk-tool-catalog.js";

describe("tiktok api-cache", () => {
  it("builds stable cache keys", () => {
    const a = buildApiCacheKey("app1", "shop1", "tiktok_product_x", { pageSize: 50 });
    const b = buildApiCacheKey("app1", "shop1", "tiktok_product_x", { pageSize: 50 });
    expect(a).toBe(b);
    expect(a.startsWith("tiktok:api:app1:shop1:")).toBe(true);
  });

  it("detects read-only product search", () => {
    const def: SdkToolDefinition = {
      toolName: "tiktok_product_v202502_products_search_post",
      apiClient: "ProductV202502Api",
      method: "ProductsSearchPost",
    };
    expect(isReadOnlySdkTool(def)).toBe(true);
  });

  it("detects tiktok API success", () => {
    expect(isSuccessfulTiktokResponse({ code: 0, data: {} })).toBe(true);
    expect(isSuccessfulTiktokResponse({ code: 1001 })).toBe(false);
  });
});
