import { calculateMarketMetrics, type MarketMetrics } from "./analysis/market-metrics.ts";
import type { DeepSeekEvidence } from "./ai/deepseek.ts";
import { getFundamentals, type FundamentalResult } from "./providers/fundamentals.ts";
import { getMarketContext, type MarketContextResult } from "./providers/market-context.ts";
import { getMarketHistory, type HistoryResult } from "./providers/market-history.ts";
import { searchPublicMarket, type PublicMarketAsset } from "./providers/public-market.ts";

export type ReportWatchItem = {
  symbol: string;
  assetType: "stock" | "fund" | "etf";
  note?: string;
  origin?: "watchlist" | "market-universe";
};

export type ReportUniverseInput = {
  items: ReportWatchItem[];
  source: string;
  asOf: string;
  stockUniverseTotal: number;
  stockRowsEvaluated: number;
  fundUniverseTotal: number;
  fundRowsEvaluated: number;
  checks: string[];
  warnings: string[];
};

export type ReportRiskProfile = {
  version: number;
  capitalBand: string;
  monthlyContribution: number;
  stockHorizon: string;
  fundHorizon: string;
  routineRiskPct: number;
  absoluteRiskPct: number;
  maxDrawdownPct: number;
  excludedScope: string;
};

export type CandidateSignals = {
  assetType: "stock" | "fund" | "etf";
  sampleSize: number;
  trend: MarketMetrics["trend"];
  return5: number | null;
  return20: number | null;
  return60?: number | null;
  maxDrawdown60: number | null;
  volatility20Annualized: number | null;
  rangePosition20: number | null;
  latestValue: number | null;
  low20: number | null;
  atr14: number | null;
  fundamentalAvailable: boolean;
  valuationAvailable: boolean;
  historicalValuationPercentile: number | null;
  peerValuationPercentile: number | null;
  valuationCoveragePercent: number | null;
  riskEventCount: number;
  officialRiskEventCount: number;
  routineRiskPct: number;
  maxDrawdownPct?: number;
};

export type CandidateScore = {
  score: number;
  decision: "进入模拟候选" | "进入基金中期候选" | "继续观察" | "达到候选上限，继续观察" | "暂不纳入" | "不适合1—2周候选" | "数据不足";
  eligible: boolean;
  components: {
    data: number;
    trend: number;
    momentum: number;
    risk: number;
    valuation: number;
    event: number;
  };
  hardBlocks: string[];
};

export type ReportCandidate = {
  rank: number;
  symbol: string;
  name: string;
  assetType: "stock" | "fund" | "etf";
  origin?: "watchlist" | "market-universe";
  sector: string;
  market: string;
  note: string;
  score: number;
  decision: CandidateScore["decision"];
  eligible: boolean;
  scoreComponents: CandidateScore["components"];
  hardBlocks: string[];
  strengths: string[];
  risks: string[];
  dataGaps: string[];
  horizon: string;
  latestValue: number | null;
  priceAsOf: string | null;
  observationZone: { low: number; high: number; label: string } | null;
  invalidationReference: { price: number; distancePercent: number; explanation: string } | null;
  metrics: Pick<MarketMetrics, "return5" | "return20" | "return60" | "maxDrawdown60" | "volatility20Annualized" | "rangePosition20" | "trend"> | null;
  valuation: {
    peTtm: number | null;
    pb: number | null;
    historicalPePercentile: number | null;
    historicalPbPercentile: number | null;
    peerPePercentile: number | null;
    coveragePercent: number | null;
  } | null;
  evidenceChecks: string[];
  evidenceWarnings: string[];
  evidenceRefs: DeepSeekEvidence[];
};

export type ReportAiNarrative = {
  symbol: string;
  conclusion: string;
  whyConsider: string[];
  whyNot: string[];
  scenarios: Array<{ name: string; condition: string; expectation: string }>;
  terms: Array<{ term: string; explanation: string }>;
  evidenceIds: string[];
};

export type ReportAiAnalysis = {
  status: "success" | "degraded";
  model: string | null;
  generatedAt: string;
  summary: string;
  allocationExplanation: string;
  narratives: ReportAiNarrative[];
  usage: { requestCount: number; inputTokens: number; outputTokens: number } | null;
  warning: string | null;
};

