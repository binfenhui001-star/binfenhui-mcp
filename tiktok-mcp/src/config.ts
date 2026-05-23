export type { TiktokCredentials } from "./tiktok-credentials-registry.js";
export {
  loadTiktokCredentialsFromEnv,
  loadTiktokCredentialsFromEnvOptional,
  loadTiktokCredentialsRegistry,
  loadTiktokCredentialsRegistryOptional,
  type TiktokAppProfile,
  type TiktokCredentialsRegistry,
} from "./tiktok-credentials-registry.js";

export function loadRedisConfigFromEnv() {
  return {
    host:
      process.env.REDIS_HOST?.trim() ||
      process.env.TIKTOK_REDIS_HOST?.trim() ||
      "127.0.0.1",
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASS || "",
    db: Number(process.env.REDIS_DB || 0),
  };
}
