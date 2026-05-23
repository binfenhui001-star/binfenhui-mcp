import type { MabangCredentials } from "./mabang-config.js";
import { getStockQuantity } from "./mabang-client.js";
import {
  parseStockQuantityPage,
  summarizeWarehouses,
  type MabangStockRow,
} from "./mabang-stock-types.js";

export type SearchStockByPrefixOptions = {
  /** Case-insensitive substring match on stockSku */
  skuPrefix: string;
  /** YYYY-MM-DD; defaults to local today */
  updateTime?: string;
  /** Also scan previous N-1 calendar days (default 1 = only updateTime day) */
  lookbackDays?: number;
  /** Stop after this many pages per day (default 50) */
  maxPagesPerDay?: number;
  warehouseName?: string;
};

export type StockPrefixMatch = {
  stock_sku: string;
  stock_quantity: number;
  warehouses: ReturnType<typeof summarizeWarehouses>;
};

export type SearchStockByPrefixResult = {
  ok: true;
  api: "stock-get-stock-quantity";
  sku_prefix: string;
  update_times_searched: string[];
  pages_fetched: number;
  rows_scanned: number;
  match_count: number;
  matches: StockPrefixMatch[];
};

export function localTodayDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDaysToDateString(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return localTodayDateString(dt);
}

export function listLookbackDates(
  endDate: string,
  lookbackDays: number
): string[] {
  const days = Math.max(1, Math.floor(lookbackDays));
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    out.push(addDaysToDateString(endDate, -i));
  }
  return out;
}

export function stockSkuMatchesPrefix(
  stockSku: string,
  prefix: string
): boolean {
  const p = prefix.trim().toLowerCase();
  if (!p) return false;
  return stockSku.toLowerCase().includes(p);
}

export function toPrefixMatch(row: MabangStockRow): StockPrefixMatch {
  return {
    stock_sku: row.stockSku,
    stock_quantity: row.stockQuantity,
    warehouses: summarizeWarehouses(row.warehouse),
  };
}

export async function searchStockByPrefix(
  credentials: MabangCredentials,
  options: SearchStockByPrefixOptions
): Promise<SearchStockByPrefixResult> {
  const prefix = options.skuPrefix.trim();
  if (!prefix) {
    throw new Error("sku_prefix 不能为空");
  }

  const endDate = options.updateTime?.trim() || localTodayDateString();
  const lookbackDays = options.lookbackDays ?? 1;
  const maxPagesPerDay = options.maxPagesPerDay ?? 50;
  const dates = listLookbackDates(endDate, lookbackDays);

  const seen = new Set<string>();
  const matches: StockPrefixMatch[] = [];
  let pagesFetched = 0;
  let rowsScanned = 0;

  for (const updateTime of dates) {
    for (let page = 1; page <= maxPagesPerDay; page++) {
      const response = await getStockQuantity(credentials, {
        updateTime,
        page,
        warehouseName: options.warehouseName,
      });
      const pageData = parseStockQuantityPage(response);
      const rows = pageData.data ?? [];
      pagesFetched += 1;
      rowsScanned += rows.length;

      for (const row of rows) {
        const sku = row.stockSku?.trim();
        if (!sku || !stockSkuMatchesPrefix(sku, prefix)) continue;
        if (seen.has(sku.toLowerCase())) continue;
        seen.add(sku.toLowerCase());
        matches.push(toPrefixMatch(row));
      }

      if (rows.length === 0) {
        break;
      }
    }
  }

  matches.sort((a, b) => a.stock_sku.localeCompare(b.stock_sku));

  return {
    ok: true,
    api: "stock-get-stock-quantity",
    sku_prefix: prefix,
    update_times_searched: dates,
    pages_fetched: pagesFetched,
    rows_scanned: rowsScanned,
    match_count: matches.length,
    matches,
  };
}
