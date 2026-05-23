import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { TiktokAppProfile, TiktokCredentialsRegistry } from "./config.js";
import { getSharedRedis } from "./redis-pool.js";
import {
  getTiktokAccessToken,
  getTiktokRefreshToken,
  saveTiktokToken,
  type TiktokTokenRecord,
} from "./redis-token-storage.js";
import { TIKTOK_ALWAYS_LOAD_META } from "./mcp-meta.js";
import {
  buildAuthorizationUrl,
  exchangeAuthCode,
  fetchAuthorizedShops,
  refreshAccessToken,
  tokenDataToRecord,
} from "./tiktok-auth.js";

function credentialsError() {
  return {
    content: [
      {
        type: "text" as const,
        text: "TikTok 凭据未配置：设置 TIKTOK_APP_KEY/SECRET、TIKTOK_APPS JSON，或 TIKTOK_APP_KEY_2 等多应用变量",
      },
    ],
    isError: true as const,
  };
}

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent:
      typeof data === "object" && data !== null
        ? (data as Record<string, unknown>)
        : { result: data },
  };
}

function fail(message: string, detail?: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text:
          detail !== undefined
            ? `${message}\n${JSON.stringify(detail, null, 2)}`
            : message,
      },
    ],
    isError: true as const,
  };
}

function isTokenSuccess(body: { code?: number; message?: string }): boolean {
  return body.code === 0 || body.code === undefined;
}

const appKeyField = z
  .string()
  .optional()
  .describe("Open API app_key；多应用时指定");
const appLabelField = z
  .string()
  .optional()
  .describe("应用别名 label");

function defaultRedirectUri(app?: TiktokAppProfile): string {
  const uri =
    app?.redirect_uri?.trim() || process.env.TIKTOK_REDIRECT_URI?.trim();
  if (!uri) {
    throw new Error(
      "缺少 TIKTOK_REDIRECT_URI（全局或该应用在 TIKTOK_APPS / TIKTOK_REDIRECT_URI_{后缀} 中配置）"
    );
  }
  return uri;
}

