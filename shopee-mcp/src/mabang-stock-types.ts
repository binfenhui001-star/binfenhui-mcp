export type MabangWarehouseStock = {
  warehouseId?: number;
  warehouseName?: string;
  stockQuantity?: number;
  availableStockQuantity?: number;
  waitingQuantity?: number;
  shippingQuantity?: number;
  processingQuantity?: number;
  [key: string]: unknown;
};

export type MabangStockRow = {
  stockSku: string;
  stockQuantity: number;
  warehouse?: MabangWarehouseStock[];
};

export type MabangStockQuantityPageData = {
  data?: MabangStockRow[];
  page?: number;
  count?: number;
};

export function isMabangApiSuccess(code: unknown): boolean {
  return code === 200 || code === "200";
}

export function parseStockQuantityPage(
  response: { code?: unknown; message?: string; data?: unknown }
): MabangStockQuantityPageData {
  if (!isMabangApiSuccess(response.code)) {
    throw new Error(
      `马帮 API 业务失败: code=${String(response.code)} message=${response.message ?? ""}`
    );
  }
  const data = response.data;
  if (!data || typeof data !== "object") {
    return { data: [], page: 0, count: 0 };
  }
  return data as MabangStockQuantityPageData;
}

export function summarizeWarehouses(
  warehouses: MabangWarehouseStock[] | undefined
): Array<{
  warehouse_name: string;
  stock_quantity: number;
  available_stock_quantity: number | null;
}> {
  if (!warehouses?.length) return [];
  return warehouses
    .filter((w) => (w.stockQuantity ?? 0) !== 0 || (w.availableStockQuantity ?? 0) !== 0)
    .map((w) => ({
      warehouse_name: w.warehouseName ?? "unknown",
      stock_quantity: w.stockQuantity ?? 0,
      available_stock_quantity:
        w.availableStockQuantity !== undefined ? w.availableStockQuantity : null,
    }));
}
