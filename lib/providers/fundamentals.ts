const STOCK_FINANCE_ENDPOINT = "https://datacenter.eastmoney.com/securities/api/data/v1/get";
const STOCK_ANNOUNCEMENT_ENDPOINT = "https://np-anotice-stock.eastmoney.com/api/security/ann";
const FUND_PROFILE_ENDPOINT = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNDetailInformation";
const FUND_HOLDINGS_ENDPOINT = "https://fundf10.eastmoney.com/FundArchivesDatas.aspx";
const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 30 * 60_000;
const fundamentalsCache = new Map<string, { expiresAt: number; value: FundamentalResult }>();

type FinanceRow = {
  REPORT_DATE?: string;
  REPORT_DATE_NAME?: string;
  REPORT_TYPE?: string;
  NOTICE_DATE?: string;
  CURRENCY?: string;
  TOTALOPERATEREVE?: number | null;
  PARENTNETPROFIT?: number | null;
  TOTALOPERATEREVETZ?: number | null;
  PARENTNETPROFITTZ?: number | null;
  EPSJB?: number | null;
  ROEJQ?: number | null;
  XSMLL?: number | null;
  ZCFZL?: number | null;
};

type FinanceResponse = {
  success?: boolean;
  message?: string;
  result?: { data?: FinanceRow[] } | null;
};

type AnnouncementItem = {
  art_code?: string;
  notice_date?: string;
  title?: string;
  columns?: Array<{ column_name?: string }>;
};

type AnnouncementResponse = {
  success?: number;
  error?: string;
  data?: { list?: AnnouncementItem[] } | null;
};

type FundProfileData = {
  FCODE?: string;
  SHORTNAME?: string;
  FULLNAME?: string;
  FTYPE?: string;
  ESTABDATE?: string;
  FEGMRQ?: string;
  JJGS?: string;
  TGYH?: string;
  JJJL?: string;
  MGREXP?: string;
  TRUSTEXP?: string;
  SALESEXP?: string;
  BENCH?: string;
  INVTGT?: string;
};

type FundProfileResponse = {
  Success?: boolean;
  ErrMsg?: string | null;
  Datas?: FundProfileData | null;
};

export type StockFundamentalResult = {
  kind: "stock";
  financials: Array<{
    reportName: string;
    reportDate: string;
    noticeDate: string;
    currency: string;
    revenue: number | null;
    revenueYoy: number | null;
    netProfit: number | null;
    netProfitYoy: number | null;
    eps: number | null;
    roe: number | null;
    grossMargin: number | null;
    debtRatio: number | null;
  }>;
  announcements: Array<{
    title: string;
    date: string;
    category: string;
    mirrorUrl: string;
  }>;
  quality: {
    checks: string[];
    warnings: string[];
    evidenceGrade: "medium";
  };
};

export type FundFundamentalResult = {
  kind: "fund";
  profile: {
    code: string;
    shortName: string;
    fullName: string;
    fundType: string;
    establishedDate: string;
    company: string;
    custodian: string;
    managers: string[];
    managementFeeRate: number | null;
    custodianFeeRate: number | null;
    salesServiceFeeRate: number | null;
    benchmark: string;
    objective: string;
  };
  holdings: Array<{
    rank: number;
    code: string;
    name: string;
    navPercent: number;
    sharesWan: number | null;
    marketValueWan: number | null;
  }>;
  holdingsAsOf: string | null;
  topHoldingsPercent: number | null;
  quality: {
    checks: string[];
    warnings: string[];
    evidenceGrade: "medium";
  };
};

export type FundamentalResult = StockFundamentalResult | FundFundamentalResult;

async function fetchJson<T>(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { accept: "application/json,text/plain,*/*", "user-agent": "JidangResearchTerminal/0.1", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`FUNDAMENTAL_HTTP_${response.status}`);
  return await response.json() as T;
}

async function fetchText(url: URL, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    headers: { accept: "text/plain,text/html,*/*", "user-agent": "JidangResearchTerminal/0.1", ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`FUNDAMENTAL_HTTP_${response.status}`);
  return await response.text();
}

function finiteOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function percentageOrNull(value: string | undefined) {
  if (!value || value === "--") return null;
  return finiteOrNull(value.replace("%", ""));
}

function secuCode(symbol: string) {
  const code = symbol.slice(0, 6);
  const suffix = symbol.slice(7).toUpperCase();
  return `${code}.${suffix || (/^6/.test(code) ? "SH" : "SZ")}`;
}

