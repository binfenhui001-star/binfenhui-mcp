import { ShopeeSDK } from "@congminh1254/shopee-sdk";

import type { SdkToolDefinition } from "./sdk-tool-catalog.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 将 API 返回值序列化为 JSON（Buffer → base64） */
export function serializeApiResult(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return { _type: "Buffer", base64: value.toString("base64") };
  }
  if (Array.isArray(value)) {
    return value.map(serializeApiResult);
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeApiResult(v);
    }
    return out;
  }
  return value;
}

function numOrUndef(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** ShopeeSDK 根方法多为位置参数，与 Manager 的 params 对象不同 */
async function invokeSdkRootMethod(
  sdk: ShopeeSDK,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (method) {
    case "getAuthorizationUrl":
      return sdk.getAuthorizationUrl(
        String(params.redirect_uri ?? params.redirectUri ?? "")
      );
    case "authenticateWithCode":
      return sdk.authenticateWithCode(
        String(params.code ?? ""),
        numOrUndef(params.shopId ?? params.shop_id),
        numOrUndef(params.mainAccountId ?? params.main_account_id)
      );
    case "getAuthToken":
      return sdk.getAuthToken();
    case "refreshToken":
      return sdk.refreshToken(
        numOrUndef(params.shop_id ?? params.shopId),
        numOrUndef(params.merchant_id ?? params.merchantId)
      );
    default: {
      const fn = (sdk as unknown as Record<string, unknown>)[method];
      if (typeof fn !== "function") {
        throw new Error(`SDK 方法不存在: ${method}`);
      }
      if (Object.keys(params).length === 0) {
        return (fn as () => Promise<unknown>).call(sdk);
      }
      return (fn as (p: Record<string, unknown>) => Promise<unknown>).call(
        sdk,
        params
      );
    }
  }
}

export async function invokeSdkTool(
  sdk: ShopeeSDK,
  def: SdkToolDefinition,
  params: Record<string, unknown>
): Promise<unknown> {
  if (!def.manager) {
    return invokeSdkRootMethod(sdk, def.method, params);
  }

  const manager = (sdk as unknown as Record<string, unknown>)[def.manager];
  if (!manager || typeof manager !== "object") {
    throw new Error(`SDK 管理器不存在: ${def.manager}`);
  }
  const fn = (manager as Record<string, unknown>)[def.method];
  if (typeof fn !== "function") {
    throw new Error(`SDK 方法不存在: ${def.manager}.${def.method}`);
  }
  return (fn as (p: Record<string, unknown>) => Promise<unknown>).call(manager, params);
}

