import { describe, expect, it } from "bun:test";
import {
  addDaysToDateString,
  listLookbackDates,
  stockSkuMatchesPrefix,
} from "./mabang-stock-search.js";

describe("mabang-stock-search", () => {
  it("matches prefix case-insensitively", () => {
    expect(stockSkuMatchesPrefix("SWI116-1-M", "swi116")).toBe(true);
    expect(stockSkuMatchesPrefix("DY-SWI001-L", "swi116")).toBe(false);
    expect(stockSkuMatchesPrefix("SWI116-1-M", "")).toBe(false);
  });

  it("lists lookback dates ending on update day", () => {
    expect(listLookbackDates("2026-05-19", 1)).toEqual(["2026-05-19"]);
    expect(listLookbackDates("2026-05-19", 3)).toEqual([
      "2026-05-19",
      "2026-05-18",
      "2026-05-17",
    ]);
  });

  it("addDaysToDateString shifts calendar days", () => {
    expect(addDaysToDateString("2026-05-19", -1)).toBe("2026-05-18");
  });
});