export type PersonalResearchReport = {
  schemaVersion: 1;
  title: string;
  tradingDate: string;
  generatedAt: string;
  generatedFrom: "private-watchlist" | "private-watchlist+market-universe";
  watchlistCount: number;
  marketShortlistCount?: number;
  marketUniverse?: Omit<ReportUniverseInput, "items">;
  analyzedCount: number;
  candidateCount: number;
  stockCandidateCount: number;
  fundCandidateCount: number;
  allocationPlan?: { cashPct: number; fundPct: number; stockSimulationPct: number; basis: string };
  aiAnalysis?: ReportAiAnalysis;
  conclusion: string;
  candidates: ReportCandidate[];
  skipped: Array<{ symbol: string; reason: string }>;
  riskBoundary: {
    profileVersion: number;
    routineRiskPct: number;
    absoluteRiskPct: number;
    maxDrawdownPct: number;
    capitalBand: string;
    monthlyContribution: number;
  };
  methodology: string[];
  warnings: string[];
};

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function scoreStockCandidate(signals: CandidateSignals): CandidateScore {
  const data = (signals.sampleSize >= 60 ? 10 : signals.sampleSize >= 20 ? 5 : 0)
    + (signals.fundamentalAvailable ? 5 : 0)
    + (signals.valuationAvailable ? 5 : 0);
  const trend = signals.trend === "up" ? 25 : signals.trend === "mixed" ? 15 : signals.trend === "down" ? 3 : 0;
  let momentum = 0;
  if (signals.return5 !== null) {
    if (signals.return5 >= 0 && signals.return5 <= 8) momentum += 8;
    else if (signals.return5 >= -3 && signals.return5 < 0) momentum += 5;
    else if (signals.return5 > 8 && signals.return5 <= 15) momentum += 3;
  }
  if (signals.return20 !== null) {
    if (signals.return20 >= -5 && signals.return20 <= 15) momentum += 7;
    else if (signals.return20 > 15 && signals.return20 <= 25) momentum += 3;
  }
  let risk = signals.maxDrawdown60 === null ? 0 : signals.maxDrawdown60 >= -10 ? 10 : signals.maxDrawdown60 >= -15 ? 6 : signals.maxDrawdown60 >= -25 ? 2 : 0;
  const volatilityLimit = signals.assetType === "fund" ? 25 : 40;
  if (signals.volatility20Annualized !== null) risk += signals.volatility20Annualized <= volatilityLimit ? 6 : signals.volatility20Annualized <= volatilityLimit * 1.5 ? 3 : 0;
  if (signals.rangePosition20 !== null) risk += signals.rangePosition20 >= 20 && signals.rangePosition20 <= 80 ? 4 : signals.rangePosition20 <= 90 ? 2 : 0;
  let valuation = 0;
  if (signals.assetType === "stock") {
    const historical = signals.historicalValuationPercentile;
    if (historical !== null) valuation += historical <= 50 ? 8 : historical <= 75 ? 5 : 2;
    if (signals.peerValuationPercentile !== null) valuation += signals.peerValuationPercentile <= 70 ? 2 : 0;
  } else if (signals.valuationCoveragePercent !== null) {
    valuation = signals.valuationCoveragePercent >= 40 ? 10 : signals.valuationCoveragePercent >= 25 ? 6 : signals.valuationCoveragePercent >= 10 ? 3 : 0;
  }
  const event = Math.max(0, 10 - signals.riskEventCount * 3 - signals.officialRiskEventCount * 5);
  const hardBlocks: string[] = [];
  if (signals.sampleSize < 60) hardBlocks.push("历史样本少于60个披露日");
  if (!signals.fundamentalAvailable) hardBlocks.push("基本面或基金资料未取得");
  if (!signals.valuationAvailable) hardBlocks.push("估值证据未取得");
  if (signals.officialRiskEventCount > 0) hardBlocks.push("存在公告主题支持的风险事件，需人工核对原文");
  const drawdownLimit = signals.maxDrawdownPct ?? 15;
  if (signals.maxDrawdown60 !== null && signals.maxDrawdown60 < -drawdownLimit) hardBlocks.push(`最近60个披露日最大回撤超过风险画像${drawdownLimit}%上限`);
  const score = Math.round(clamp(data + trend + momentum + risk + valuation + event));
  let decision: CandidateScore["decision"];
  if (signals.sampleSize < 60 || !signals.fundamentalAvailable || !signals.valuationAvailable) decision = "数据不足";
  else if (hardBlocks.length) decision = "暂不纳入";
  else if (score >= 72) decision = "进入模拟候选";
  else if (score >= 55) decision = "继续观察";
  else decision = "暂不纳入";
  return {
    score,
    decision,
    eligible: decision === "进入模拟候选",
    components: { data, trend, momentum, risk, valuation, event },
    hardBlocks,
  };
}

