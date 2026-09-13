import { getFundamentals, type StockFundamentalResult } from "./fundamentals.ts";

const VALUATION_ENDPOINT = "https://datacenter-web.eastmoney.com/api/data/v1/get";
const NEWS_SEARCH_ENDPOINT = "https://search-api-web.eastmoney.com/search/jsonp";
const CSRC_POLICY_ENDPOINT = "https://www.csrc.gov.cn/csrc/c100039/common_list.shtml";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 15 * 60_000;
const HISTORY_LIMIT = 750;
const contextCache = new Map<string, { expiresAt: number; value: MarketContextResult }>();

type ValuationApiRow = {
  SECURITY_CODE?: string;
  SECUCODE?: string;
  SECURITY_NAME_ABBR?: string;
  BOARD_CODE?: string;
  BOARD_NAME?: string;
  TOTAL_MARKET_CAP?: number | null;
  NOTLIMITED_MARKETCAP_A?: number | null;
  CLOSE_PRICE?: number | null;
  PE_TTM?: number | null;
  PB_MRQ?: number | null;
  PS_TTM?: number | null;
  TRADE_DATE?: string;
};

type ValuationResponse = {
  success?: boolean;
  message?: string;
  result?: { count?: number; pages?: number; data?: ValuationApiRow[] } | null;
};

type NewsRow = { date?: string; title?: string; content?: string; mediaName?: string; url?: string };
type NewsResponse = { code?: number; msg?: string; result?: { cmsArticleWebOld?: NewsRow[] } | null };

export type ValuationPoint = {
  symbol: string;
  name: string;
  boardCode: string;
  boardName: string;
  marketCap: number | null;
  floatMarketCap: number | null;
  closePrice: number | null;
  peTtm: number | null;
  pbMrq: number | null;
  psTtm: number | null;
  tradeDate: string;
};

export type DistributionSummary = {
  current: number;
  validCount: number;
  percentile: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
};

export type PeerSummary = {
  asOf: string;
  boardName: string;
  totalCount: number;
  positivePeCount: number;
  positivePbCount: number;
  peMedian: number | null;
  pbMedian: number | null;
  pePercentile: number | null;
  pbPercentile: number | null;
  rows: Array<{
    symbol: string;
    name: string;
    marketCap: number | null;
    peTtm: number | null;
    pb: number | null;
    psTtm: number | null;
    isTarget: boolean;
  }>;
};

export type StockValuation = {
  kind: "stock";
  name: string;
  industry: string;
  boardCode: string;
  price: number | null;
  peTtm: number | null;
  pb: number | null;
  psTtm: number | null;
  marketCap: number | null;
  floatMarketCap: number | null;
  quoteAsOf: string | null;
  history: {
    sampleCount: number;
    startDate: string;
    endDate: string;
    pe: DistributionSummary | null;
    pb: DistributionSummary | null;
  };
  peers: PeerSummary | null;
};

export type FundLookThroughValuation = {
  kind: "fund-look-through";
  peTtm: number | null;
  pb: number | null;
  peCoveragePercent: number;
  pbCoveragePercent: number;
  topHoldingsPercent: number | null;
  holdingsAsOf: string | null;
  valuedHoldings: number;
  totalHoldings: number;
  valuationAsOf: string | null;
};

export type VerifiedNews = {
  title: string;
  date: string;
  source: string;
  url: string;
  eventType: string;
  relevance: "标题直接命中" | "正文提及";
  verification: "公告主题支持" | "多家媒体相似报道" | "单一媒体线索";
  verificationDetail: string;
  sourceCount: number;
  supportUrl?: string;
};

export type MarketContextResult = {
  valuation: StockValuation | FundLookThroughValuation | null;
  news: VerifiedNews[];
  policies: Array<{
    title: string;
    date: string;
    url: string;
    scope: string;
    relevance: "直接相关" | "市场通用";
  }>;
  fetchedAt: string;
  quality: {
    checks: string[];
    warnings: string[];
    evidenceGrade: "low" | "medium";
  };
};

type NewsCandidate = Omit<VerifiedNews, "verification" | "verificationDetail" | "sourceCount" | "supportUrl"> & { content: string };