export function registerAuthTools(
  server: McpServer,
  registry: TiktokCredentialsRegistry | null
): void {
  server.registerTool(
    "tiktok_apps_list",
    {
      title: "TikTok — 列出已配置应用",
      description:
        "列出 mcp/.env 中配置的全部 app_key（default、TIKTOK_APPS、TIKTOK_APP_KEY_*）。",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async () => {
      if (!registry) return credentialsError();
      return ok({
        ok: true,
        default_label: registry.defaultLabel,
        apps: registry.listPublic(),
        redis_key_pattern: "tiktok:token:{app_key}:{shop_id}",
      });
    }
  );

  server.registerTool(
    "tiktok_auth_get_authorization_url",
    {
      title: "TikTok — 生成卖家授权链接",
      description:
        "生成卖家 OAuth 授权 URL。卖家打开并同意后，回调 URL 会带上 auth_code，再用 tiktok_auth_exchange_auth_code 换 token。",
      inputSchema: z.object({
        app_key: appKeyField,
        app_label: appLabelField,
        redirect_uri: z
          .string()
          .optional()
          .describe("回调地址，默认该应用或全局 TIKTOK_REDIRECT_URI"),
        state: z.string().optional().describe("防 CSRF，可选"),
        service_id: z
          .string()
          .optional()
          .describe("应用 service_id（TIKTOK_AUTH_URL_MODE=service_id 时用）"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!registry) return credentialsError();
      try {
        const app = registry.resolve({
          app_key: args.app_key,
          app_label: args.app_label,
        });
        const built = buildAuthorizationUrl(app, {
          redirect_uri: args.redirect_uri ?? defaultRedirectUri(app),
          state: args.state,
          service_id: args.service_id,
        });
        return ok({
          ok: true,
          app_key: app.app_key,
          app_label: app.label,
          authorization_url: built.url,
          mode: built.mode,
          hint: "授权完成后用相同 app_key 调用 tiktok_auth_exchange_auth_code",
        });
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "tiktok_auth_exchange_auth_code",
    {
      title: "TikTok — 用 auth_code 换取 token",
      description:
        "OAuth 回调中的 auth_code 换取 access_token / refresh_token。写入 Redis：tiktok:token:{app_key}:{shop_id}。",
      inputSchema: z.object({
        auth_code: z.string().min(1),
        app_key: appKeyField,
        app_label: appLabelField,
        save_to_redis: z.boolean().optional().default(true),
        shop_id: z
          .string()
          .optional()
          .describe("只保存指定店铺 id；省略则保存全部授权店铺"),
      }),
      annotations: { destructiveHint: false, readOnlyHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!registry) return credentialsError();
      try {
        const app = registry.resolve({
          app_key: args.app_key,
          app_label: args.app_label,
        });
        const tokenBody = await exchangeAuthCode(app, args.auth_code);
        if (!isTokenSuccess(tokenBody)) {
          return fail("换取 token 失败", tokenBody);
        }
        if (!tokenBody.data?.access_token) {
          return fail("响应中无 access_token", tokenBody);
        }

        const shops = await fetchAuthorizedShops(
          app,
          tokenBody.data.access_token
        );
        const targets = args.shop_id
          ? shops.filter((s) => s.id === args.shop_id)
          : shops;

        if (args.shop_id && targets.length === 0) {
          return fail(`未找到 shop_id=${args.shop_id}，已授权店铺见 shops`, {
            shops,
          });
        }

        const saved: Array<{
          shop_id: string;
          app_key: string;
          redis_key: string;
        }> = [];
        if (args.save_to_redis !== false) {
          const redis = getSharedRedis();
          const list = targets.length > 0 ? targets : [{ id: "default" }];
          for (const shop of list) {
            const shopId = shop.id ?? "default";
            const record = tokenDataToRecord(tokenBody, shop, app);
            const redisKey = await saveTiktokToken(
              redis,
              shopId,
              record,
              app.app_key
            );
            saved.push({
              shop_id: shopId,
              app_key: app.app_key,
              redis_key: redisKey,
            });
          }
        }

        return ok({
          ok: true,
          app_key: app.app_key,
          app_label: app.label,
          token: {
            open_id: tokenBody.data?.open_id,
            seller_name: tokenBody.data?.seller_name,
            access_token_expire_in: tokenBody.data?.access_token_expire_in,
            refresh_token_expire_in: tokenBody.data?.refresh_token_expire_in,
          },
          shops: targets.length ? targets : shops,
          saved_to_redis: saved,
        });
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "tiktok_auth_refresh_token",
    {
      title: "TikTok — 刷新 access_token",
      description:
        "用 refresh_token 刷新 access_token。可传 shop_id（从 Redis 读 refresh_token）或直接传 refresh_token。",
      inputSchema: z.object({
        shop_id: z.union([z.string(), z.number()]).optional(),
        app_key: appKeyField,
        app_label: appLabelField,
        refresh_token: z.string().optional(),
        save_to_redis: z.boolean().optional().default(true),
      }),
      annotations: { destructiveHint: false, readOnlyHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!registry) return credentialsError();
      try {
        let refresh = args.refresh_token?.trim();
        let existing: TiktokTokenRecord | null = null;

        if (!refresh && args.shop_id !== undefined) {
          const redis = getSharedRedis();
          refresh =
            (await getTiktokRefreshToken(
              redis,
              args.shop_id,
              args.app_key
            )) ?? undefined;
          if (!refresh) {
            existing = await getTiktokAccessToken(
              redis,
              args.shop_id,
              args.app_key
            );
            refresh = existing?.refresh_token;
          }
        }

        if (!refresh) {
          return fail("缺少 refresh_token，请传 refresh_token 或有效的 shop_id");
        }

        const app = registry.resolve({
          app_key: args.app_key ?? existing?.app_key,
          app_label: args.app_label ?? existing?.app_label,
        });
        const tokenBody = await refreshAccessToken(app, refresh);
        if (!isTokenSuccess(tokenBody)) {
          return fail("刷新 token 失败", tokenBody);
        }

        const record = tokenDataToRecord(
          tokenBody,
          {
            cipher: existing?.shop_cipher,
            id: args.shop_id ? String(args.shop_id) : undefined,
            name: existing?.shop_name,
            region: existing?.region,
            code: existing?.shop_code,
          },
          app
        );

        let savedKey: string | null = null;
        if (args.save_to_redis !== false && args.shop_id !== undefined) {
          savedKey = await saveTiktokToken(
            getSharedRedis(),
            args.shop_id,
            record,
            app.app_key
          );
        }

        return ok({
          ok: true,
          app_key: app.app_key,
          token: tokenBody.data,
          saved_to_redis: savedKey,
        });
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "tiktok_auth_get_authorized_shops",
    {
      title: "TikTok — 查询已授权店铺",
      description:
        "用 access_token 调用 authorization/202309/shops，获取 shop_id、cipher 等。token 可从 Redis 或 params 传入。",
      inputSchema: z.object({
        shop_id: z
          .union([z.string(), z.number()])
          .optional()
          .describe("从 Redis 读取 token 的店铺 ID"),
        app_key: appKeyField,
        app_label: appLabelField,
        access_token: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!registry) return credentialsError();
      try {
        let accessToken = args.access_token?.trim();
        let rec: TiktokTokenRecord | null = null;
        if (!accessToken && args.shop_id !== undefined) {
          rec = await getTiktokAccessToken(
            getSharedRedis(),
            args.shop_id,
            args.app_key
          );
          accessToken = rec?.access_token;
        }
        if (!accessToken) {
          return fail("缺少 access_token 或有效的 shop_id");
        }
        const app = registry.resolve({
          app_key: args.app_key ?? rec?.app_key,
          app_label: args.app_label ?? rec?.app_label,
        });
        const shops = await fetchAuthorizedShops(app, accessToken);
        return ok({ ok: true, shops });
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );

  server.registerTool(
    "tiktok_auth_save_token_to_redis",
    {
      title: "TikTok — 手动写入 Redis token",
      description:
        "将 token 写入 tiktok:token:{app_key}:{shop_id}（多应用时传 app_key）",
      inputSchema: z.object({
        shop_id: z.union([z.string(), z.number()]),
        app_key: appKeyField,
        app_label: appLabelField,
        access_token: z.string().min(1),
        refresh_token: z.string().optional(),
        shop_cipher: z.string().optional(),
        open_id: z.string().optional(),
      }),
      annotations: { destructiveHint: false, readOnlyHint: false },
      _meta: TIKTOK_ALWAYS_LOAD_META,
    },
    async (args) => {
      if (!registry) return credentialsError();
      try {
        const app = registry.resolve({
          app_key: args.app_key,
          app_label: args.app_label,
        });
        const record: TiktokTokenRecord = {
          access_token: args.access_token.trim(),
          refresh_token: args.refresh_token?.trim(),
          shop_cipher: args.shop_cipher?.trim(),
          open_id: args.open_id?.trim(),
          app_key: app.app_key,
          app_label: app.label,
          updated_at: new Date().toISOString(),
        };
        const redisKey = await saveTiktokToken(
          getSharedRedis(),
          args.shop_id,
          record,
          app.app_key
        );
        return ok({
          ok: true,
          app_key: app.app_key,
          redis_key: redisKey,
        });
      } catch (err: unknown) {
        return fail(err instanceof Error ? err.message : String(err));
      }
    }
  );
}
