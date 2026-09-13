import assert from "node:assert/strict";
import test from "node:test";
import { applyCandidateLimits, buildAllocationPlan, buildRiskReferences, mergeResearchPool, scoreCandidate } from "../lib/report-engine.ts";

const completeStock = {
  assetType: "stock",
  sampleSize: 120,
  trend: "up",
  return5: 4,
  return20: 10,
  return60: 18,
  maxDrawdown60: -8,
  volatility20Annualized: 30,
  rangePosition20: 60,
  latestValue: 100,
  low20: 92,
  atr14: 2,
  fundamentalAvailable: true,
  valuationAvailable: true,
  historicalValuationPercentile: 35,
  peerValuationPercentile: 60,
  valuationCoveragePercent: null,
  riskEventCount: 0,
  officialRiskEventCount: 0,
  routineRiskPct: 7,
  maxDrawdownPct: 15,
};

test("a complete strong stock can enter only the simulated candidate list", () => {
  const result = scoreCandidate(completeStock);
  assert.equal(result.score, 100);
  assert.equal(result.decision, "进入模拟候选");
  assert.equal(result.eligible, true);
  assert.deepEqual(result.hardBlocks, []);
});

test("an official-topic risk event blocks eligibility even with a high numeric score", () => {
  const result = scoreCandidate({ ...completeStock, riskEventCount: 1, officialRiskEventCount: 1 });
  assert.equal(result.decision, "暂不纳入");
  assert.equal(result.eligible, false);
  assert.match(result.hardBlocks.join(" "), /风险事件/);
});

test("missing evidence is a hard data gap instead of a low-confidence recommendation", () => {
  const result = scoreCandidate({ ...completeStock, sampleSize: 20, fundamentalAvailable: false, valuationAvailable: false });
  assert.equal(result.decision, "数据不足");
  assert.equal(result.eligible, false);
  assert.equal(result.hardBlocks.length, 3);
});

test("a complete fund uses the medium-term model instead of the stock short-term gate", () => {
  const result = scoreCandidate({ ...completeStock, assetType: "fund", valuationCoveragePercent: 45 });
  assert.equal(result.decision, "进入基金中期候选");
  assert.equal(result.eligible, true);
  assert.deepEqual(result.hardBlocks, []);
});

test("personal maximum drawdown is a hard gate for both stock and fund candidates", () => {
  for (const assetType of ["stock", "fund"]) {
    const result = scoreCandidate({ ...completeStock, assetType, maxDrawdown60: -15.01, valuationCoveragePercent: 45 });
    assert.equal(result.eligible, false);
    assert.match(result.hardBlocks.join(" "), /风险画像15%上限/);
  }
});

test("candidate limits keep at most three stocks or ETFs and two funds", () => {
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => ({ symbol: `60000${index}.SH`, assetType: "stock", score: 90 - index, eligible: true, decision: "进入模拟候选", observationZone: {}, invalidationReference: {} })),
    ...Array.from({ length: 3 }, (_, index) => ({ symbol: `00000${index}`, assetType: "fund", score: 88 - index, eligible: true, decision: "进入基金中期候选", observationZone: null, invalidationReference: null })),
  ];
  const limited = applyCandidateLimits(rows);
  assert.equal(limited.filter((row) => row.eligible && row.assetType !== "fund").length, 3);
  assert.equal(limited.filter((row) => row.eligible && row.assetType === "fund").length, 2);
  assert.equal(limited.filter((row) => row.decision === "达到候选上限，继续观察").length, 2);
});

test("risk reference stays within the configured routine loss line", () => {
  const reference = buildRiskReferences(completeStock, true);
  assert.ok(reference.observationZone);
  assert.ok(reference.invalidationReference);
  assert.ok(reference.invalidationReference.distancePercent <= 7);
  assert.ok(reference.invalidationReference.price < completeStock.latestValue);
  assert.equal(buildRiskReferences(completeStock, false).observationZone, null);
});

test("research pool keeps private watchlist and adds a balanced deduplicated market shortlist", () => {
  const watchlist = [{ symbol: "600001.SH", assetType: "stock", note: "我的标的" }];
  const universe = {
    items: [
      { symbol: "600001.SH", assetType: "stock", origin: "market-universe", note: "重复" },
      { symbol: "600002.SH", assetType: "stock", origin: "market-universe", note: "市场股票" },
      { symbol: "000001", assetType: "fund", origin: "market-universe", note: "市场基金" },
    ],
  };
  const merged = mergeResearchPool(watchlist, universe);
  assert.equal(merged.watchlistItems.length, 1);
  assert.equal(merged.marketItems.length, 2);
  assert.equal(merged.scoped.length, 3);
  assert.equal(merged.scoped[0].origin, "watchlist");
  assert.deepEqual(new Set(merged.marketItems.map((item) => item.assetType)), new Set(["stock", "fund"]));
});

test("deterministic allocation always totals 100 and keeps A shares simulated", () => {
  assert.deepEqual(buildAllocationPlan(0, 0), { cashPct: 100, fundPct: 0, stockSimulationPct: 0, basis: "没有标的通过硬门槛，研究组合保持100%现金观察。" });
  for (const [stocks, funds] of [[0, 1], [1, 0], [1, 1]]) {
    const plan = buildAllocationPlan(stocks, funds);
    assert.equal(plan.cashPct + plan.fundPct + plan.stockSimulationPct, 100);
    assert.ok(plan.stockSimulationPct <= 10);
  }
});
