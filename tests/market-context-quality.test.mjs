import assert from "node:assert/strict";
import test from "node:test";
import { buildPeerSummary, parseCsrcPolicies, parseNewsJsonp, parseNewsRows, parseValuationRows, summarizeDistribution, verifyNewsRows, weightedHarmonic } from "../lib/providers/market-context.ts";

test("parses JSONP news and rejects rows without an exact asset mention", () => {
  const payload = parseNewsJsonp(`callback({"code":0,"result":{"cmsArticleWebOld":[
    {"date":"2026-08-07 10:00:00","title":"贵州茅台发布经营数据","content":"公司信息","mediaName":"样本媒体","url":"https://example.com/a"},
    {"date":"2026-08-07 09:00:00","title":"白酒行业观察","content":"正文提及贵州茅台","mediaName":"样本媒体","url":"https://example.com/b"},
    {"date":"2026-08-07 08:00:00","title":"完全无关","content":"没有目标名称","mediaName":"样本媒体","url":"https://example.com/c"}
  ]}})`);
  const rows = parseNewsRows(payload, "贵州茅台", "600519.SH");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].relevance, "标题直接命中");
  assert.equal(rows[1].relevance, "正文提及");
});

test("parses official CSRC policy rows and marks fund-specific relevance", () => {
  const html = `<ul id="list" class="list mt10">
    <li><a href="/csrc/a/content.shtml">公开募集证券投资基金销售费用管理规定</a><span class="date">2026-01-01</span></li>
    <li><a href="/csrc/b/content.shtml">上市公司董事会秘书监管规则</a><span class="date">2026-02-01</span></li>
  </ul>`;
  const fundRows = parseCsrcPolicies(html, "fund");
  assert.equal(fundRows.length, 2);
  assert.equal(fundRows[0].scope, "基金行业");
  assert.equal(fundRows[0].relevance, "直接相关");
  assert.match(fundRows[0].url, /^https:\/\/www\.csrc\.gov\.cn\//);
});

test("uses explicit valuation columns, removes duplicate dates, and rejects non-positive multiples", () => {
  const rows = parseValuationRows([
    { SECUCODE: "600519.SH", SECURITY_NAME_ABBR: "贵州茅台", BOARD_CODE: "016165", BOARD_NAME: "白酒Ⅱ", CLOSE_PRICE: 1309.22, PE_TTM: 19.786, PB_MRQ: 6.0416, PS_TTM: 9.335, TRADE_DATE: "2026-08-07" },
    { SECUCODE: "600519.SH", SECURITY_NAME_ABBR: "重复行", BOARD_CODE: "016165", PE_TTM: 99, PB_MRQ: 99, TRADE_DATE: "2026-08-07" },
    { SECUCODE: "600519.SH", SECURITY_NAME_ABBR: "贵州茅台", BOARD_CODE: "016165", PE_TTM: -3, PB_MRQ: 0, TRADE_DATE: "2026-08-06" },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].peTtm, 19.786);
  assert.equal(rows[0].pbMrq, 6.0416);
  assert.equal(rows[1].peTtm, null);
  assert.equal(rows[1].pbMrq, null);
});

test("calculates transparent historical quantiles and percentile rank", () => {
  const summary = summarizeDistribution(4, [1, 2, 3, 4, 0, -1, null]);
  assert.equal(summary?.validCount, 4);
  assert.equal(summary?.percentile, 100);
  assert.equal(summary?.p25, 1.75);
  assert.equal(summary?.median, 2.5);
  assert.equal(summary?.p75, 3.25);
});

test("builds a same-date same-board peer set and excludes negative PE from the rank", () => {
  const target = { symbol: "600519.SH", name: "贵州茅台", boardCode: "016165", boardName: "白酒Ⅱ", marketCap: 100, floatMarketCap: 100, closePrice: 10, peTtm: 20, pbMrq: 6, psTtm: 9, tradeDate: "2026-08-07" };
  const peers = buildPeerSummary(target, [
    target,
    { ...target, symbol: "000858.SZ", name: "五粮液", marketCap: 80, peTtm: 24, pbMrq: 3 },
    { ...target, symbol: "600809.SH", name: "山西汾酒", marketCap: 60, peTtm: 14, pbMrq: 4 },
    { ...target, symbol: "600702.SH", name: "亏损样本", marketCap: 40, peTtm: null, pbMrq: 2 },
    { ...target, symbol: "000001.SZ", name: "错板块", boardCode: "OTHER", peTtm: 1 },
  ]);
  assert.equal(peers?.totalCount, 4);
  assert.equal(peers?.positivePeCount, 3);
  assert.equal(peers?.peMedian, 20);
  assert.equal(peers?.pePercentile, 66.67);
});

test("uses weighted harmonic valuation and reports only valid coverage", () => {
  const result = weightedHarmonic([{ weight: 6, value: 12 }, { weight: 4, value: 20 }, { weight: 5, value: null }, { weight: 3, value: -2 }]);
  assert.equal(result.coverage, 10);
  assert.ok(Math.abs(result.value - 14.2857142857) < 1e-8);
});

test("labels announcement topic support without claiming every news fact is verified", () => {
  const candidates = parseNewsRows({ code: 0, result: { cmsArticleWebOld: [
    { date: "2026-08-07 10:00:00", title: "贵州茅台分红安排受到关注", content: "市场讨论分红时间", mediaName: "媒体甲", url: "https://example.com/news" },
  ] } }, "贵州茅台", "600519.SH");
  const verified = verifyNewsRows(candidates, "贵州茅台", [{ title: "贵州茅台关于分红的公告", date: "2026-08-06", category: "公司公告", mirrorUrl: "https://example.com/notice.pdf" }]);
  assert.equal(verified[0].verification, "公告主题支持");
  assert.match(verified[0].verificationDetail, /不代表新闻中的全部数字/);
  assert.equal(verified[0].supportUrl, "https://example.com/notice.pdf");
});

test("labels similar reports from distinct media as corroborating clues, not official confirmation", () => {
  const candidates = parseNewsRows({ code: 0, result: { cmsArticleWebOld: [
    { date: "2026-08-07 10:00:00", title: "贵州茅台渠道价格出现调整", content: "公司渠道价格出现调整并引发市场关注", mediaName: "媒体甲", url: "https://example.com/a" },
    { date: "2026-08-06 10:00:00", title: "贵州茅台渠道价格调整引关注", content: "渠道价格出现调整引发市场关注", mediaName: "媒体乙", url: "https://example.com/b" },
  ] } }, "贵州茅台", "600519.SH");
  const verified = verifyNewsRows(candidates, "贵州茅台");
  assert.equal(verified[0].verification, "多家媒体相似报道");
  assert.match(verified[0].verificationDetail, /不能替代公司公告/);
  assert.equal(verified[0].sourceCount, 2);
});