async function getStockFundamentals(symbol: string): Promise<StockFundamentalResult> {
  const code = symbol.slice(0, 6);
  const financeUrl = new URL(STOCK_FINANCE_ENDPOINT);
  financeUrl.searchParams.set("reportName", "RPT_F10_FINANCE_MAINFINADATA");
  financeUrl.searchParams.set("columns", "ALL");
  financeUrl.searchParams.set("filter", `(SECUCODE="${secuCode(symbol)}")`);
  financeUrl.searchParams.set("pageNumber", "1");
  financeUrl.searchParams.set("pageSize", "5");
  financeUrl.searchParams.set("sortTypes", "-1");
  financeUrl.searchParams.set("sortColumns", "REPORT_DATE");
  const announcementUrl = new URL(STOCK_ANNOUNCEMENT_ENDPOINT);
  announcementUrl.searchParams.set("sr", "-1");
  announcementUrl.searchParams.set("page_size", "6");
  announcementUrl.searchParams.set("page_index", "1");
  announcementUrl.searchParams.set("ann_type", "A");
  announcementUrl.searchParams.set("client_source", "web");
  announcementUrl.searchParams.set("stock_list", code);
  const [financePayload, announcementPayload] = await Promise.all([
    fetchJson<FinanceResponse>(financeUrl),
    fetchJson<AnnouncementResponse>(announcementUrl),
  ]);
  if (!financePayload.success || !financePayload.result?.data?.length) throw new Error(financePayload.message || "FINANCE_EMPTY");
  const rawFinance = financePayload.result.data;
  const uniqueDates = new Set(rawFinance.map((row) => row.REPORT_DATE?.slice(0, 10)));
  const currencies = new Set(rawFinance.map((row) => row.CURRENCY).filter(Boolean));
  const financials = rawFinance.map((row) => ({
    reportName: row.REPORT_DATE_NAME || row.REPORT_TYPE || "报告期未知",
    reportDate: row.REPORT_DATE?.slice(0, 10) || "",
    noticeDate: row.NOTICE_DATE?.slice(0, 10) || "",
    currency: row.CURRENCY || "CNY",
    revenue: finiteOrNull(row.TOTALOPERATEREVE),
    revenueYoy: finiteOrNull(row.TOTALOPERATEREVETZ),
    netProfit: finiteOrNull(row.PARENTNETPROFIT),
    netProfitYoy: finiteOrNull(row.PARENTNETPROFITTZ),
    eps: finiteOrNull(row.EPSJB),
    roe: finiteOrNull(row.ROEJQ),
    grossMargin: finiteOrNull(row.XSMLL),
    debtRatio: finiteOrNull(row.ZCFZL),
  }));
  const announcements = (announcementPayload.data?.list ?? []).flatMap((item) => {
    if (!item.art_code || !item.title || !item.notice_date) return [];
    return [{
      title: item.title,
      date: item.notice_date.slice(0, 10),
      category: item.columns?.map((column) => column.column_name).filter(Boolean).join("、") || "未分类",
      mirrorUrl: `https://pdf.dfcfw.com/pdf/H2_${item.art_code}_1.pdf`,
    }];
  });
  return {
    kind: "stock",
    financials,
    announcements,
    quality: {
      checks: [
        `取得${financials.length}个报告期，报告期日期${uniqueDates.size === rawFinance.length ? "无重复" : "存在重复"}`,
        `币种字段：${[...currencies].join("、") || "缺失"}`,
        `取得${announcements.length}条最近公告标题和原文镜像入口`,
      ],
      warnings: [
        "财务数据为第三方结构化摘要，使用前应与公司正式定期报告交叉核验。",
        "一季报、中报和三季报金额通常为年初至报告期末累计值，不能直接当作单季度金额比较。",
        "公告链接为公开原文镜像，不代表交易所授权数据接口。",
      ],
      evidenceGrade: "medium",
    },
  };
}

function decodeCell(html: string) {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .trim();
}