function scoreFundCandidate(signals: CandidateSignals): CandidateScore {
  const data = (signals.sampleSize >= 100 ? 10 : signals.sampleSize >= 60 ? 5 : 0)
    + (signals.fundamentalAvailable ? 5 : 0)
    + (signals.valuationAvailable ? 5 : 0);
  const trend = signals.trend === "up" ? 15 : signals.trend === "mixed" ? 10 : signals.trend === "down" ? 3 : 0;
  let momentum = 0;
  if (signals.return20 !== null) {
    if (signals.return20 >= -3 && signals.return20 <= 12) momentum += 6;
    else if (signals.return20 > 12 && signals.return20 <= 25) momentum += 3;
  }
  if (signals.return60 !== undefined && signals.return60 !== null) {
    if (signals.return60 >= 0 && signals.return60 <= 25) momentum += 9;
    else if (signals.return60 >= -8 && signals.return60 < 0) momentum += 5;
    else if (signals.return60 > 25 && signals.return60 <= 40) momentum += 3;
  }
  const drawdownLimit = signals.maxDrawdownPct ?? 15;
  let risk = signals.maxDrawdown60 === null ? 0 : signals.maxDrawdown60 >= -8 ? 15 : signals.maxDrawdown60 >= -drawdownLimit ? 9 : 0;
  if (signals.volatility20Annualized !== null) risk += signals.volatility20Annualized <= 20 ? 8 : signals.volatility20Annualized <= 30 ? 4 : 0;
  if (signals.rangePosition20 !== null && signals.rangePosition20 >= 20 && signals.rangePosition20 <= 80) risk += 2;
  let valuation = 0;
  if (signals.valuationCoveragePercent !== null) {
    valuation = signals.valuationCoveragePercent >= 60 ? 15 : signals.valuationCoveragePercent >= 40 ? 10 : signals.valuationCoveragePercent >= 25 ? 6 : signals.valuationCoveragePercent >= 10 ? 3 : 0;
  }
  const event = Math.max(0, 10 - signals.riskEventCount * 3 - signals.officialRiskEventCount * 5);
  const hardBlocks: string[] = [];
  if (signals.sampleSize < 100) hardBlocks.push("中期研究样本少于100个净值披露日");
  if (!signals.fundamentalAvailable) hardBlocks.push("基金资料或持仓证据未取得");
  if (signals.officialRiskEventCount > 0) hardBlocks.push("存在公告主题支持的风险事件，需人工核对原文");
  if (signals.maxDrawdown60 !== null && signals.maxDrawdown60 < -drawdownLimit) hardBlocks.push(`最近60个披露日最大回撤超过风险画像${drawdownLimit}%上限`);
  const score = Math.round(clamp(data + trend + momentum + risk + valuation + event));
  let decision: CandidateScore["decision"];
  if (signals.sampleSize < 100 || !signals.fundamentalAvailable) decision = "数据不足";
  else if (hardBlocks.length) decision = "暂不纳入";
  else if (score >= 72) decision = "进入基金中期候选";
  else if (score >= 55) decision = "继续观察";
  else decision = "暂不纳入";
  return {
    score,
    decision,
    eligible: decision === "进入基金中期候选",
    components: { data, trend, momentum, risk, valuation, event },
    hardBlocks,
  };
}

export function scoreCandidate(signals: CandidateSignals): CandidateScore {
  return signals.assetType === "fund" ? scoreFundCandidate(signals) : scoreStockCandidate(signals);
}

export function buildRiskReferences(signals: CandidateSignals, eligible: boolean) {
  if (!eligible || signals.latestValue === null || signals.latestValue <= 0 || signals.atr14 === null || signals.atr14 <= 0) {
    return { observationZone: null, invalidationReference: null };
  }
  const high = signals.latestValue;
  const lowByAtr = high - signals.atr14 * 0.75;
  const low = Math.max(signals.low20 ?? lowByAtr, lowByAtr);
  const maximumLossPrice = high * (1 - signals.routineRiskPct / 100);
  const invalidation = Math.max(maximumLossPrice, high - signals.atr14 * 1.5);
  return {
    observationZone: {
      low: Math.round(low * 1000) / 1000,
      high: Math.round(high * 1000) / 1000,
      label: "基于最近收盘价、20日低点与ATR形成的模拟观察区间，不是挂单指令",
    },
    invalidationReference: {
      price: Math.round(invalidation * 1000) / 1000,
      distancePercent: Math.round((1 - invalidation / high) * 10_000) / 100,
      explanation: `参考失效距离不超过风险画像中的常规${signals.routineRiskPct}%亏损线；实际跳空可能超过该值。`,
    },
  };
}

