import assert from "node:assert/strict";
import test from "node:test";
import { calculateMarketMetrics } from "../lib/analysis/market-metrics.ts";

function tradingPoints(count) {
  return Array.from({ length: count }, (_, index) => {
    const value = 100 + index;
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    return { date, value, open: value - 1, high: value + 2, low: value - 2 };
  });
}

test("calculates deterministic trend, return, range and ATR metrics", () => {
  const metrics = calculateMarketMetrics(tradingPoints(61));
  assert.equal(metrics.sampleSize, 61);
  assert.equal(metrics.return5, 3.23);
  assert.equal(metrics.return20, 14.29);
  assert.equal(metrics.return60, 60);
  assert.equal(metrics.trend, "up");
  assert.equal(metrics.rangePosition20, 100);
  assert.equal(metrics.maxDrawdown60, 0);
  assert.equal(metrics.atr14, 4);
});
test("maximum drawdown measures decline from a prior peak", () => {
  const metrics = calculateMarketMetrics([
    { date: "2026-01-01", value: 100 },
    { date: "2026-01-02", value: 120 },
    { date: "2026-01-03", value: 90 },
    { date: "2026-01-04", value: 96 },
  ]);
  assert.equal(metrics.maxDrawdown60, -25);
  assert.equal(metrics.trend, "insufficient");
  assert.equal(metrics.return5, null);
});

test("rejects empty or invalid history instead of inventing metrics", () => {
  assert.throws(() => calculateMarketMetrics([{ date: "bad", value: 0 }]), /EMPTY_HISTORY/);
});
