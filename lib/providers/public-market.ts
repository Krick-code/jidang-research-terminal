const SEARCH_ENDPOINT = "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx";
const QUOTE_ENDPOINT = "https://push2.eastmoney.com/api/qt/stock/get";
const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const resultCache = new Map<string, { expiresAt: number; results: PublicMarketAsset[] }>();

type FundBaseInfo = {
  DWJZ?: number | string | null;
  FSRQ?: string | null;
  FTYPE?: string | null;
  JJGS?: string | null;
  JJJL?: string | null;
  MINSG?: number | string | null;
};

type SearchItem = {
  CODE?: string;
  NAME?: string;
  CATEGORYDESC?: string;
  STOCKMARKET?: string | null;
  NEWTEXCH?: string | null;
  FundBaseInfo?: FundBaseInfo | null;
};

type SearchResponse = {
  ErrCode?: number;
  ErrMsg?: string;
  Datas?: SearchItem[];
};

type QuoteData = {
  f43?: number | null;
  f57?: string | null;
  f58?: string | null;
  f59?: number | null;
  f86?: number | null;
  f170?: number | null;
};

type QuoteResponse = {
  rc?: number;
  data?: QuoteData | null;
};

export type PublicMarketAsset = {
  symbol: string;
  name: string;
  type: "stock" | "fund" | "etf";
  market: string;
  sector: string;
  price: string;
  change: number;
  status: string;
  confidence: number;
  horizon: string;
  range: string;
  invalidation: string;
  thesis: string;
  counter: string;
  sourceState: "live";
  sourceAsOf: string | null;
};

function qualifiedSymbol(code: string, stockMarket?: string | null) {
  if (stockMarket === "1") return `${code}.SH`;
  if (stockMarket === "2") return `${code}.SZ`;
  if (/^(5|6|688|689)/.test(code)) return `${code}.SH`;
  return `${code}.SZ`;
}

function quoteSecurityId(code: string, stockMarket?: string | null) {
  const market = stockMarket === "1" || (!stockMarket && /^(5|6|688|689)/.test(code)) ? "1" : "0";
  return `${market}.${code}`;
}

function isExchangeFund(code: string, item: SearchItem) {
  return /基金|ETF|LOF/i.test(item.CATEGORYDESC ?? "") || /^(15|16|18|50|51|52|56|58)/.test(code);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

async function fetchJson<T>(url: URL) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      "user-agent": "JidangResearchTerminal/0.1",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`PUBLIC_MARKET_HTTP_${response.status}`);
  return await response.json() as T;
}

export function parseFundAsset(item: SearchItem): PublicMarketAsset | null {
  const code = item.CODE?.trim();
  const name = item.NAME?.trim();
  const info = item.FundBaseInfo;
  if (!code || !/^\d{6}$/.test(code) || !name || !info) return null;
  const nav = Number(info.DWJZ);
  const hasNav = Number.isFinite(nav) && nav > 0;
  const isEtf = isExchangeFund(code, item) && item.STOCKMARKET !== null && item.STOCKMARKET !== undefined;
  return {
    symbol: isEtf ? qualifiedSymbol(code, item.STOCKMARKET) : code,
    name,
    type: isEtf ? "etf" : "fund",
    market: isEtf ? (item.STOCKMARKET === "1" ? "上交所" : "深交所") : "场外公募基金",
    sector: info.FTYPE || item.CATEGORYDESC || "基金",
    price: hasNav ? `${formatNumber(nav)}（单位净值 ${info.FSRQ || "日期未知"}）` : "净值暂缺",
    change: 0,
    status: "等待完整研究",
    confidence: 0,
    horizon: isEtf ? "1–2周 / 中期配置" : "3–12个月",
    range: "尚未生成入手区间",
    invalidation: "尚未完成基金经理、持仓、费率与回撤核验",
    thesis: "已取得基金基础信息和最近披露净值；这只能证明标的存在，不能单独形成买入结论。",
    counter: `免费公开数据无稳定性承诺；基金净值通常不是盘中实时价格。基金公司：${info.JJGS || "待核验"}。`,
    sourceState: "live",
    sourceAsOf: info.FSRQ || null,
  };
}

