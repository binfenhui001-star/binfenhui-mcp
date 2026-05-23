/** 全店商品快照（与 shopee:items:{shop_id} 对齐） */
export const productsKey = (appKey: string, shopId: string | number) =>
  `tiktok:products:${appKey}:${shopId}`;
