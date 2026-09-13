import { assets } from "@/lib/demo-data";
import { getAuthenticatedUser } from "@/lib/auth";
import { searchPublicMarket } from "@/lib/providers/public-market";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 32) return Response.json({ error: "请输入不超过32个字符的代码或名称" }, { status: 400 });
  try {
    const results = await searchPublicMarket(query);
    if (results.length) {
      return Response.json({
        results,
        dataMode: "public-web",
        provider: "东方财富公开网页数据",
        warning: "免费公开网页接口无稳定性承诺；行情须以交易所或券商终端为准，基金净值通常非盘中实时价格。",
      });
    }
    return Response.json({ results: [], dataMode: "public-web", provider: "东方财富公开网页数据", warning: "未找到匹配标的，请核对代码或名称。" });
  } catch (error) {
    const normalized = query.toLowerCase().replace(/\.(sh|sz)$/i, "");
    const fallback = assets.filter((asset) => `${asset.symbol}${asset.name}${asset.sector}`.toLowerCase().includes(normalized));
    return Response.json({
      results: fallback,
      dataMode: "demo",
      warning: `免费数据源暂不可用，已降级为演示索引：${error instanceof Error ? error.message : "unknown"}`,
    });
  }
}
