import { createDecipheriv, createHash } from "node:crypto";

/** 飞书/内部同步写入 Redis 的 ROW_ 密文（非 TikTok 明文 token） */
export function isRowCipher(value: string): boolean {
  return value.startsWith("ROW_");
}

function b64urlDecode(s: string): Buffer {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  return Buffer.from(t, "base64");
}

/**
 * 尝试用解密密钥还原明文 token。
 * 密钥默认来自 Redis `tiktok:bfh` 或环境变量 TIKTOK_ROW_DECRYPT_KEY。
 */
export function tryDecryptRowCipher(
  rowValue: string,
  decryptKeyHex: string
): string | null {
  if (!isRowCipher(rowValue) || !decryptKeyHex?.trim()) return null;

  const buf = b64urlDecode(rowValue.slice(4));
  const keys: Buffer[] = [
    createHash("sha256").update(decryptKeyHex.trim()).digest(),
    createHash("sha256").update(Buffer.from(decryptKeyHex.trim(), "hex")).digest(),
    Buffer.from(decryptKeyHex.trim(), "hex"),
  ];

  for (const key of keys) {
    const aesKey = key.length === 32 ? key : createHash("sha256").update(key).digest();
    if (buf.length < 32) continue;
    const iv = buf.subarray(0, 16);
    const ct = buf.subarray(16);
    try {
      const d = createDecipheriv("aes-256-cbc", aesKey, iv);
      const pt = Buffer.concat([d.update(ct), d.final()]);
      const text = pt.toString("utf8").replace(/\0+$/, "").trim();
      if (
        text.startsWith("TTP") ||
        text.startsWith("{") ||
        /^[A-Za-z0-9_-]{32,}$/.test(text)
      ) {
        return text;
      }
    } catch {
      /* next */
    }
  }
  return null;
}