function matchesExcludedScope(asset: PublicMarketAsset, excludedScope: string) {
  const terms = excludedScope.split(/[,，、;；\s]+/).map((term) => term.trim()).filter((term) => term.length >= 2);
  return terms.find((term) => `${asset.name} ${asset.sector}`.includes(term)) ?? null;
}

function selectAsset(results: PublicMarketAsset[], item: ReportWatchItem) {
  const code = item.symbol.slice(0, 6);
  return results.find((asset) => asset.symbol.slice(0, 6) === code && asset.type === item.assetType) ?? null;
}

function compactMetrics(metrics: MarketMetrics | null): ReportCandidate["metrics"] {
  if (!metrics) return null;
  return {
    return5: metrics.return5,
    return20: metrics.return20,
    return60: metrics.return60,
    maxDrawdown60: metrics.maxDrawdown60,
    volatility20Annualized: metrics.volatility20Annualized,
    rangePosition20: metrics.rangePosition20,
    trend: metrics.trend,
  };
}

function valuationSummary(context: MarketContextResult | null): ReportCandidate["valuation"] {
  const valuation = context?.valuation;
  if (!valuation) return null;
  if (valuation.kind === "stock") return {
    peTtm: valuation.peTtm,
    pb: valuation.pb,
    historicalPePercentile: valuation.history.pe?.percentile ?? null,
    historicalPbPercentile: valuation.history.pb?.percentile ?? null,
    peerPePercentile: valuation.peers?.pePercentile ?? null,
    coveragePercent: null,
  };
  return {
    peTtm: valuation.peTtm,
    pb: valuation.pb,
    historicalPePercentile: null,
    historicalPbPercentile: null,
    peerPePercentile: null,
    coveragePercent: valuation.peCoveragePercent,
  };
}

function describeEvidence(metrics: MarketMetrics | null, fundamentals: FundamentalResult | null, context: MarketContextResult | null, profile: ReportRiskProfile) {
  const strengths: string[] = [];
  const risks: string[] = [];
  if (metrics?.trend === "up") strengths.push("最近收盘价与5/10/20日均线形成上行排列");
  else if (metrics?.trend === "down") risks.push("最近收盘价与均线结构处于下行排列");
  else if (metrics?.trend === "mixed") risks.push("短中期均线方向不一致，趋势确认不足");
  if (metrics?.return20 !== null && metrics?.return20 !== undefined) {
    if (metrics.return20 >= 0 && metrics.return20 <= 15) strengths.push(`最近20个披露日收益${metrics.return20.toFixed(2)}%，未触发程序的过热区间`);
    if (metrics.return20 > 15) risks.push(`最近20个披露日上涨${metrics.return20.toFixed(2)}%，存在追高风险`);
  }
  if (metrics?.maxDrawdown60 !== null && metrics?.maxDrawdown60 !== undefined && metrics.maxDrawdown60 < -profile.maxDrawdownPct) risks.push(`最近60个披露日最大回撤${metrics.maxDrawdown60.toFixed(2)}%，超过风险画像${profile.maxDrawdownPct}%上限`);
  if (fundamentals?.kind === "stock") {
    const latest = fundamentals.financials[0];
    if (latest?.netProfitYoy !== null && latest?.netProfitYoy !== undefined) {
      if (latest.netProfitYoy > 0) strengths.push(`最近报告期归母净利润同比${latest.netProfitYoy.toFixed(2)}%`);
      else risks.push(`最近报告期归母净利润同比${latest.netProfitYoy.toFixed(2)}%`);
    }
  }
  if (fundamentals?.kind === "fund") {
    strengths.push(`已取得${fundamentals.holdings.length}条最近一期主要持仓，前十大合计${fundamentals.topHoldingsPercent?.toFixed(2) ?? "缺失"}%`);
    risks.push("基金持仓为季度披露快照，不代表当前实时组合");
  }
  if (context?.valuation?.kind === "stock") {
    const pePercentile = context.valuation.history.pe?.percentile;
    if (pePercentile !== undefined && pePercentile !== null) strengths.push(`PE TTM处于所示历史样本${pePercentile.toFixed(1)}%分位，仅作为相对尺度`);
  }
  const riskNews = context?.news.filter((item) => item.eventType === "风险事件") ?? [];
  if (riskNews.length) risks.push(`发现${riskNews.length}条风险事件线索，其中${riskNews.filter((item) => item.verification === "公告主题支持").length}条有公告主题支持`);
  return { strengths: strengths.slice(0, 5), risks: risks.slice(0, 6) };
}