async function fetchJson<T>(url: URL) {
  const response = await fetch(url, {
    headers: { accept: "application/json,text/plain,*/*", "user-agent": "JidangResearchTerminal/0.1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`CONTEXT_HTTP_${response.status}`);
  return await response.json() as T;
}

async function fetchText(url: URL) {
  const response = await fetch(url, {
    headers: { accept: "text/html,text/plain,*/*", "user-agent": "JidangResearchTerminal/0.1" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`CONTEXT_HTTP_${response.status}`);
  return await response.text();
}

function finiteOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveOrNull(value: unknown) {
  const parsed = finiteOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function secuCode(symbol: string) {
  const code = symbol.slice(0, 6);
  const suffix = symbol.slice(7).toUpperCase();
  return `${code}.${suffix || (/^6/.test(code) ? "SH" : "SZ")}`;
}

function cleanText(value: string) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function quantile(sorted: number[], probability: number) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const value = sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  return round(value, 4);
}

export function summarizeDistribution(current: number | null, values: Array<number | null>) {
  if (current === null || current <= 0) return null;
  const sorted = values.filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return {
    current,
    validCount: sorted.length,
    percentile: round(sorted.filter((value) => value <= current).length / sorted.length * 100),
    median: quantile(sorted, 0.5)!,
    p25: quantile(sorted, 0.25)!,
    p75: quantile(sorted, 0.75)!,
    min: sorted[0],
    max: sorted.at(-1)!,
  } satisfies DistributionSummary;
}

export function parseValuationRows(rows: ValuationApiRow[]) {
  const unique = new Map<string, ValuationPoint>();
  for (const row of rows) {
    const symbol = row.SECUCODE?.trim() || row.SECURITY_CODE?.trim() || "";
    const tradeDate = row.TRADE_DATE?.slice(0, 10) || "";
    if (!/^\d{6}(?:\.(?:SH|SZ))?$/i.test(symbol) || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) continue;
    const key = `${symbol}:${tradeDate}`;
    if (unique.has(key)) continue;
    unique.set(key, {
      symbol: symbol.toUpperCase(),
      name: row.SECURITY_NAME_ABBR?.trim() || row.SECURITY_CODE || "名称缺失",
      boardCode: row.BOARD_CODE?.trim() || "",
      boardName: row.BOARD_NAME?.trim() || "行业未返回",
      marketCap: positiveOrNull(row.TOTAL_MARKET_CAP),
      floatMarketCap: positiveOrNull(row.NOTLIMITED_MARKETCAP_A),
      closePrice: positiveOrNull(row.CLOSE_PRICE),
      peTtm: positiveOrNull(row.PE_TTM),
      pbMrq: positiveOrNull(row.PB_MRQ),
      psTtm: positiveOrNull(row.PS_TTM),
      tradeDate,
    });
  }
  return [...unique.values()];
}

function median(values: Array<number | null>) {
  const sorted = values.filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  return sorted.length ? quantile(sorted, 0.5) : null;
}

function rankPercentile(current: number | null, values: Array<number | null>) {
  if (current === null || current <= 0) return null;
  const valid = values.filter((value): value is number => value !== null && value > 0);
  return valid.length ? round(valid.filter((value) => value <= current).length / valid.length * 100) : null;
}

export function buildPeerSummary(target: ValuationPoint, rows: ValuationPoint[]): PeerSummary | null {
  const peers = rows.filter((row) => row.boardCode === target.boardCode && row.tradeDate === target.tradeDate);
  if (!target.boardCode || !peers.length) return null;
  const targetCode = target.symbol.slice(0, 6);
  const sorted = [...peers].sort((a, b) => (b.marketCap ?? -1) - (a.marketCap ?? -1));
  const displayed = sorted.slice(0, 8);
  const targetRow = sorted.find((row) => row.symbol.slice(0, 6) === targetCode);
  if (targetRow && !displayed.some((row) => row.symbol.slice(0, 6) === targetCode)) displayed[displayed.length - 1] = targetRow;
  return {
    asOf: target.tradeDate,
    boardName: target.boardName,
    totalCount: peers.length,
    positivePeCount: peers.filter((row) => row.peTtm !== null && row.peTtm > 0).length,
    positivePbCount: peers.filter((row) => row.pbMrq !== null && row.pbMrq > 0).length,
    peMedian: median(peers.map((row) => row.peTtm)),
    pbMedian: median(peers.map((row) => row.pbMrq)),
    pePercentile: rankPercentile(target.peTtm, peers.map((row) => row.peTtm)),
    pbPercentile: rankPercentile(target.pbMrq, peers.map((row) => row.pbMrq)),
    rows: displayed.map((row) => ({
      symbol: row.symbol,
      name: row.name,
      marketCap: row.marketCap,
      peTtm: row.peTtm,
      pb: row.pbMrq,
      psTtm: row.psTtm,
      isTarget: row.symbol.slice(0, 6) === targetCode,
    })),
  };
}

function valuationUrl(params: { filter: string; pageNumber?: number; pageSize?: number; columns?: string }) {
  const url = new URL(VALUATION_ENDPOINT);
  url.searchParams.set("reportName", "RPT_VALUEANALYSIS_DET");
  url.searchParams.set("columns", params.columns || "ALL");
  url.searchParams.set("filter", params.filter);
  url.searchParams.set("pageNumber", String(params.pageNumber ?? 1));
  url.searchParams.set("pageSize", String(params.pageSize ?? 500));
  url.searchParams.set("sortTypes", "-1");
  url.searchParams.set("sortColumns", "TRADE_DATE");
  url.searchParams.set("source", "WEB");
  url.searchParams.set("client", "WEB");
  return url;
}

async function fetchValuationPage(filter: string, pageNumber: number, pageSize: number, columns = "ALL") {
  const payload = await fetchJson<ValuationResponse>(valuationUrl({ filter, pageNumber, pageSize, columns }));
  if (!payload.success) throw new Error(payload.message || "VALUATION_EMPTY");
  return { rows: payload.result?.data ?? [], count: payload.result?.count ?? 0 };
}

async function getLatestValuation(symbol: string) {
  const page = await fetchValuationPage(`(SECUCODE="${secuCode(symbol)}")`, 1, 1);
  return parseValuationRows(page.rows)[0] ?? null;
}

async function getStockValuation(symbol: string): Promise<StockValuation> {
  const filter = `(SECUCODE="${secuCode(symbol)}")`;
  const firstPage = await fetchValuationPage(filter, 1, 500);
  if (!firstPage.rows.length) throw new Error("VALUATION_EMPTY");
  const secondPage = firstPage.count > 500 ? await fetchValuationPage(filter, 2, 500) : { rows: [] as ValuationApiRow[], count: firstPage.count };
  const history = parseValuationRows([...firstPage.rows, ...secondPage.rows]).slice(0, HISTORY_LIMIT);
  const current = history[0];
  if (!current) throw new Error("VALUATION_EMPTY");
  const peerColumns = "SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,BOARD_CODE,BOARD_NAME,TOTAL_MARKET_CAP,PE_TTM,PB_MRQ,PS_TTM,TRADE_DATE";
  const peerPage = current.boardCode
    ? await fetchValuationPage(`(BOARD_CODE="${current.boardCode}")(TRADE_DATE='${current.tradeDate}')`, 1, 200, peerColumns).catch(() => null)
    : null;
  const peers = peerPage ? buildPeerSummary(current, parseValuationRows(peerPage.rows)) : null;
  return {
    kind: "stock",
    name: current.name,
    industry: current.boardName,
    boardCode: current.boardCode,
    price: current.closePrice,
    peTtm: current.peTtm,
    pb: current.pbMrq,
    psTtm: current.psTtm,
    marketCap: current.marketCap,
    floatMarketCap: current.floatMarketCap,
    quoteAsOf: current.tradeDate,
    history: {
      sampleCount: history.length,
      startDate: history.at(-1)?.tradeDate ?? current.tradeDate,
      endDate: current.tradeDate,
      pe: summarizeDistribution(current.peTtm, history.map((row) => row.peTtm)),
      pb: summarizeDistribution(current.pbMrq, history.map((row) => row.pbMrq)),
    },
    peers,
  };
}

export function weightedHarmonic(rows: Array<{ weight: number; value: number | null }>) {
  const valid = rows.filter((row) => row.weight > 0 && row.value !== null && row.value > 0);
  const weight = valid.reduce((sum, row) => sum + row.weight, 0);
  const denominator = valid.reduce((sum, row) => sum + row.weight / row.value!, 0);
  return { value: weight > 0 && denominator > 0 ? weight / denominator : null, coverage: weight };
}

async function getFundLookThrough(symbol: string, assetType: "fund" | "etf"): Promise<FundLookThroughValuation> {
  const fundamental = await getFundamentals(symbol, assetType);
  if (fundamental.kind !== "fund") throw new Error("FUND_HOLDINGS_UNAVAILABLE");
  const valuations = await Promise.all(fundamental.holdings.map(async (holding) => ({
    holding,
    valuation: await getLatestValuation(holding.code).catch(() => null),
  })));
  const pe = weightedHarmonic(valuations.map(({ holding, valuation }) => ({ weight: holding.navPercent, value: valuation?.peTtm ?? null })));
  const pb = weightedHarmonic(valuations.map(({ holding, valuation }) => ({ weight: holding.navPercent, value: valuation?.pbMrq ?? null })));
  const dates = valuations.map((row) => row.valuation?.tradeDate).filter((date): date is string => Boolean(date)).sort().reverse();
  return {
    kind: "fund-look-through",
    peTtm: pe.value,
    pb: pb.value,
    peCoveragePercent: round(pe.coverage),
    pbCoveragePercent: round(pb.coverage),
    topHoldingsPercent: fundamental.topHoldingsPercent,
    holdingsAsOf: fundamental.holdingsAsOf,
    valuedHoldings: valuations.filter((row) => row.valuation).length,
    totalHoldings: fundamental.holdings.length,
    valuationAsOf: dates[0] ?? null,
  };
}

export function parseNewsJsonp(raw: string): NewsResponse {
  const open = raw.indexOf("(");
  const close = raw.lastIndexOf(")");
  if (open < 0 || close <= open) throw new Error("NEWS_JSONP_INVALID");
  return JSON.parse(raw.slice(open + 1, close)) as NewsResponse;
}

function classifyEvent(title: string, content: string) {
  const text = `${title} ${content}`;
  if (/立案|处罚|亏损|下调|减持|质押|诉讼|退市|警示|风险/.test(text)) return "风险事件";
  if (/分红|回购|增持|定增|并购|股权|权益分派/.test(text)) return "资本动作";
  if (/业绩|收入|利润|销量|价格|产品|订单|项目|业务/.test(text)) return "经营信息";
  return "行业关联";
}

function normalizeNewsRow(row: NewsRow, name: string, code: string): NewsCandidate | null {
  const title = cleanText(row.title ?? "");
  const content = cleanText(row.content ?? "");
  const url = row.url?.trim() ?? "";
  const date = row.date?.slice(0, 19) ?? "";
  if (!title || !/^https?:\/\//.test(url) || !/^\d{4}-\d{2}-\d{2}/.test(date)) return null;
  const titleHit = title.includes(name) || title.includes(code);
  const bodyHit = content.includes(name) || content.includes(code);
  if (!titleHit && !bodyHit) return null;
  return {
    title,
    content,
    date,
    source: cleanText(row.mediaName ?? "来源未标明") || "来源未标明",
    url,
    eventType: classifyEvent(title, content),
    relevance: titleHit ? "标题直接命中" : "正文提及",
  };
}

export function parseNewsRows(payload: NewsResponse, name: string, symbol: string) {
  const code = symbol.slice(0, 6);
  const rows = payload.result?.cmsArticleWebOld ?? [];
  const unique = new Map<string, NewsCandidate>();
  for (const row of rows) {
    const normalized = normalizeNewsRow(row, name, code);
    if (!normalized) continue;
    unique.set(normalized.url || normalized.title, normalized);
  }
  return [...unique.values()];
}

const EVENT_TERMS = ["业绩", "分红", "回购", "增持", "减持", "立案", "处罚", "诉讼", "董事会", "重大事项", "权益分派", "投资", "项目", "人事", "利润", "收入", "订单"];

function dateDistanceDays(left: string, right: string) {
  const milliseconds = Math.abs(Date.parse(left.slice(0, 10)) - Date.parse(right.slice(0, 10)));
  return Number.isFinite(milliseconds) ? milliseconds / 86_400_000 : Number.POSITIVE_INFINITY;
}

function bigrams(value: string, assetName: string) {
  const normalized = value.replaceAll(assetName, "").replace(/\d{6}/g, "").replace(/[^\p{Script=Han}A-Za-z0-9]/gu, "").toLowerCase();
  const output = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) output.add(normalized.slice(index, index + 2));
  return output;
}

function jaccard(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function verifyNewsRows(candidates: NewsCandidate[], assetName: string, announcements: StockFundamentalResult["announcements"] = []): VerifiedNews[] {
  return candidates.slice(0, 6).map((candidate) => {
    const combined = `${candidate.title} ${candidate.content}`;
    const sharedAnnouncement = announcements.find((announcement) => {
      if (dateDistanceDays(candidate.date, announcement.date) > 60) return false;
      return EVENT_TERMS.some((term) => combined.includes(term) && announcement.title.includes(term));
    });
    if (sharedAnnouncement) {
      const term = EVENT_TERMS.find((item) => combined.includes(item) && sharedAnnouncement.title.includes(item))!;
      return {
        title: candidate.title,
        date: candidate.date,
        source: candidate.source,
        url: candidate.url,
        eventType: candidate.eventType,
        relevance: candidate.relevance,
        verification: "公告主题支持",
        verificationDetail: `与${sharedAnnouncement.date}公司公告共享“${term}”主题；只核对到事件主题，不代表新闻中的全部数字均已证实。`,
        sourceCount: 1,
        supportUrl: sharedAnnouncement.mirrorUrl,
      };
    }
    const candidateBigrams = bigrams(`${candidate.title} ${candidate.content}`, assetName);
    const similarSources = new Set(candidates.filter((other) => (
      other.url !== candidate.url
      && other.source !== candidate.source
      && dateDistanceDays(candidate.date, other.date) <= 14
      && jaccard(candidateBigrams, bigrams(`${other.title} ${other.content}`, assetName)) >= 0.22
    )).map((other) => other.source));
    if (similarSources.size) {
      return {
        title: candidate.title,
        date: candidate.date,
        source: candidate.source,
        url: candidate.url,
        eventType: candidate.eventType,
        relevance: candidate.relevance,
        verification: "多家媒体相似报道",
        verificationDetail: `另有${similarSources.size}个不同媒体来源出现相似内容；这只能增强线索一致性，不能替代公司公告。`,
        sourceCount: similarSources.size + 1,
      };
    }
    return {
      title: candidate.title,
      date: candidate.date,
      source: candidate.source,
      url: candidate.url,
      eventType: candidate.eventType,
      relevance: candidate.relevance,
      verification: "单一媒体线索",
      verificationDetail: "尚未匹配到相关公司公告主题或第二家相似媒体来源，不能据此形成交易结论。",
      sourceCount: 1,
    };
  });
}

async function getNewsCandidates(name: string, symbol: string) {
  const request = {
    uid: "",
    keyword: name,
    type: ["cmsArticleWebOld"],
    client: "web",
    clientType: "web",
    clientVersion: "curr",
    param: { cmsArticleWebOld: { searchScope: "default", sort: "time", pageIndex: 1, pageSize: 12, preTag: "", postTag: "" } },
  };
  const url = new URL(NEWS_SEARCH_ENDPOINT);
  url.searchParams.set("cb", "callback");
  url.searchParams.set("param", JSON.stringify(request));
  const payload = parseNewsJsonp(await fetchText(url));
  if (payload.code !== 0) throw new Error(payload.msg || "NEWS_SEARCH_FAILED");
  return parseNewsRows(payload, name, symbol);
}

function policyScope(title: string) {
  if (/公募|基金|业绩比较基准|销售费用/.test(title)) return "基金行业";
  if (/上市公司|董事会|短线交易|创业板/.test(title)) return "上市公司/A股";
  if (/投资者/.test(title)) return "投资者保护";
  if (/证券|期货|衍生品/.test(title)) return "市场监管";
  return "资本市场";
}

export function parseCsrcPolicies(raw: string, assetType: "stock" | "fund" | "etf") {
  const list = raw.match(/<ul[^>]+id=["']list["'][^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
  const rows = [...list.matchAll(/<li[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*class=["'][^"']*date[^"']*["'][^>]*>\s*(\d{4}-\d{2}-\d{2})\s*<\/span>[\s\S]*?<\/li>/gi)];
  return rows.flatMap((match) => {
    const title = cleanText(match[2]);
    if (!title) return [];
    const scope = policyScope(title);
    const direct = assetType === "stock" ? scope === "上市公司/A股" : scope === "基金行业";
    return [{
      title,
      date: match[3],
      url: new URL(match[1], CSRC_POLICY_ENDPOINT).toString(),
      scope,
      relevance: direct ? "直接相关" as const : "市场通用" as const,
    }];
  }).slice(0, 8);
}

export async function getMarketContext(symbol: string, name: string, assetType: "stock" | "fund" | "etf") {
  if (!/^\d{6}(?:\.(?:SH|SZ))?$/i.test(symbol)) throw new Error("INVALID_SYMBOL");
  const normalizedName = name.trim().slice(0, 80);
  if (normalizedName.length < 2) throw new Error("INVALID_NAME");
  const cacheKey = `${assetType}:${symbol.toUpperCase()}:${normalizedName}`;
  const cached = contextCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const [valuationResult, newsResult, policyResult, fundamentalResult] = await Promise.allSettled([
    assetType === "stock" ? getStockValuation(symbol) : getFundLookThrough(symbol, assetType),
    getNewsCandidates(normalizedName, symbol),
    fetchText(new URL(CSRC_POLICY_ENDPOINT)).then((raw) => parseCsrcPolicies(raw, assetType)),
    assetType === "stock" ? getFundamentals(symbol, "stock") : Promise.resolve(null),
  ]);
  const valuation = valuationResult.status === "fulfilled" ? valuationResult.value : null;
  const candidates = newsResult.status === "fulfilled" ? newsResult.value : [];
  const fundamentals = fundamentalResult.status === "fulfilled" && fundamentalResult.value?.kind === "stock" ? fundamentalResult.value : null;
  const news = verifyNewsRows(candidates, normalizedName, fundamentals?.announcements ?? []);
  const policies = policyResult.status === "fulfilled" ? policyResult.value : [];
  const warnings = [
    "新闻核验采用公告主题匹配和媒体文本相似度；主题匹配不等于新闻中的数字、因果关系和措辞全部得到证实。",
    "政策相关性由关键词规则标注，只表示适用范围，不证明政策会推动该标的上涨或下跌。",
  ];
  if (assetType === "stock") warnings.unshift(
    "历史分位只说明当前倍数在所示样本中的相对位置，不是择时信号，也不能直接推出‘便宜’或‘昂贵’。",
    "行业分类表示同一板块口径，不代表商业模式、增长质量和风险完全可比；亏损公司的非正PE已从PE统计中排除。",
    "公司行动、会计口径和盈利周期变化会改变估值分布，历史样本不可机械外推。",
  );
  else warnings.unshift(
    "穿透PE/PB只覆盖最近季度披露的前十大持仓及其中有效估值，不代表基金全部或当前实时组合。",
    "基金持仓披露日与估值日存在时间错位，因此不计算基金历史分位或同行排名。",
  );
  if (valuationResult.status === "rejected") warnings.push(`估值读取失败：${valuationResult.reason instanceof Error ? valuationResult.reason.message : "unknown"}`);
  if (newsResult.status === "rejected") warnings.push(`新闻搜索失败：${newsResult.reason instanceof Error ? newsResult.reason.message : "unknown"}`);
  if (policyResult.status === "rejected") warnings.push(`证监会政策列表读取失败：${policyResult.reason instanceof Error ? policyResult.reason.message : "unknown"}`);
  if (fundamentalResult.status === "rejected") warnings.push(`公告主题核验失败：${fundamentalResult.reason instanceof Error ? fundamentalResult.reason.message : "unknown"}`);
  const checks = [
    valuation ? `估值结构已取得：${valuation.kind === "stock" ? "股票历史与同行" : "基金持仓穿透"}` : "估值结构未取得",
    `资产相关新闻：${news.length}条；公告主题支持${news.filter((item) => item.verification === "公告主题支持").length}条，多媒体相似${news.filter((item) => item.verification === "多家媒体相似报道").length}条`,
    `证监会官方政策：${policies.length}条，其中直接相关${policies.filter((item) => item.relevance === "直接相关").length}条`,
  ];
  if (valuation?.kind === "stock") {
    checks.unshift(
      `历史估值：${valuation.history.sampleCount}个无重复交易日，区间${valuation.history.startDate}至${valuation.history.endDate}`,
      `历史有效样本：PE ${valuation.history.pe?.validCount ?? 0}个，PB ${valuation.history.pb?.validCount ?? 0}个`,
      valuation.peers ? `同行截面：${valuation.peers.asOf}同一板块${valuation.peers.totalCount}家公司，正PE ${valuation.peers.positivePeCount}家` : "同行截面未取得",
    );
  }
  const result: MarketContextResult = {
    valuation,
    news,
    policies,
    fetchedAt: new Date().toISOString(),
    quality: {
      checks,
      warnings,
      evidenceGrade: assetType === "stock" && valuation?.kind === "stock" && valuation.history.sampleCount >= 250 && valuation.peers ? "medium" : "low",
    },
  };
  if (contextCache.size >= 100) contextCache.delete(contextCache.keys().next().value ?? "");
  contextCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  return result;
}
