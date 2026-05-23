import { createJiti } from "jiti";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TiktokCredentials } from "./config.js";
import { resolveTiktokSdkRoot } from "./tiktok-sdk-root.js";

export type TiktokSdkModule = {
  TikTokShopNodeApiClient: new (opts: {
    config?: { sandbox?: boolean; app_key?: string; app_secret?: string };
  }) => TiktokApiClient;
  ClientConfiguration: {
    globalConfig: {
      app_key?: string;
      app_secret?: string;
      basePath?: string;
    };
  };
  AccessTokenTool: {
    getAccessToken: (
      authCode: string,
      appKey?: string,
      appSecret?: string
    ) => Promise<{ body: unknown }>;
    refreshToken: (
      refreshToken: string,
      appKey?: string,
      appSecret?: string
    ) => Promise<{ body: unknown }>;
  };
};

export type TiktokApiClient = {
  api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>;
};

let cachedSdk: TiktokSdkModule | null = null;
const cachedClients = new Map<string, TiktokApiClient>();

const jiti = createJiti(join(dirname(fileURLToPath(import.meta.url)), "jiti-bootstrap.mjs"));

export async function loadTiktokSdkModule(): Promise<TiktokSdkModule> {
  if (cachedSdk) return cachedSdk;
  const root = resolveTiktokSdkRoot();
  cachedSdk = (await jiti.import(join(root, "index.ts"))) as TiktokSdkModule;
  return cachedSdk;
}

export async function createTiktokApiClient(
  credentials: TiktokCredentials
): Promise<TiktokApiClient> {
  const sdk = await loadTiktokSdkModule();
  sdk.ClientConfiguration.globalConfig.app_key = credentials.app_key;
  sdk.ClientConfiguration.globalConfig.app_secret = credentials.app_secret;
  if (credentials.sandbox) {
    sdk.ClientConfiguration.globalConfig.basePath =
      "https://open-api-sandbox.tiktokglobalshop.com";
  }
  const hit = cachedClients.get(credentials.app_key);
  if (hit) return hit;

  const client = new sdk.TikTokShopNodeApiClient({
    config: {
      sandbox: credentials.sandbox,
      app_key: credentials.app_key,
      app_secret: credentials.app_secret,
    },
  });
  cachedClients.set(credentials.app_key, client);
  return client;
}

export function getTiktokApiClient(credentials?: TiktokCredentials): TiktokApiClient {
  if (credentials) {
    const hit = cachedClients.get(credentials.app_key);
    if (hit) return hit;
    throw new Error(
      `TikTok API client 未初始化（app_key=${credentials.app_key}），请先 createTiktokApiClient`
    );
  }
  const first = cachedClients.values().next().value;
  if (!first) {
    throw new Error("TikTok API client 未初始化");
  }
  return first;
}
