import type { MabangCredentials } from "./mabang-config.js";
import {
  serializeMabangRequestBody,
  signMabangRequestBody,
} from "./mabang-signature.js";

export type MabangStockQuantityData = {
  stockSkus?: string;
  updateTime?: string;
  warehouseName?: string;
  page?: number;
};

export type MabangApiResponse = {
  code?: number | string;
  message?: string;
  data?: unknown;
  [key: string]: unknown;
};

export function buildStockQuantityRequest(
  credentials: MabangCredentials,
  data: MabangStockQuantityData,
  timestamp?: number
): {
  api: string;
  appkey: string;
  data: Record<string, unknown>;
  timestamp: number;
} {
  const payload: Record<string, unknown> = {};
  if (data.stockSkus?.trim()) {
    payload.stockSkus = data.stockSkus.trim();
  }
  if (data.updateTime?.trim()) {
    payload.updateTime = data.updateTime.trim();
  }
  if (data.warehouseName?.trim()) {
    payload.warehouseName = data.warehouseName.trim();
  }
  if (data.page !== undefined && data.page !== null) {
    payload.page = data.page;
  }

  const hasSkus = Boolean(payload.stockSkus);
  if (!hasSkus && !payload.updateTime) {
    throw new Error(
      "updateTime 为必填（按天查询）；若提供 stockSkus 则可省略 updateTime"
    );
  }

  return {
    api: "stock-get-stock-quantity",
    appkey: credentials.appkey,
    data: payload,
    timestamp: timestamp ?? Math.floor(Date.now() / 1000),
  };
}

export async function callMabangApi(
  credentials: MabangCredentials,
  body: {
    api: string;
    appkey: string;
    data: Record<string, unknown>;
    timestamp: number;
  }
): Promise<MabangApiResponse> {
  const bodyJson = serializeMabangRequestBody(body);
  const authorization = signMabangRequestBody(bodyJson, credentials.secret);

  const response = await fetch(credentials.apiBase, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Authorization: authorization,
    },
    body: bodyJson,
  });

  const text = await response.text();
  let parsed: MabangApiResponse;
  try {
    parsed = JSON.parse(text) as MabangApiResponse;
  } catch {
    throw new Error(
      `马帮 API 返回非 JSON（HTTP ${response.status}）: ${text.slice(0, 500)}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `马帮 API HTTP ${response.status}: ${parsed.message ?? text.slice(0, 500)}`
    );
  }

  return parsed;
}

export async function getStockQuantity(
  credentials: MabangCredentials,
  data: MabangStockQuantityData
): Promise<MabangApiResponse> {
  const body = buildStockQuantityRequest(credentials, data);
  return callMabangApi(credentials, body);
}
