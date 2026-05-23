import crypto from "node:crypto";

/**
 * Shopee Open API v2 HMAC-SHA256 sign.
 * @see https://open.shopee.com/developer-guide/16
 */
export function generateShopeeSignature(
  partnerKey: string,
  parts: string[]
): string {
  const baseString = parts.join("");
  return crypto.createHmac("sha256", partnerKey).update(baseString).digest("hex");
}

export type ShopSignInput = {
  partnerId: number;
  apiPath: string;
  timestamp: number;
  accessToken: string;
  shopId: number;
  method?: string;
  body?: unknown;
};

/**
 * Shop-level API base string (Open API v2 官方文档):
 * partner_id + path + timestamp + access_token + shop_id
 *
 * 部分第三方实现会在 POST 时追加 body；可通过 SHOPEE_SIGN_POST_BODY=1 开启。
 */
export function buildShopApiSignParts(input: ShopSignInput): string[] {
  const parts = [
    String(input.partnerId),
    input.apiPath,
    String(input.timestamp),
    input.accessToken,
    String(input.shopId),
  ];

  const includePostBody =
    process.env.SHOPEE_SIGN_POST_BODY === "1" ||
    process.env.SHOPEE_SIGN_POST_BODY === "true";

  const method = (input.method ?? "GET").toUpperCase();
  if (includePostBody && method === "POST" && input.body !== undefined) {
    parts.push(JSON.stringify(input.body));
  }

  return parts;
}
