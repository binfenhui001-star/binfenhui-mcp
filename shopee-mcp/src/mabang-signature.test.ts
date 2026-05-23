import { describe, expect, it } from "bun:test";
import {
  serializeMabangRequestBody,
  signMabangRequestBody,
} from "./mabang-signature.js";

describe("mabang-signature", () => {
  it("matches official stock-get-stock-quantity example", () => {
    const body = {
      api: "stock-get-stock-quantity",
      appkey: "201501",
      data: {},
      timestamp: 1779176045,
    };
    const json = serializeMabangRequestBody(body);
    expect(json).toBe(
      '{"api":"stock-get-stock-quantity","appkey":"201501","data":{},"timestamp":1779176045}'
    );
    const signature = signMabangRequestBody(
      json,
      "2c11c34624d660dfae3ba7aa42e5cde2"
    );
    expect(signature).toBe(
      "2b5899e3232fb98803f7ff4dedf8a3941ea8b36f1308d8435a407478a2f177a9"
    );
  });
});
