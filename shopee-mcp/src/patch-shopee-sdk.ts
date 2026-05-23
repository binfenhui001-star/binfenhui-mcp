import { ShopeeFetch } from "../node_modules/@congminh1254/shopee-sdk/lib/fetch.js";

import { FixedShopeeFetch } from "./shopee-fetch.js";

let patched = false;

/** Patch SDK fetch once: correct POST sign + shop_id from config. */
export function patchShopeeSdkFetch(): void {
  if (patched) return;
  patched = true;

  ShopeeFetch.fetch = FixedShopeeFetch.fetch as typeof ShopeeFetch.fetch;
}
