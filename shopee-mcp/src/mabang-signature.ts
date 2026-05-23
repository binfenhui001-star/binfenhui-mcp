import crypto from "node:crypto";

/** HMAC-SHA256 hex digest of the exact JSON request body (马帮 gwapi v2). */
export function signMabangRequestBody(bodyJson: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(bodyJson).digest("hex");
}

/** Stable JSON for signing — insertion order matches { api, appkey, data, timestamp }. */
export function serializeMabangRequestBody(body: {
  api: string;
  appkey: string;
  data: Record<string, unknown>;
  timestamp: number;
}): string {
  return JSON.stringify(body);
}
