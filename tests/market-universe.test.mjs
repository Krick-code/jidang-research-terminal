import assert from "node:assert/strict";
import test from "node:test";
import { parseFundDirectory, parseFundRankPage, selectFundUniverse, selectStockUniverse } from "../lib/providers/market-universe.ts";

test("stock universe screening respects liquidity, risk and small-capital constraints", () => {
  const rows = [
    { f2: 6.8, f3: 1.2, f6: 2_000_000_000, f8: 2.5, f9: 22, f12: "600001", f14: "合规股份", f20: 30_000_000_000 },
    { f2: 18, f3: 1, f6: 3_000_000_000, f8: 2, f9: 20, f12: "600002", f14: "超资金股份", f20: 30_000_000_000 },
    { f2: 5, f3: 0, f6: 1_000_000_000, f8: 2, f9: -5, f12: "000003", f14: "亏损股份", f20: 30_000_000_000 },
    { f2: 4, f3: 0, f6: 1_000_000_000, f8: 2, f9: 15, f12: "000004", f14: "ST风险", f20: 30_000_000_000 },
  ];
  const selected = selectStockUniverse(rows, 6);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].symbol, "600001.SH");
  assert.match(selected[0].note, /最低交易金额约680元/);
});

test("fund directory and rank pages are parsed from their JavaScript wrappers", () => {
  const directory = parseFundDirectory('\uFEFFvar r = [["000001","PY","示例混合A","混合型-偏股","PINYIN"],["000002","PY","示例债券A","债券型-长债","PINYIN"]];');
  const page = parseFundRankPage('var rankData = {datas:["000001,示例混合A,PY,2026-08-07,1.2,1.2,0.1,1,2,8,15,25,,,,,2020-01-01"],allRecords:1,pageIndex:1};');
  assert.equal(directory.length, 2);
  assert.equal(page.allRecords, 1);
  assert.deepEqual(page.rows[0], { code: "000001", name: "示例混合A", date: "2026-08-07", return3m: 8, return6m: 15, return1y: 25 });
});

test("fund screening removes unsuitable types, overheated funds and duplicate share classes", () => {
  const directory = [
    { code: "000001", name: "稳健成长A", type: "混合型-偏股" },
    { code: "000002", name: "稳健成长C", type: "混合型-偏股" },
    { code: "000003", name: "债券样本A", type: "债券型-长债" },
    { code: "000004", name: "过热成长A", type: "股票型" },
  ];
  const rankRows = [
    { code: "000001", name: "稳健成长A", date: "2026-08-07", return3m: 8, return6m: 15, return1y: 25 },
    { code: "000002", name: "稳健成长C", date: "2026-08-07", return3m: 9, return6m: 16, return1y: 26 },
    { code: "000003", name: "债券样本A", date: "2026-08-07", return3m: 4, return6m: 8, return1y: 10 },
    { code: "000004", name: "过热成长A", date: "2026-08-07", return3m: 40, return6m: 80, return1y: 120 },
  ];
  const selected = selectFundUniverse(rankRows, directory, 4);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].symbol, "000001");
  assert.match(selected[0].note, /近3月8%/);
});
