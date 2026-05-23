export type TiktokCredentials = {
  app_key: string;
  app_secret: string;
  sandbox: boolean;
};

export type TiktokAppProfile = TiktokCredentials & {
  /** 配置别名，如 main / us / brand-a */
  label: string;
  redirect_uri?: string;
  service_id?: string;
};

export type TiktokCredentialsRegistry = {
  defaultLabel: string;
  apps: TiktokAppProfile[];
  resolve(input?: {
    app_key?: string;
    app_label?: string;
    label?: string;
  }): TiktokAppProfile;
  listPublic(): Array<{
    label: string;
    app_key: string;
    sandbox: boolean;
    redirect_uri?: string;
    is_default: boolean;
  }>;
  hasApps: boolean;
};

function sandboxFromEnv(): boolean {
  const env = process.env.TIKTOK_ENVIRONMENT?.trim().toLowerCase();
  return env === "sandbox" || env === "test";
}

function parseAppsJson(raw: string): TiktokAppProfile[] {
  const parsed = JSON.parse(raw) as unknown;
  const entries: Array<Record<string, unknown>> = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null
      ? Object.entries(parsed as Record<string, unknown>).map(([label, v]) => ({
          label,
          ...(typeof v === "object" && v !== null
            ? (v as Record<string, unknown>)
            : {}),
        }))
      : [];

  const apps: TiktokAppProfile[] = [];
  for (const item of entries) {
    const appKey = String(item.app_key ?? item.appKey ?? "").trim();
    const appSecret = String(item.app_secret ?? item.appSecret ?? "").trim();
    if (!appKey || !appSecret) continue;
    const label = String(item.label ?? item.name ?? appKey).trim() || appKey;
    apps.push({
      label,
      app_key: appKey,
      app_secret: appSecret,
      sandbox:
        item.sandbox === true ||
        String(item.environment ?? "").toLowerCase() === "sandbox" ||
        sandboxFromEnv(),
      redirect_uri: String(item.redirect_uri ?? item.redirectUri ?? "").trim() || undefined,
      service_id: String(item.service_id ?? item.serviceId ?? "").trim() || undefined,
    });
  }
  return apps;
}

function loadSuffixApps(): TiktokAppProfile[] {
  const apps: TiktokAppProfile[] = [];
  const defaultKey = process.env.TIKTOK_APP_KEY?.trim();
  const re = /^TIKTOK_APP_(?:KEY|SECRET)_(.+)$/;

  const suffixes = new Set<string>();
  for (const key of Object.keys(process.env)) {
    const m = key.match(re);
    if (m) suffixes.add(m[1]!);
  }

  for (const suffix of suffixes) {
    const appKey = process.env[`TIKTOK_APP_KEY_${suffix}`]?.trim();
    const appSecret = process.env[`TIKTOK_APP_SECRET_${suffix}`]?.trim();
    if (!appKey || !appSecret) continue;
    if (defaultKey && appKey === defaultKey) continue;

    const label =
      process.env[`TIKTOK_APP_LABEL_${suffix}`]?.trim() ||
      suffix.toLowerCase();
    const redirect =
      process.env[`TIKTOK_REDIRECT_URI_${suffix}`]?.trim() ||
      process.env[`TIKTOK_APP_REDIRECT_URI_${suffix}`]?.trim();

    apps.push({
      label,
      app_key: appKey,
      app_secret: appSecret,
      sandbox: sandboxFromEnv(),
      redirect_uri: redirect || undefined,
      service_id: process.env[`TIKTOK_SERVICE_ID_${suffix}`]?.trim() || undefined,
    });
  }
  return apps;
}

function loadDefaultApp(): TiktokAppProfile | null {
  const appKey = process.env.TIKTOK_APP_KEY?.trim();
  const appSecret = process.env.TIKTOK_APP_SECRET?.trim();
  if (!appKey || !appSecret) return null;
  return {
    label: process.env.TIKTOK_APP_LABEL?.trim() || "default",
    app_key: appKey,
    app_secret: appSecret,
    sandbox: sandboxFromEnv(),
    redirect_uri: process.env.TIKTOK_REDIRECT_URI?.trim() || undefined,
    service_id: process.env.TIKTOK_SERVICE_ID?.trim() || undefined,
  };
}

function dedupeByAppKey(apps: TiktokAppProfile[]): TiktokAppProfile[] {
  const seen = new Map<string, TiktokAppProfile>();
  for (const app of apps) {
    seen.set(app.app_key, app);
  }
  return [...seen.values()];
}

export function loadTiktokCredentialsRegistry(): TiktokCredentialsRegistry | null {
  const collected: TiktokAppProfile[] = [];

  const defaultApp = loadDefaultApp();
  if (defaultApp) collected.push(defaultApp);

  const jsonRaw = process.env.TIKTOK_APPS?.trim();
  if (jsonRaw) {
    try {
      collected.push(...parseAppsJson(jsonRaw));
    } catch (err: unknown) {
      throw new Error(
        `TIKTOK_APPS JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  collected.push(...loadSuffixApps());

  const apps = dedupeByAppKey(collected);
  if (apps.length === 0) return null;

  const defaultLabel =
    process.env.TIKTOK_DEFAULT_APP_LABEL?.trim() ||
    defaultApp?.label ||
    apps[0]!.label;

  function resolve(input?: {
    app_key?: string;
    app_label?: string;
    label?: string;
  }): TiktokAppProfile {
    const key = input?.app_key?.trim();
    if (key) {
      const hit = apps.find((a) => a.app_key === key);
      if (!hit) {
        throw new Error(
          `未知 app_key: ${key}。已配置: ${apps.map((a) => a.app_key).join(", ")}`
        );
      }
      return hit;
    }

    const label = (input?.app_label ?? input?.label)?.trim();
    if (label) {
      const hit = apps.find(
        (a) => a.label === label || a.label.toLowerCase() === label.toLowerCase()
      );
      if (!hit) {
        throw new Error(
          `未知 app_label: ${label}。已配置: ${apps.map((a) => a.label).join(", ")}`
        );
      }
      return hit;
    }

    if (apps.length === 1) return apps[0]!;

    const def = apps.find((a) => a.label === defaultLabel);
    if (def) return def;

    throw new Error(
      `已配置 ${apps.length} 个 TikTok 应用，请指定 app_key 或 app_label（${apps.map((a) => `${a.label}=${a.app_key}`).join("; ")}）`
    );
  }

  return {
    defaultLabel,
    apps,
    resolve,
    hasApps: true,
    listPublic() {
      return apps.map((a) => ({
        label: a.label,
        app_key: a.app_key,
        sandbox: a.sandbox,
        redirect_uri: a.redirect_uri,
        is_default: a.label === defaultLabel,
      }));
    },
  };
}

/** @deprecated 使用 registry.resolve() */
export function loadTiktokCredentialsFromEnv(): TiktokCredentials {
  const registry = loadTiktokCredentialsRegistry();
  if (!registry) {
    throw new Error("缺少 TikTok 凭据：设置 TIKTOK_APP_KEY/SECRET 或 TIKTOK_APPS");
  }
  return registry.resolve();
}

export function loadTiktokCredentialsFromEnvOptional(): TiktokCredentials | null {
  try {
    return loadTiktokCredentialsFromEnv();
  } catch {
    return null;
  }
}

export function loadTiktokCredentialsRegistryOptional(): TiktokCredentialsRegistry | null {
  try {
    return loadTiktokCredentialsRegistry();
  } catch {
    return null;
  }
}
