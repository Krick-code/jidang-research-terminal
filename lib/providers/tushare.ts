import { getRuntimeEnv } from "@/lib/runtime-env";

type TushareResponse = { code: number; msg: string | null; data?: { fields: string[]; items: unknown[][] } };

export async function callTushare(apiName: string, params: Record<string, string>, fields: string) {
  const token = getRuntimeEnv().TUSHARE_TOKEN;
  if (!token) throw new Error("TUSHARE_TOKEN_NOT_CONFIGURED");
  const response = await fetch("https://api.tushare.pro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`TUSHARE_HTTP_${response.status}`);
  const payload = await response.json() as TushareResponse;
  if (payload.code !== 0 || !payload.data) throw new Error(payload.msg || `TUSHARE_CODE_${payload.code}`);
  return payload.data.items.map((item) => Object.fromEntries(payload.data!.fields.map((field, index) => [field, item[index]])));
}

export async function lookupByCode(code: string) {
  const suffix = code.startsWith("6") || code.startsWith("5") ? "SH" : "SZ";
  const tsCode = `${code}.${suffix}`;
  const [stocks, funds] = await Promise.allSettled([
    callTushare("stock_basic", { ts_code: tsCode, list_status: "L" }, "ts_code,symbol,name,area,industry,list_date"),
    callTushare("fund_basic", { ts_code: tsCode, market: "E" }, "ts_code,name,management,custodian,fund_type,found_date,list_date"),
  ]);
  return {
    stocks: stocks.status === "fulfilled" ? stocks.value : [],
    funds: funds.status === "fulfilled" ? funds.value : [],
    errors: [stocks, funds].filter((result) => result.status === "rejected").map((result) => result.status === "rejected" ? String(result.reason) : ""),
  };
}

export async function isTradingDay(date: string) {
  const rows = await callTushare("trade_cal", { exchange: "SSE", start_date: date, end_date: date }, "exchange,cal_date,is_open,pretrade_date");
  return rows[0]?.is_open === 1 || rows[0]?.is_open === "1";
}