export function parseExchangeAsset(item: SearchItem, quote: QuoteData | null): PublicMarketAsset | null {
  const code = item.CODE?.trim();
  const name = quote?.f58?.trim() || item.NAME?.trim();
  if (!code || !/^\d{6}$/.test(code) || !name || !item.STOCKMARKET || item.FundBaseInfo || /指数|债券|期货|期权/.test(item.CATEGORYDESC ?? "")) return null;
  const decimals = Number.isInteger(quote?.f59) ? Math.max(0, Math.min(4, quote!.f59!)) : 2;
  const rawPrice = Number(quote?.f43);
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? rawPrice / 10 ** decimals : null;
  const rawChange = Number(quote?.f170);
  const change = Number.isFinite(rawChange) ? rawChange / 100 : 0;
  const quoteTime = Number(quote?.f86);
  const asOf = Number.isFinite(quoteTime) && quoteTime > 0 ? new Date(quoteTime * 1000).toISOString() : null;
  const type = isExchangeFund(code, item) ? "etf" : "stock";
  return {
    symbol: qualifiedSymbol(code, item.STOCKMARKET),
    name,
    type,
    market: item.STOCKMARKET === "1" ? "上交所" : "深交所",
    sector: item.CATEGORYDESC || (type === "etf" ? "场内基金" : "A股"),
    price: price === null ? "行情暂缺" : `${formatNumber(price)} · ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`,
    change,
    status: "等待完整研究",
    confidence: 0,
    horizon: type === "stock" ? "1–2周" : "1–2周 / 中期配置",
    range: "尚未生成入手区间",
    invalidation: "尚未完成公告、财务、估值、技术面和事件风险核验",
    thesis: "已取得证券身份与公开行情快照；行情数据本身不等于推荐理由。",
    counter: "免费公开网页接口没有稳定性承诺，价格必须以交易所或券商终端为准。",
    sourceState: "live",
    sourceAsOf: asOf,
  };
}

async function getQuote(item: SearchItem) {
  const code = item.CODE!;
  const url = new URL(QUOTE_ENDPOINT);
  url.searchParams.set("secid", quoteSecurityId(code, item.STOCKMARKET));
  url.searchParams.set("fields", "f43,f57,f58,f59,f86,f170");
  const payload = await fetchJson<QuoteResponse>(url);
  return payload.rc === 0 ? payload.data ?? null : null;
}

export async function searchPublicMarket(query: string) {
  const normalized = query.trim().replace(/\.(SH|SZ)$/i, "").slice(0, 32);
  if (!normalized) return [];
  const cacheKey = normalized.toLowerCase();
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("m", "1");
  url.searchParams.set("key", normalized);
  const payload = await fetchJson<SearchResponse>(url);
  if (payload.ErrCode !== 0) throw new Error(payload.ErrMsg || `PUBLIC_MARKET_CODE_${payload.ErrCode}`);
  const candidates = (payload.Datas ?? []).slice(0, 12);
  const results = await Promise.all(candidates.map(async (item) => {
    const fund = parseFundAsset(item);
    if (fund) return fund;
    if (!item.STOCKMARKET) return null;
    try {
      return parseExchangeAsset(item, await getQuote(item));
    } catch {
      return parseExchangeAsset(item, null);
    }
  }));
  const unique = new Map<string, PublicMarketAsset>();
  for (const asset of results) if (asset) unique.set(`${asset.type}:${asset.symbol}`, asset);
  const normalizedResults = [...unique.values()];
  if (resultCache.size >= 100) resultCache.delete(resultCache.keys().next().value ?? "");
  resultCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, results: normalizedResults });
  return normalizedResults;
}
