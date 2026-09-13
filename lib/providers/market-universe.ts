const STOCK_LIST_ENDPOINTS = [
  "https://82.push2.eastmoney.com/api/qt/clist/get",
  "https://17.push2.eastmoney.com/api/qt/clist/get",
  "https://push2.eastmoney.com/api/qt/clist/get",
  "https://push2delay.eastmoney.com/api/qt/clist/get",
];
const FUND_RANK_ENDPOINT = "https://fund.eastmoney.com/data/rankhandler.aspx";
const FUND_DIRECTORY_ENDPOINT = "https://fund.eastmoney.com/js/fundcode_search.js";
const REQUEST_TIMEOUT_MS = 25_000;
const CACHE_TTL_MS = 30 * 60_000;

export type MarketUniverseItem = {
  symbol: string;
  assetType: "stock" | "fund" | "etf";
  note: string;
  origin: "market-universe";
};

export type MarketUniverseSnapshot = {
  items: MarketUniverseItem[];
  source: string;
  asOf: string;
  stockUniverseTotal: number;
  stockRowsEvaluated: number;
  fundUniverseTotal: number;
  fundRowsEvaluated: number;
  checks: string[];
  warnings: string[];
};

type StockRow = {
  f2?: number | null;
  f3?: number | null;
  f6?: number | null;
  f8?: number | null;
  f9?: number | null;
  f12?: string | null;
  f14?: string | null;
  f20?: number | null;
  f124?: number | null;
};

type StockListResponse = {
  rc?: number;
  data?: { total?: number; diff?: StockRow[] } | null;
};

export type FundDirectoryRow = {
  code: string;
  name: string;
  type: string;
};

export type FundRankRow = {
  code: string;
  name: string;
  date: string;
  return3m: number | null;
  return6m: number | null;
  return1y: number | null;
};

let cached: { expiresAt: number; value: MarketUniverseSnapshot } | null = null;

