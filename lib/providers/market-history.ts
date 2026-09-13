import type { HistoricalPoint } from "@/lib/analysis/market-metrics";

const STOCK_HISTORY_ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const FUND_HISTORY_ENDPOINT = "https://api.fund.eastmoney.com/f10/lsjz";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 15 * 60_000;
const historyCache = new Map<string, { expiresAt: number; value: HistoryResult }>();

type StockHistoryResponse = {
  rc?: number;
  data?: { name?: string; code?: string; klines?: string[] } | null;
};

type FundHistoryRow = {
  FSRQ?: string;
  DWJZ?: string;
  LJJZ?: string;
};

type FundHistoryResponse = {
  TotalCount?: number;
  Data?: { LSJZList?: FundHistoryRow[] } | null;
};

export type HistoryResult = {
  points: HistoricalPoint[];
  source: string;
  basis: "前复权收盘价" | "累计净值";
  warning: string;
};

async function fetchJson<T>(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json,text/plain,*/*", "user-agent": "JidangResearchTerminal/0.1", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HISTORY_HTTP_${response.status}`);
  return await response.json() as T;
}
function securityId(symbol: string) {
  const code = symbol.slice(0, 6);
  const suffix = symbol.slice(7).toUpperCase();
  const isShanghai = suffix === "SH" || (!suffix && /^(5|6)/.test(code));
  return `${isShanghai ? "1" : "0"}.${code}`;
}

async function fetchExchangeHistory(symbol: string): Promise<HistoryResult> {
  const url = new URL(STOCK_HISTORY_ENDPOINT);
  url.searchParams.set("secid", securityId(symbol));
  url.searchParams.set("klt", "101");
  url.searchParams.set("fqt", "1");
  url.searchParams.set("lmt", "120");
  url.searchParams.set("end", "20500101");
  url.searchParams.set("fields1", "f1,f2,f3,f4,f5,f6");
  url.searchParams.set("fields2", "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61");
  const payload = await fetchJson<StockHistoryResponse>(url);
  if (payload.rc !== 0 || !payload.data?.klines?.length) throw new Error("STOCK_HISTORY_EMPTY");
  const points = payload.data.klines.map((line) => {
    const [date, open, close, high, low, volume] = line.split(",");
    return { date, open: Number(open), value: Number(close), high: Number(high), low: Number(low), volume: Number(volume) };
  }).filter((point) => Number.isFinite(point.value));
  return {
    points,
    source: "东方财富公开网页日线数据",
    basis: "前复权收盘价",
    warning: "免费接口无稳定性承诺；前复权价格用于连续收益比较，不等于当时真实成交价。",
  };
}

function fundPageUrl(code: string, pageIndex: number) {
  const url = new URL(FUND_HISTORY_ENDPOINT);
  url.searchParams.set("fundCode", code);
  url.searchParams.set("pageIndex", String(pageIndex));
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("startDate", "");
  url.searchParams.set("endDate", "");
  return url;
}

async function fetchFundPage(code: string, pageIndex: number) {
  return fetchJson<FundHistoryResponse>(fundPageUrl(code, pageIndex), { referer: "https://fundf10.eastmoney.com/" });
}

async function fetchFundHistory(symbol: string): Promise<HistoryResult> {
  const code = symbol.slice(0, 6);
  const first = await fetchFundPage(code, 1);
  const totalPages = Math.min(6, Math.max(1, Math.ceil((first.TotalCount ?? 0) / 20)));
  const rest = totalPages > 1 ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, index) => fetchFundPage(code, index + 2))) : [];
  const rows = [first, ...rest].flatMap((page) => page.Data?.LSJZList ?? []);
  const points = rows.map((row) => ({
    date: row.FSRQ ?? "",
    value: Number(row.LJJZ) > 0 ? Number(row.LJJZ) : Number(row.DWJZ),
  })).filter((point) => Number.isFinite(point.value) && point.value > 0).sort((left, right) => left.date.localeCompare(right.date));
  if (!points.length) throw new Error("FUND_HISTORY_EMPTY");
  return {
    points,
    source: "东方财富公开网页基金净值数据",
    basis: "累计净值",
    warning: "当前最多读取120个披露日，约覆盖半年；不能据此评价完整牛熊周期或一年稳定性。",
  };
}

export async function getMarketHistory(symbol: string, assetType: "stock" | "fund" | "etf") {
  if (!/^\d{6}(?:\.(?:SH|SZ))?$/i.test(symbol)) throw new Error("INVALID_SYMBOL");
  const key = `${assetType}:${symbol.toUpperCase()}`;
  const cached = historyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = assetType === "fund" ? await fetchFundHistory(symbol) : await fetchExchangeHistory(symbol);
  if (historyCache.size >= 100) historyCache.delete(historyCache.keys().next().value ?? "");
  historyCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
