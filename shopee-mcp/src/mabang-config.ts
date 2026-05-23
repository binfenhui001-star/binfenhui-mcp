export const MABANG_DEFAULT_API_BASE = "https://gwapi.mabangerp.com/api/v2";

export interface MabangCredentials {
  appkey: string;
  secret: string;
  apiBase: string;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

export function loadMabangCredentialsFromEnv(): MabangCredentials {
  const apiBase =
    process.env.MABANG_API_BASE?.trim() || MABANG_DEFAULT_API_BASE;
  return {
    appkey: requireEnv("MABANG_APPKEY"),
    secret: requireEnv("MABANG_SECRET"),
    apiBase: apiBase.replace(/\/$/, ""),
  };
}

export function loadMabangCredentialsFromEnvOptional(): MabangCredentials | null {
  try {
    return loadMabangCredentialsFromEnv();
  } catch {
    return null;
  }
}
