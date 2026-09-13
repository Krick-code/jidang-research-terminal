import { isShanghaiWeekend } from "@/lib/schedule";

// 上交所《关于上海证券交易所2026年部分节假日休市安排的通知》：上证公告〔2025〕45号。
const SSE_2026_CLOSED_RANGES: Array<[string, string]> = [
  ["2026-01-01", "2026-01-03"],
  ["2026-02-15", "2026-02-23"],
  ["2026-04-04", "2026-04-06"],
  ["2026-05-01", "2026-05-05"],
  ["2026-06-19", "2026-06-21"],
  ["2026-09-25", "2026-09-27"],
  ["2026-10-01", "2026-10-07"],
];

function isInClosedRange(date: string) {
  return SSE_2026_CLOSED_RANGES.some(([start, end]) => date >= start && date <= end);
}
export function resolveAshareTradingDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_TRADING_DATE");
  if (isShanghaiWeekend(date)) {
    return { open: false, source: "上交所交易规则（周末休市）", confidence: "confirmed" as const };
  }
  if (date.startsWith("2026-")) {
    return {
      open: !isInClosedRange(date),
      source: "上交所2026年休市安排（上证公告〔2025〕45号）",
      confidence: "confirmed" as const,
    };
  }
  return { open: true, source: "工作日推断（该年度官方休市表尚未内置）", confidence: "partial" as const };
}
