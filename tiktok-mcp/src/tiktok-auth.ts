import type { TiktokCredentials } from "./config.js";
import { loadTiktokSdkModule } from "./tiktok-sdk-client.js";

export type TokenResponseBody = {
  code?: number;
  message?: string;
  data?: {
    access_token?: string;
    refresh_token?: string;
    access_token_expire_in?: number;
    refresh_token_expire_in?: number;
    open_id?: string;
    seller_name?: string;
    seller_base_region?: string;
  };
  requestId?: string;
};

export type AuthorizedShop = {
  id?: string;
  cipher?: string;
  code?: string;
  name?: string;
  region?: string;
  sellerType?: string;
};

function authHost(): string {
  return process.env.TIKTOK_AUTH_HOST?.trim() || "https://auth.tiktok-shops.com";
}

function servicesAuthorizeHost(): string {
  if (process.env.TIKTOK_SERVICES_AUTH_HOST?.trim()) {
    return process.env.TIKTOK_SERVICES_AUTH_HOST.trim();
  }
  return process.env.TIKTOK_ENVIRONMENT?.trim().toLowerCase() === "sandbox"
    ? "https://services.tiktokshop.com"
    : "https://services.tiktokshop.com";
}

export function buildAuthorizationUrl(
  credentials: TiktokCredentials,
  options: {
    redirect_uri: string;
    state?: string;
    service_id?: string;
  }
): { url: string; mode: "oauth" | "service_id" } {
  const redirectUri = options.redirect_uri.trim();
  if (!redirectUri) {
    throw new Error("redirect_uri 不能为空");
  }
  const state = options.state?.trim() || `tiktok_${Date.now()}`;
  const profile = credentials as import("./tiktok-credentials-registry.js").TiktokAppProfile;
  const serviceId =
    options.service_id?.trim() ||
    profile.service_id?.trim() ||
    process.env.TIKTOK_SERVICE_ID?.trim() ||
    credentials.app_key;

  if (process.env.TIKTOK_AUTH_URL_MODE?.trim() === "service_id" && serviceId) {
    const url = new URL(`${servicesAuthorizeHost()}/open/authorize`);
    url.searchParams.set("service_id", serviceId);
    url.searchParams.set("state", state);
    return { url: url.toString(), mode: "service_id" };
  }

  const url = new URL(`${authHost()}/oauth/authorize`);
  url.searchParams.set("app_key", credentials.app_key);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  return { url: url.toString(), mode: "oauth" };
}

export async function exchangeAuthCode(
  credentials: TiktokCredentials,
  authCode: string
): Promise<TokenResponseBody> {
  const sdk = await loadTiktokSdkModule();
  const result = await sdk.AccessTokenTool.getAccessToken(
    authCode.trim(),
    credentials.app_key,
    credentials.app_secret
  );
  return result.body as TokenResponseBody;
}

/**
 * 刷新 access_token。refresh_token 原样传入（含 ROW_ 前缀，勿解密）。
 * 官方 SDK 误用 grant_type=authorized_code，此处直接调 auth API。
 */
export async function refreshAccessToken(
  credentials: TiktokCredentials,
  refreshToken: string
): Promise<TokenResponseBody> {
  const trimmed = refreshToken.trim();
  if (!trimmed) {
    throw new Error("refresh_token 不能为空");
  }

  const url = new URL(`${authHost()}/api/v2/token/refresh`);
  url.searchParams.set("app_key", credentials.app_key);
  url.searchParams.set("app_secret", credentials.app_secret);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", trimmed);

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`刷新 token HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponseBody;
}

export async function fetchAuthorizedShops(
  credentials: TiktokCredentials,
  accessToken: string
): Promise<AuthorizedShop[]> {
  const { createTiktokApiClient } = await import("./tiktok-sdk-client.js");
  const client = await createTiktokApiClient(credentials);
  const api = client.api.AuthorizationV202309Api;
  if (!api?.ShopsGet) {
    throw new Error("SDK 缺少 AuthorizationV202309Api.ShopsGet");
  }
  const result = await api.ShopsGet(accessToken, "application/json");
  const shops = (result as { body?: { data?: { shops?: AuthorizedShop[] } } })
    .body?.data?.shops;
  return shops ?? [];
}

export function tokenDataToRecord(
  token: TokenResponseBody,
  shop: AuthorizedShop | undefined,
  app: TiktokCredentials & { label?: string }
): import("./redis-token-storage.js").TiktokTokenRecord {
  const data = token.data;
  return {
    access_token: data?.access_token ?? "",
    refresh_token: data?.refresh_token,
    shop_cipher: shop?.cipher,
    open_id: data?.open_id,
    shop_code: shop?.code,
    shop_name: shop?.name ?? data?.seller_name,
    region: shop?.region ?? data?.seller_base_region,
    access_token_expire_in: data?.access_token_expire_in,
    refresh_token_expire_in: data?.refresh_token_expire_in,
    app_key: app.app_key,
    app_label: app.label,
    updated_at: new Date().toISOString(),
  };
}
