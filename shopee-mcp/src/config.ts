import { SHOPEE_BASE_URLS, ShopeeRegion } from "@congminh1254/shopee-sdk/schemas";

/** 中国跨境 Open API（店铺/商品等），勿用 SDK 自带的 …/api/v2/public */
export const CHINA_OPEN_API_BASE = "https://openplatform.shopee.cn/api/v2";
export const TEST_CHINA_OPEN_API_BASE =
  "https://openplatform.test-stable.shopee.cn/api/v2";

export interface ShopeeCredentials {
  partner_id: number;
  partner_key: string;
  base_url: string;
}

export interface RedisConfig {
  host: string;
  port: number;
  password: string;
  db: number;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

/** 兼容旧 MCP：sandbox/live 别名，或完整 https:// 基址 */
export function resolveBaseUrl(environment: string): string {
  const normalized = environment.trim().toLowerCase();
  if (environment.startsWith("http://") || environment.startsWith("https://")) {
    const url = environment.replace(/\/$/, "");
    // 中国 Open API：SDK 的 CHINA 常量带 /public，仅适用于 public 端点，店铺 API 会 403
    if (url.includes("openplatform.shopee.cn")) {
      return CHINA_OPEN_API_BASE;
    }
    if (url.includes("openplatform.test-stable.shopee.cn")) {
      return TEST_CHINA_OPEN_API_BASE;
    }
    return url.endsWith("/api/v2") ? url : `${url}/api/v2`;
  }

  switch (normalized) {
    case "sandbox":
    case "test":
    case "test_global":
      return SHOPEE_BASE_URLS[ShopeeRegion.TEST_GLOBAL];
    case "live":
    case "production":
    case "global":
      return SHOPEE_BASE_URLS[ShopeeRegion.GLOBAL];
    case "china":
      return SHOPEE_BASE_URLS[ShopeeRegion.CHINA];
    case "brazil":
      return SHOPEE_BASE_URLS[ShopeeRegion.BRAZIL];
    default:
      throw new Error(
        `无法解析 SHOPEE_ENVIRONMENT="${environment}"，请使用 sandbox、live、china，或完整 API 基址`
      );
  }
}

export function loadCredentialsFromEnv(): ShopeeCredentials {
  return {
    partner_id: Number(requireEnv("SHOPEE_PARTNER_ID")),
    partner_key: requireEnv("SHOPEE_PARTNER_KEY"),
    base_url: resolveBaseUrl(requireEnv("SHOPEE_ENVIRONMENT")),
  };
}

/** MCP 进程可先启动并暴露目录工具；invoke 类工具在缺凭据时再报错。 */
export function loadCredentialsFromEnvOptional(): ShopeeCredentials | null {
  try {
    return loadCredentialsFromEnv();
  } catch {
    return null;
  }
}

export function loadRedisConfigFromEnv(): RedisConfig {
  return {
    host:
      process.env.REDIS_HOST?.trim() ||
      process.env.SHOPEE_REDIS_HOST?.trim() ||
      "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASS || "",
    db: Number(process.env.REDIS_DB || 0),
  };
}
