import { getAuthenticatedUser } from "@/lib/auth";
import { getMarketContext } from "@/lib/providers/market-context";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const name = url.searchParams.get("name")?.trim() ?? "";
  const assetType = url.searchParams.get("type") as "stock" | "fund" | "etf" | null;
  if (!/^\d{6}(?:\.(?:SH|SZ))?$/.test(symbol) || name.length < 2 || name.length > 80 || !assetType || !["stock", "fund", "etf"].includes(assetType)) {
    return Response.json({ error: "证券代码、名称或资产类型无效" }, { status: 400 });
  }
  try {
    const result = await getMarketContext(symbol, name, assetType);
    return Response.json({
      result,
      dataMode: "public-web",
      providers: ["东方财富公开网页数据", "中国证监会官网"],
    });
  } catch (error) {
    return Response.json({ error: `新闻、政策与估值证据暂不可用：${error instanceof Error ? error.message : "unknown"}` }, { status: 503 });
  }
}