function evidenceDate(value: string | null | undefined) {
  const date = value?.slice(0, 10) ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

function buildEvidenceRefs(asset: PublicMarketAsset, history: HistoryResult | null, fundamentals: FundamentalResult | null, context: MarketContextResult | null, metrics: MarketMetrics | null): DeepSeekEvidence[] {
  const code = asset.symbol.slice(0, 6);
  const latestDate = evidenceDate(metrics?.latestDate ?? asset.sourceAsOf);
  const refs: DeepSeekEvidence[] = [];
  if (history) refs.push({
    id: `${code}-history`,
    title: `${asset.name}历史${history.basis}`,
    source: history.source,
    url: asset.type === "fund" ? `https://fundf10.eastmoney.com/jjjz_${code}.html` : `https://quote.eastmoney.com/${asset.symbol.toUpperCase().endsWith(".SH") ? "sh" : "sz"}${code}.html`,
    publishedAt: latestDate,
    excerpt: `样本${metrics?.sampleSize ?? 0}个披露日；5日收益${metrics?.return5 ?? "缺失"}%，20日收益${metrics?.return20 ?? "缺失"}%，60日最大回撤${metrics?.maxDrawdown60 ?? "缺失"}%。`,
  });
  if (fundamentals?.kind === "stock") {
    const latest = fundamentals.financials[0];
    if (latest) refs.push({
      id: `${code}-finance-${latest.reportDate}`,
      title: `${asset.name}${latest.reportName}财务摘要`,
      source: "东方财富第三方结构化财务摘要",
      url: `https://data.eastmoney.com/bbsj/${code}.html`,
      publishedAt: evidenceDate(latest.noticeDate || latest.reportDate),
      excerpt: `营收同比${latest.revenueYoy ?? "缺失"}%，归母净利润同比${latest.netProfitYoy ?? "缺失"}%，ROE ${latest.roe ?? "缺失"}%，资产负债率${latest.debtRatio ?? "缺失"}%；需与公司正式报告交叉核验。`,
    });
    fundamentals.announcements.slice(0, 2).forEach((item, index) => refs.push({
      id: `${code}-announcement-${index + 1}`,
      title: item.title,
      source: "公司公告公开原文镜像",
      url: item.mirrorUrl,
      publishedAt: evidenceDate(item.date),
      excerpt: `公告分类：${item.category}。程序只取得标题与原文入口，未声称公告内容已由AI完整核对。`,
    }));
  }
  if (fundamentals?.kind === "fund") refs.push({
    id: `${code}-holdings`,
    title: `${asset.name}最近披露持仓与基金资料`,
    source: "东方财富基金公开资料",
    url: `https://fundf10.eastmoney.com/jjcc_${code}.html`,
    publishedAt: evidenceDate(fundamentals.holdingsAsOf ?? latestDate),
    excerpt: `基金类型${fundamentals.profile.fundType}；最近披露持仓${fundamentals.holdings.length}条，前十大合计${fundamentals.topHoldingsPercent ?? "缺失"}%；季度快照不代表当前组合。`,
  });
  context?.news.slice(0, 2).forEach((item, index) => refs.push({
    id: `${code}-news-${index + 1}`,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: evidenceDate(item.date),
    excerpt: `${item.eventType}；${item.verification}；${item.verificationDetail}`,
  }));
  const directPolicy = context?.policies.find((item) => item.relevance === "直接相关");
  if (directPolicy) refs.push({
    id: `${code}-policy`,
    title: directPolicy.title,
    source: "中国证监会",
    url: directPolicy.url,
    publishedAt: evidenceDate(directPolicy.date),
    excerpt: `适用范围：${directPolicy.scope}；关键词规则标注为直接相关，不代表会推动该标的上涨或下跌。`,
  });
  return refs.slice(0, 6);
}

export async function analyzeWatchItem(item: ReportWatchItem, profile: ReportRiskProfile): Promise<ReportCandidate | { skipped: string }> {
  const search = await searchPublicMarket(item.symbol);
  const asset = selectAsset(search, item);
  if (!asset) return { skipped: "公开搜索未返回代码和资产类型完全匹配的标的" };
  const excludedTerm = matchesExcludedScope(asset, profile.excludedScope);
  if (excludedTerm) return { skipped: `命中风险画像禁投范围“${excludedTerm}”` };
  const [historyResult, fundamentalResult, contextResult] = await Promise.allSettled([
    getMarketHistory(asset.symbol, asset.type),
    getFundamentals(asset.symbol, asset.type),
    getMarketContext(asset.symbol, asset.name, asset.type),
  ]);
  const dataGaps: string[] = [];
  let metrics: MarketMetrics | null = null;
  if (historyResult.status === "fulfilled") {
    try { metrics = calculateMarketMetrics(historyResult.value.points); } catch (error) { dataGaps.push(`历史指标计算失败：${error instanceof Error ? error.message : "unknown"}`); }
  } else dataGaps.push(`历史数据读取失败：${historyResult.reason instanceof Error ? historyResult.reason.message : "unknown"}`);
  const fundamentals = fundamentalResult.status === "fulfilled" ? fundamentalResult.value : null;
  if (!fundamentals) dataGaps.push(`基本面读取失败：${fundamentalResult.status === "rejected" && fundamentalResult.reason instanceof Error ? fundamentalResult.reason.message : "unknown"}`);
  const context = contextResult.status === "fulfilled" ? contextResult.value : null;
  if (!context?.valuation) dataGaps.push(`估值读取失败：${contextResult.status === "rejected" && contextResult.reason instanceof Error ? contextResult.reason.message : "unknown"}`);
  const valuation = valuationSummary(context);
  const riskEvents = context?.news.filter((news) => news.eventType === "风险事件") ?? [];
  const signals: CandidateSignals = {
    assetType: asset.type,
    sampleSize: metrics?.sampleSize ?? 0,
    trend: metrics?.trend ?? "insufficient",
    return5: metrics?.return5 ?? null,
    return20: metrics?.return20 ?? null,
    return60: metrics?.return60 ?? null,
    maxDrawdown60: metrics?.maxDrawdown60 ?? null,
    volatility20Annualized: metrics?.volatility20Annualized ?? null,
    rangePosition20: metrics?.rangePosition20 ?? null,
    latestValue: metrics?.latestValue ?? null,
    low20: metrics?.low20 ?? null,
    atr14: metrics?.atr14 ?? null,
    fundamentalAvailable: Boolean(fundamentals),
    valuationAvailable: Boolean(context?.valuation),
    historicalValuationPercentile: average([valuation?.historicalPePercentile ?? null, valuation?.historicalPbPercentile ?? null]),
    peerValuationPercentile: valuation?.peerPePercentile ?? null,
    valuationCoveragePercent: valuation?.coveragePercent ?? null,
    riskEventCount: riskEvents.length,
    officialRiskEventCount: riskEvents.filter((news) => news.verification === "公告主题支持").length,
    routineRiskPct: profile.routineRiskPct,
    maxDrawdownPct: profile.maxDrawdownPct,
  };
  const scored = scoreCandidate(signals);
  const references = asset.type === "fund" ? { observationZone: null, invalidationReference: null } : buildRiskReferences(signals, scored.eligible);
  const described = describeEvidence(metrics, fundamentals, context, profile);
  const evidenceChecks = [
    ...(fundamentals?.quality.checks ?? []),
    ...(context?.quality.checks ?? []),
    metrics ? `历史序列${metrics.sampleSize}个有效披露日，最新日期${metrics.latestDate}` : "历史指标未取得",
  ];
  const evidenceWarnings = [
    ...(fundamentals?.quality.warnings ?? []),
    ...(context?.quality.warnings ?? []),
    historyResult.status === "fulfilled" ? historyResult.value.warning : "历史数据未取得",
  ];
  const evidenceRefs = buildEvidenceRefs(asset, historyResult.status === "fulfilled" ? historyResult.value : null, fundamentals, context, metrics);
  return {
    rank: 0,
    symbol: asset.symbol,
    name: asset.name,
    assetType: asset.type,
    origin: item.origin ?? "watchlist",
    sector: asset.sector,
    market: asset.market,
    note: item.note?.slice(0, 300) ?? "",
    score: scored.score,
    decision: scored.decision,
    eligible: scored.eligible,
    scoreComponents: scored.components,
    hardBlocks: scored.hardBlocks,
    strengths: described.strengths.length ? described.strengths : ["没有足够证据形成支持理由"],
    risks: described.risks.length ? described.risks : ["免费公开数据无稳定性承诺，仍需人工复核"],
    dataGaps,
    horizon: asset.type === "fund" ? profile.fundHorizon : profile.stockHorizon,
    latestValue: metrics?.latestValue ?? null,
    priceAsOf: metrics?.latestDate ?? asset.sourceAsOf,
    observationZone: references.observationZone,
    invalidationReference: references.invalidationReference,
    metrics: compactMetrics(metrics),
    valuation,
    evidenceChecks,
    evidenceWarnings,
    evidenceRefs,
  };
}

async function analyzeWithLimit(items: ReportWatchItem[], profile: ReportRiskProfile, limit = 3) {
  const output: Array<ReportCandidate | { skipped: string }> = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try { output[index] = await analyzeWatchItem(items[index], profile); }
      catch (error) { output[index] = { skipped: `研究流水线失败：${error instanceof Error ? error.message : "unknown"}` }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

export function applyCandidateLimits(candidates: ReportCandidate[]) {
  let stockAndEtfCount = 0;
  let fundCount = 0;
  const ordered = [...candidates].sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.score - left.score || left.symbol.localeCompare(right.symbol));
  for (const candidate of ordered) {
    if (!candidate.eligible) continue;
    const isFund = candidate.assetType === "fund";
    const currentCount = isFund ? fundCount : stockAndEtfCount;
    const limit = isFund ? 2 : 3;
    if (currentCount >= limit) {
      candidate.eligible = false;
      candidate.decision = "达到候选上限，继续观察";
      candidate.observationZone = null;
      candidate.invalidationReference = null;
      continue;
    }
    if (isFund) fundCount += 1;
    else stockAndEtfCount += 1;
  }
  return ordered.sort((left, right) => Number(right.eligible) - Number(left.eligible) || right.score - left.score || left.symbol.localeCompare(right.symbol));
}

export function mergeResearchPool(items: ReportWatchItem[], universe?: ReportUniverseInput) {
  const watchlistItems = items.slice(0, 12).map((item) => ({ ...item, origin: "watchlist" as const }));
  const keys = new Set(watchlistItems.map((item) => `${item.assetType}:${item.symbol.slice(0, 6)}`));
  const uniqueMarketItems = (universe?.items ?? []).filter((item) => {
    const key = `${item.assetType}:${item.symbol.slice(0, 6)}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  }).map((item) => ({ ...item, origin: "market-universe" as const }));
  const marketSlots = Math.max(4, 16 - watchlistItems.length);
  const stocks = uniqueMarketItems.filter((item) => item.assetType !== "fund");
  const funds = uniqueMarketItems.filter((item) => item.assetType === "fund");
  const stockTarget = Math.ceil(marketSlots / 2);
  const fundTarget = Math.floor(marketSlots / 2);
  const selected = [...stocks.slice(0, stockTarget), ...funds.slice(0, fundTarget)];
  const selectedKeys = new Set(selected.map((item) => `${item.assetType}:${item.symbol.slice(0, 6)}`));
  for (const item of uniqueMarketItems) {
    if (selected.length >= marketSlots) break;
    const key = `${item.assetType}:${item.symbol.slice(0, 6)}`;
    if (!selectedKeys.has(key)) {
      selected.push(item);
      selectedKeys.add(key);
    }
  }
  return { scoped: [...watchlistItems, ...selected], watchlistItems, marketItems: selected };
}

export function buildAllocationPlan(stockCandidateCount: number, fundCandidateCount: number) {
  if (stockCandidateCount === 0 && fundCandidateCount === 0) return { cashPct: 100, fundPct: 0, stockSimulationPct: 0, basis: "没有标的通过硬门槛，研究组合保持100%现金观察。" };
  if (fundCandidateCount > 0 && stockCandidateCount === 0) return { cashPct: 65, fundPct: 35, stockSimulationPct: 0, basis: "只有基金通过中期门槛；保留多数现金，A股继续仅做模拟研究。" };
  if (stockCandidateCount > 0 && fundCandidateCount === 0) return { cashPct: 90, fundPct: 0, stockSimulationPct: 10, basis: "只有A股/ETF通过短期门槛；在小本金阶段仍只分配模拟研究仓位。" };
  return { cashPct: 50, fundPct: 40, stockSimulationPct: 10, basis: "股票与基金均有合格样本；实盘仍以基金和现金为主，A股保持模拟。" };
}

export async function buildPersonalResearchReport(items: ReportWatchItem[], profile: ReportRiskProfile, tradingDate: string, generatedAt = new Date().toISOString(), universe?: ReportUniverseInput): Promise<PersonalResearchReport> {
  const { scoped, marketItems } = mergeResearchPool(items, universe);
  const results = await analyzeWithLimit(scoped, profile);
  const skipped: PersonalResearchReport["skipped"] = [];
  const candidates: ReportCandidate[] = [];
  results.forEach((result, index) => {
    if ("skipped" in result) skipped.push({ symbol: scoped[index].symbol, reason: result.skipped });
    else candidates.push(result);
  });
  const limitedCandidates = applyCandidateLimits(candidates);
  limitedCandidates.forEach((candidate, index) => { candidate.rank = index + 1; });
  const stockCandidateCount = limitedCandidates.filter((candidate) => candidate.eligible && candidate.assetType !== "fund").length;
  const fundCandidateCount = limitedCandidates.filter((candidate) => candidate.eligible && candidate.assetType === "fund").length;
  const candidateCount = stockCandidateCount + fundCandidateCount;
  const conclusion = !scoped.length
    ? "自选池为空且市场初筛不可用，无法生成真实候选。"
    : candidateCount
      ? `共有${stockCandidateCount}个A股/ETF模拟候选、${fundCandidateCount}个基金中期观察候选通过程序门槛；仍需人工核对原始证据。`
      : "没有标的通过全部硬门槛。现金和等待是本报告的有效结论，不为凑数强行推荐。";
  return {
    schemaVersion: 1,
    title: `${tradingDate} 交易日前夜个人研究报告`,
    tradingDate,
    generatedAt,
    generatedFrom: universe ? "private-watchlist+market-universe" : "private-watchlist",
    watchlistCount: items.length,
    marketShortlistCount: marketItems.length,
    marketUniverse: universe ? {
      source: universe.source,
      asOf: universe.asOf,
      stockUniverseTotal: universe.stockUniverseTotal,
      stockRowsEvaluated: universe.stockRowsEvaluated,
      fundUniverseTotal: universe.fundUniverseTotal,
      fundRowsEvaluated: universe.fundRowsEvaluated,
      checks: universe.checks,
      warnings: universe.warnings,
    } : undefined,
    analyzedCount: limitedCandidates.length,
    candidateCount,
    stockCandidateCount,
    fundCandidateCount,
    allocationPlan: buildAllocationPlan(stockCandidateCount, fundCandidateCount),
    conclusion,
    candidates: limitedCandidates,
    skipped,
    riskBoundary: {
      profileVersion: profile.version,
      routineRiskPct: profile.routineRiskPct,
      absoluteRiskPct: profile.absoluteRiskPct,
      maxDrawdownPct: profile.maxDrawdownPct,
      capitalBand: profile.capitalBand,
      monthlyContribution: profile.monthlyContribution,
    },
    methodology: [
      universe
        ? "研究池由当前用户自选和公共市场初筛组成；用户数据保持隔离，市场初筛不读取其他用户数据。"
        : "候选只来自当前用户自己的自选池，不使用其他用户数据。",
      ...(universe ? ["A股先读取全市场总数，并对按成交额排序的前100只流动性样本做资金门槛、涨跌幅、换手率、估值与市值初筛；基金排行与全量目录交叉匹配。市场初筛不等于逐只完成基本面研究。"] : []),
      "程序评分由数据完整性、趋势、动量、波动与回撤、估值相对位置和事件风险六部分组成；评分不是上涨概率。",
      "股票和ETF使用1—2周模型；历史、基本面、估值证据齐全且未触发个人最大回撤上限时，才可能进入模拟候选。",
      "场外公募基金使用3—12个月中期模型，依据不少于100个净值披露日、基金资料、趋势、回撤、波动、持仓穿透估值和事件风险评分，不生成盘中挂单区间。",
      "每份报告最多保留3只A股/ETF模拟候选和2只基金中期候选；超出名额的合格标的降为继续观察。",
    ],
    warnings: [
      "本报告使用免费公开网页数据，存在延迟、缺失和接口变化风险，价格必须用券商或基金公司渠道复核。",
      "观察区间和失效价只是纪律化模拟参考，不是自动交易指令；跳空可能使实际损失超过预设值。",
      ...(items.length > 12 ? [`自选池共${items.length}项，本次只分析前12项；需要先整理自选池。`] : []),
      ...(universe?.warnings ?? []),
    ],
  };
}
