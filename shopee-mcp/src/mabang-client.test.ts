import { describe, expect, it } from "bun:test";
import { buildStockQuantityRequest } from "./mabang-client.js";

const creds = {
  appkey: "201501",
  secret: "test-secret",
  apiBase: "https://gwapi.mabangerp.com/api/v2",
};

describe("buildStockQuantityRequest", () => {
  it("requires update_time when stock_skus omitted", () => {
    expect(() => buildStockQuantityRequest(creds, {}, 1779176045)).toThrow(
      /updateTime/
    );
  });

  it("allows empty data when stock_skus provided", () => {
    const body = buildStockQuantityRequest(
      creds,
      { stockSkus: "SKU-A,SKU-B" },
      1779176045
    );
    expect(body.data).toEqual({ stockSkus: "SKU-A,SKU-B" });
    expect(body.timestamp).toBe(1779176045);
  });

  it("includes optional warehouse and page", () => {
    const body = buildStockQuantityRequest(
      creds,
      {
        updateTime: "2021-05-01",
        warehouseName: "Main",
        page: 2,
      },
      1779176045
    );
    expect(body.data).toEqual({
      updateTime: "2021-05-01",
      warehouseName: "Main",
      page: 2,
    });
  });
});
