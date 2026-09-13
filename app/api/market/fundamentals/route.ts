import { getAuthenticatedUser } from "@/lib/auth";
import { getFundamentals } from "@/lib/providers/fundamentals";

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
    const result = await getFundamentals(symbol, assetType);
    return Response.json({ result, dataMode: "public-web", provider: "东方财富公开网页数据" });
  } catch (error) {
    return Response.json({ error: `基本面证据暂不可用：${error instanceof Error ? error.message : "unknown"}` }, { status: 503 });
  }
}
