import { calculateMarketMetrics } from "@/lib/analysis/market-metrics";
import { getAuthenticatedUser } from "@/lib/auth";
import { getMarketHistory } from "@/lib/providers/market-history";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const assetType = url.searchParams.get("type") as "stock" | "fund" | "etf" | null;
  if (!/^\d{6}(?:\.(?:SH|SZ))?$/.test(symbol) || !assetType || !["stock", "fund", "etf"].includes(assetType)) {
    return Response.json({ error: "证券代码或资产类型无效" }, { status: 400 });
  }
  try {
    const history = await getMarketHistory(symbol, assetType);
    const metrics = calculateMarketMetrics(history.points);
    return Response.json({
      metrics,
      source: history.source,
      basis: history.basis,
      warning: history.warning,
      dataMode: "public-web",
    });
  } catch (error) {
    return Response.json({ error: `历史数据暂不可用：${error instanceof Error ? error.message : "unknown"}` }, { status: 503 });
  }
}
