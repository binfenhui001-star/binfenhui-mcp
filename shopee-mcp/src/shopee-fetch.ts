import fetch, { Headers } from "node-fetch";

import {
  ShopeeApiError,
  ShopeeSdkError,
} from "../node_modules/@congminh1254/shopee-sdk/lib/errors.js";
import { SDK_VERSION } from "../node_modules/@congminh1254/shopee-sdk/lib/version.js";

import {
  buildShopApiSignParts,
  generateShopeeSignature,
} from "./shopee-signature.js";

type ShopeeFetchConfig = {
  partner_id: number;
  partner_key: string;
  base_url: string;
  shop_id?: number;
  sdk?: {
    getAuthToken?: () => Promise<{
      access_token: string;
      shop_id?: number;
      expired_at?: number;
    } | null>;
    refreshToken?: () => Promise<{
      access_token: string;
      shop_id?: number;
    } | null>;
  };
  agent?: unknown;
};

type FetchOptions = {
  method?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
};

/**
 * Drop-in replacement for @congminh1254/shopee-sdk ShopeeFetch with:
 * - Correct Open API v2 shop sign (GET/POST same base string)
 * - shop_id from config when token payload omits it
 */
export class FixedShopeeFetch {
  static async fetch(
    config: ShopeeFetchConfig,
    path: string,
    options: FetchOptions = {}
  ): Promise<unknown> {
    const { method = "GET", params = {}, body } = options;
    const url = new URL(`${config.base_url}${path}`);
    const timestamp = Math.floor(Date.now() / 1000);

    const cleanedParams: Record<string, unknown> = { ...params };
    Object.keys(cleanedParams).forEach((key) => {
      if (cleanedParams[key] === undefined) delete cleanedParams[key];
    });

    const allParams: Record<string, unknown> = {
      partner_id: config.partner_id,
      timestamp,
      ...cleanedParams,
    };

    let authParams: Record<string, unknown> = {};
    let accessToken = "";

    if (options.auth) {
      let token = await config.sdk?.getAuthToken?.();
      if (token?.expired_at && token.expired_at < Date.now()) {
        token = (await config.sdk?.refreshToken?.()) ?? token;
      }
      if (!token?.access_token) {
        throw new ShopeeSdkError("No access token found");
      }

      accessToken = token.access_token;
      const shopId = config.shop_id ?? token.shop_id;
      if (!shopId) {
        throw new ShopeeSdkError("shop_id is required for shop API calls");
      }

      authParams = {
        access_token: accessToken,
        shop_id: shopId,
      };

      const signParts = buildShopApiSignParts({
        partnerId: config.partner_id,
        apiPath: url.pathname,
        timestamp,
        accessToken,
        shopId,
        method,
        body: method.toUpperCase() === "POST" ? body : undefined,
      });

      allParams.sign = generateShopeeSignature(config.partner_key, signParts);
    } else {
      const signParts = [
        String(config.partner_id),
        url.pathname,
        String(timestamp),
      ];
      allParams.sign = generateShopeeSignature(config.partner_key, signParts);
    }

    Object.entries({ ...allParams, ...authParams }).forEach(([key, value]) => {
      if (value === undefined) return;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          url.searchParams.append(key, String(item));
        });
      } else {
        url.searchParams.append(key, String(value));
      }
    });

    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("User-Agent", `binfenhui/shopee-mcp/v1 (shopee-sdk ${SDK_VERSION})`);

    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        headers.set(key, value);
      });
    }

    const requestOptions = {
      method,
      headers,
      body:
        body !== undefined && method.toUpperCase() !== "GET"
          ? JSON.stringify(body)
          : undefined,
      agent: config.agent as never,
    };

    try {
      const response = await fetch(url.toString(), requestOptions);
      const responseType = response.headers.get("Content-Type");

      if (
        responseType?.includes("application/pdf") ||
        responseType?.includes("application/octet-stream")
      ) {
        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      }

      const responseData =
        responseType?.indexOf("application/json") !== -1
          ? await response.json()
          : await response.text();

      if (responseType?.indexOf("application/json") !== -1) {
        const jsonData = responseData as Record<string, unknown>;
        if (jsonData.error) {
          if (jsonData.error === "invalid_acceess_token" && options.auth) {
            try {
              await config.sdk?.refreshToken?.();
              return this.fetch(config, path, options);
            } catch {
              throw new ShopeeApiError(response.status, jsonData);
            }
          }
          throw new ShopeeApiError(response.status, jsonData);
        }
        return responseData;
      }

      throw new ShopeeSdkError(
        `Unknown response type: ${responseType}\n${String(responseData)}`
      );
    } catch (error) {
      if (error instanceof ShopeeApiError || error instanceof ShopeeSdkError) {
        throw error;
      }
      if (error instanceof Error) {
        if (error.name === "FetchError") {
          throw new ShopeeSdkError(`Network error: ${error.message}`);
        }
        throw new ShopeeSdkError(`Unexpected error: ${error.message}`);
      }
      throw new ShopeeSdkError("Unknown error occurred");
    }
  }
}