export function parseFundHoldings(raw: string) {
  const cutoff = raw.match(/截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/)?.[1] ?? null;
  const body = raw.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].flatMap((rowMatch) => {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeCell(cell[1]));
    const code = cells[1] ?? "";
    const navPercent = finiteOrNull((cells[6] ?? "").replace("%", ""));
    if (!/^\d{6}$/.test(code) || navPercent === null || navPercent < 0 || navPercent > 100) return [];
    return [{
      rank: Number(cells[0]),
      code,
      name: cells[2] || "名称缺失",
      navPercent,
      sharesWan: finiteOrNull((cells[7] ?? "").replaceAll(",", "")),
      marketValueWan: finiteOrNull((cells[8] ?? "").replaceAll(",", "")),
    }];
  });
  return { cutoff, rows };
}

async function getFundFundamentals(symbol: string): Promise<FundFundamentalResult> {
  const code = symbol.slice(0, 6);
  const profileUrl = new URL(FUND_PROFILE_ENDPOINT);
  profileUrl.searchParams.set("FCODE", code);
  profileUrl.searchParams.set("deviceid", "Wap");
  profileUrl.searchParams.set("plat", "Wap");
  profileUrl.searchParams.set("product", "EFund");
  profileUrl.searchParams.set("version", "2.0.0");
  const holdingsUrl = new URL(FUND_HOLDINGS_ENDPOINT);
  holdingsUrl.searchParams.set("type", "jjcc");
  holdingsUrl.searchParams.set("code", code);
  holdingsUrl.searchParams.set("topline", "10");
  holdingsUrl.searchParams.set("year", "");
  holdingsUrl.searchParams.set("month", "");
  const [profilePayload, holdingsText] = await Promise.all([
    fetchJson<FundProfileResponse>(profileUrl),
    fetchText(holdingsUrl, { referer: `https://fundf10.eastmoney.com/jjcc_${code}.html` }),
  ]);
  const data = profilePayload.Datas;
  if (!profilePayload.Success || !data) throw new Error(profilePayload.ErrMsg || "FUND_PROFILE_EMPTY");
  const parsed = parseFundHoldings(holdingsText);
  const topHoldingsPercent = parsed.rows.length ? Math.round(parsed.rows.reduce((sum, row) => sum + row.navPercent, 0) * 100) / 100 : null;
  return {
    kind: "fund",
    profile: {
      code,
      shortName: data.SHORTNAME || "名称缺失",
      fullName: data.FULLNAME || data.SHORTNAME || "名称缺失",
      fundType: data.FTYPE || "类型缺失",
      establishedDate: data.ESTABDATE || "日期缺失",
      company: data.JJGS || "基金公司缺失",
      custodian: data.TGYH || "托管人缺失",
      managers: (data.JJJL || "").split(/[,，]/).map((name) => name.trim()).filter(Boolean),
      managementFeeRate: percentageOrNull(data.MGREXP),
      custodianFeeRate: percentageOrNull(data.TRUSTEXP),
      salesServiceFeeRate: percentageOrNull(data.SALESEXP),
      benchmark: data.BENCH || "业绩比较基准缺失",
      objective: data.INVTGT || "投资目标缺失",
    },
    holdings: parsed.rows,
    holdingsAsOf: parsed.cutoff,
    topHoldingsPercent,
    quality: {
      checks: [
        `基金代码与详情响应匹配：${data.FCODE === code ? "是" : "否"}`,
        `基金经理姓名数量：${(data.JJJL || "").split(/[,，]/).filter(Boolean).length}`,
        `解析最近一期前十大持仓：${parsed.rows.length}条`,
      ],
      warnings: [
        "持仓为季度披露快照，并非当前实时持仓；基金经理可在披露后调仓。",
        "前十大持仓占比不等于股票总仓位，也不能代表全部行业暴露。",
        "费率仅展示已返回的管理费、托管费或销售服务费，不含申购、赎回及平台折扣。",
        "基金经理任职期限接口未通过稳定性验证，因此不展示任职年限。",
      ],
      evidenceGrade: "medium",
    },
  };
}

export async function getFundamentals(symbol: string, assetType: "stock" | "fund" | "etf") {
  if (!/^\d{6}(?:\.(?:SH|SZ))?$/i.test(symbol)) throw new Error("INVALID_SYMBOL");
  const key = `${assetType}:${symbol.toUpperCase()}`;
  const cached = fundamentalsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = assetType === "stock" ? await getStockFundamentals(symbol) : await getFundFundamentals(symbol);
  if (fundamentalsCache.size >= 100) fundamentalsCache.delete(fundamentalsCache.keys().next().value ?? "");
  fundamentalsCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}