function finite(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

async function fetchText(url: URL | string, referer: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "application/json,text/plain,*/*",
          referer,
          "user-agent": "Mozilla/5.0 JidangResearchTerminal/0.2",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`MARKET_UNIVERSE_HTTP_${response.status}`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("MARKET_UNIVERSE_FETCH_FAILED");
}

function stockSymbol(code: string) {
  return /^(5|6|688|689)/.test(code) ? `${code}.SH` : `${code}.SZ`;
}

export function selectStockUniverse(rows: StockRow[], limit = 6): MarketUniverseItem[] {
  return rows
    .map((row) => {
      const code = row.f12?.trim() ?? "";
      const name = row.f14?.trim() ?? "";
      const price = finite(row.f2);
      const change = finite(row.f3);
      const amount = finite(row.f6);
      const turnover = finite(row.f8);
      const pe = finite(row.f9);
      const marketCap = finite(row.f20);
      if (!/^\d{6}$/.test(code) || !name || /(?:ST|退)/i.test(name)) return null;
      if (price === null || price <= 0 || price > 9.5) return null;
      if (change === null || change < -5 || change > 5) return null;
      if (amount === null || amount < 300_000_000) return null;
      if (turnover === null || turnover < 0.3 || turnover > 10) return null;
      if (pe === null || pe <= 0 || pe > 80) return null;
      if (marketCap === null || marketCap < 5_000_000_000) return null;
      const liquidity = Math.min(35, Math.log10(amount / 100_000_000 + 1) * 22);
      const turnoverFit = Math.max(0, 20 - Math.abs(turnover - 3) * 3);
      const changeFit = Math.max(0, 20 - Math.abs(change) * 4);
      const valuationFit = Math.max(0, 15 - Math.abs(pe - 25) * 0.4);
      const capitalFit = Math.max(0, 10 - Math.max(0, price - 7) * 3);
      const score = rounded(liquidity + turnoverFit + changeFit + valuationFit + capitalFit);
      return {
        item: {
          symbol: stockSymbol(code),
          assetType: "stock" as const,
          origin: "market-universe" as const,
          note: `市场流动性初筛：成交额${rounded(amount / 100_000_000)}亿元、换手率${rounded(turnover)}%、当日涨跌${rounded(change)}%、PE TTM ${rounded(pe)}；按100股估算最低交易金额约${Math.ceil(price * 100)}元。初筛分${score}，不代表预期收益。`,
        },
        score,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) => right.score - left.score || left.item.symbol.localeCompare(right.item.symbol))
    .slice(0, limit)
    .map((entry) => entry.item);
}

export function parseFundDirectory(text: string): FundDirectoryRow[] {
  const normalized = text.replace(/^\uFEFF/, "").trim();
  const start = normalized.indexOf("[");
  const end = normalized.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("FUND_DIRECTORY_FORMAT_INVALID");
  const rows = JSON.parse(normalized.slice(start, end + 1)) as unknown[][];
  return rows.flatMap((row) => {
    const code = String(row[0] ?? "").trim();
    const name = String(row[2] ?? "").trim();
    const type = String(row[3] ?? "").trim();
    return /^\d{6}$/.test(code) && name && type ? [{ code, name, type }] : [];
  });
}

export function parseFundRankPage(text: string) {
  const match = text.match(/datas:(\[[\s\S]*\]),allRecords:(\d+)/);
  if (!match) throw new Error("FUND_RANK_FORMAT_INVALID");
  const rawRows = JSON.parse(match[1]) as string[];
  const rows: FundRankRow[] = rawRows.flatMap((raw) => {
    const columns = raw.split(",");
    const code = columns[0]?.trim() ?? "";
    const name = columns[1]?.trim() ?? "";
    if (!/^\d{6}$/.test(code) || !name) return [];
    return [{
      code,
      name,
      date: columns[3]?.trim() ?? "",
      return3m: finite(columns[9]),
      return6m: finite(columns[10]),
      return1y: finite(columns[11]),
    }];
  });
  return { rows, allRecords: Number(match[2]) };
}

function canonicalFundName(name: string) {
  return name
    .replace(/[（(]后端[）)]/g, "")
    .replace(/(?:A|B|C|D|E|H|I|R|Y|A类|B类|C类|E类)$/i, "")
    .trim();
}

export function selectFundUniverse(rankRows: FundRankRow[], directoryRows: FundDirectoryRow[], limit = 4): MarketUniverseItem[] {
  const directory = new Map(directoryRows.map((row) => [row.code, row]));
  const seen = new Set<string>();
  return rankRows
    .map((rank) => {
      const meta = directory.get(rank.code);
      if (!meta) return null;
      const identity = `${rank.name} ${meta.type}`;
      if (!/(?:股票型|混合型|指数型)/.test(meta.type)) return null;
      if (/(?:货币|债券|QDII|FOF|REIT|黄金|原油|商品|后端)/i.test(identity)) return null;
      if (/(?:C|E|H|I|R|Y|C类|E类)$/i.test(rank.name)) return null;
      if (rank.return3m === null || rank.return6m === null) return null;
      if (rank.return3m < -5 || rank.return3m > 25 || rank.return6m < -10 || rank.return6m > 45) return null;
      if (rank.return1y !== null && (rank.return1y < -20 || rank.return1y > 80)) return null;
      const canonical = canonicalFundName(rank.name);
      if (!canonical || seen.has(canonical)) return null;
      const threeMonthFit = Math.max(0, 35 - Math.abs(rank.return3m - 8) * 2);
      const sixMonthFit = Math.max(0, 35 - Math.abs(rank.return6m - 15));
      const oneYearFit = rank.return1y === null ? 8 : Math.max(0, 20 - Math.abs(rank.return1y - 25) * 0.4);
      const broadBonus = /沪深300|中证A500|中证500|中证800|全指|红利|价值/.test(rank.name) ? 10 : 0;
      const score = rounded(threeMonthFit + sixMonthFit + oneYearFit + broadBonus);
      return { rank, meta, canonical, score };
    })
    .filter((entry): entry is { rank: FundRankRow; meta: FundDirectoryRow; canonical: string; score: number } => entry !== null)
    .sort((left, right) => right.score - left.score || left.rank.code.localeCompare(right.rank.code))
    .filter((entry) => {
      if (seen.has(entry.canonical)) return false;
      seen.add(entry.canonical);
      return true;
    })
    .slice(0, limit)
    .map(({ rank, meta, score }) => ({
      symbol: rank.code,
      assetType: "fund" as const,
      origin: "market-universe" as const,
      note: `基金市场初筛：${meta.type}，近3月${rounded(rank.return3m!)}%、近6月${rounded(rank.return6m!)}%${rank.return1y === null ? "、近1年数据缺失" : `、近1年${rounded(rank.return1y)}%`}；初筛分${score}，已排除过热区间和重复份额，仍须通过中期回撤、持仓与估值核验。`,
    }));
}

function oneYearAgo(date: Date) {
  const copy = new Date(date);
  copy.setUTCFullYear(copy.getUTCFullYear() - 1);
  return copy.toISOString().slice(0, 10);
}

async function fetchStockSnapshot() {
  const failures: string[] = [];
  for (const endpoint of STOCK_LIST_ENDPOINTS) {
    try {
      const url = new URL(endpoint);
      Object.entries({
        pn: "1",
        pz: "100",
        po: "1",
        np: "1",
        fltt: "2",
        invt: "2",
        fid: "f6",
        fs: "m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23",
        fields: "f2,f3,f6,f8,f9,f12,f14,f20,f124",
      }).forEach(([key, value]) => url.searchParams.set(key, value));
      const text = await fetchText(url, "https://quote.eastmoney.com/center/gridlist.html");
      const payload = JSON.parse(text) as StockListResponse;
      if (payload.rc !== 0 || !payload.data?.diff?.length) throw new Error("STOCK_UNIVERSE_EMPTY");
      return { rows: payload.data.diff, total: payload.data.total ?? payload.data.diff.length, endpointHost: url.host };
    } catch (error) {
      failures.push(`${new URL(endpoint).host}:${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  throw new Error(`STOCK_UNIVERSE_ALL_ENDPOINTS_FAILED(${failures.join("|")})`);
}

async function fetchFundSnapshot(now: Date) {
  const directoryPromise = fetchText(FUND_DIRECTORY_ENDPOINT, "https://fund.eastmoney.com/data/fundranking.html");
  const endDate = now.toISOString().slice(0, 10);
  const buildRankUrl = (page: number) => {
    const url = new URL(FUND_RANK_ENDPOINT);
    Object.entries({ op: "ph", dt: "kf", ft: "all", rs: "", gs: "0", sc: "3yzf", st: "desc", sd: oneYearAgo(now), ed: endDate, qdii: "", tabSubtype: ",,,,,", pi: String(page), pn: "20000", dx: "1", v: String(now.getTime()) }).forEach(([key, value]) => url.searchParams.set(key, value));
    return url;
  };
  const firstText = await fetchText(buildRankUrl(1), "https://fund.eastmoney.com/data/fundranking.html");
  const first = parseFundRankPage(firstText);
  const secondText = first.allRecords > first.rows.length
    ? await fetchText(buildRankUrl(2), "https://fund.eastmoney.com/data/fundranking.html")
    : null;
  const second = secondText ? parseFundRankPage(secondText) : { rows: [], allRecords: first.allRecords };
  const directory = parseFundDirectory(await directoryPromise);
  return { rows: [...first.rows, ...second.rows], allRecords: first.allRecords, directory };
}

export async function getMarketUniverseSnapshot(now = new Date()): Promise<MarketUniverseSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const asOf = now.toISOString();
  const stockResult = await fetchStockSnapshot()
    .then((value) => ({ status: "fulfilled" as const, value }))
    .catch((reason: unknown) => ({ status: "rejected" as const, reason }));
  const fundResult = await fetchFundSnapshot(now)
    .then((value) => ({ status: "fulfilled" as const, value }))
    .catch((reason: unknown) => ({ status: "rejected" as const, reason }));
  const warnings: string[] = [];
  const checks: string[] = [];
  let stockItems: MarketUniverseItem[] = [];
  let fundItems: MarketUniverseItem[] = [];
  let stockUniverseTotal = 0;
  let stockRowsEvaluated = 0;
  let fundUniverseTotal = 0;
  let fundRowsEvaluated = 0;
  if (stockResult.status === "fulfilled") {
    stockUniverseTotal = stockResult.value.total;
    stockRowsEvaluated = stockResult.value.rows.length;
    stockItems = selectStockUniverse(stockResult.value.rows);
    checks.push(`A股接口节点${stockResult.value.endpointHost}报告全市场${stockUniverseTotal}只；按成交额排序后读取前${stockRowsEvaluated}只流动性样本。`);
  } else warnings.push(`A股市场初筛降级：${stockResult.reason instanceof Error ? stockResult.reason.message : "unknown"}`);
  if (fundResult.status === "fulfilled") {
    fundUniverseTotal = fundResult.value.allRecords;
    fundRowsEvaluated = fundResult.value.rows.length;
    fundItems = selectFundUniverse(fundResult.value.rows, fundResult.value.directory);
    checks.push(`基金排行返回${fundRowsEvaluated}/${fundUniverseTotal}条记录，并与${fundResult.value.directory.length}条基金目录交叉匹配。`);
  } else warnings.push(`基金市场初筛降级：${fundResult.reason instanceof Error ? fundResult.reason.message : "unknown"}`);
  if (!stockItems.length) warnings.push("A股市场初筛没有产生可进入深度核验的标的；未用虚构数据补位。");
  if (!fundItems.length) warnings.push("基金市场初筛没有产生可进入深度核验的标的；未用虚构数据补位。");
  const value: MarketUniverseSnapshot = {
    items: [...stockItems, ...fundItems],
    source: "东方财富公开A股行情列表、开放式基金排行与基金目录",
    asOf,
    stockUniverseTotal,
    stockRowsEvaluated,
    fundUniverseTotal,
    fundRowsEvaluated,
    checks,
    warnings,
  };
  cached = { expiresAt: Date.now() + (warnings.length ? 60_000 : CACHE_TTL_MS), value };
  return value;
}
