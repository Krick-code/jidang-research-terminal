import { getAuthenticatedUser } from "@/lib/auth";
import { DeepSeekServiceError, runDeepSeekEvidenceAnalysis, type DeepSeekEvidence } from "@/lib/ai/deepseek";

type Evidence = DeepSeekEvidence;

export async function POST(request: Request) {
  const user = await getAuthenticatedUser(request);
  if (!user) return Response.json({ error: "未登录" }, { status: 401 });
  const body = await request.json() as { subject?: string; evidence?: Evidence[]; metrics?: Record<string, number | string> };
  if (!body.subject || !Array.isArray(body.evidence) || body.evidence.length < 1 || body.evidence.length > 30) return Response.json({ error: "需要1—30条结构化证据" }, { status: 400 });
  if (body.evidence.some((item) => !item.id || !item.source || !item.url || !item.publishedAt)) return Response.json({ error: "证据缺少来源、链接或发布时间" }, { status: 400 });
  try {
    const result = await runDeepSeekEvidenceAnalysis({
      userId: user.id,
      subject: body.subject,
      evidence: body.evidence,
      deterministicPayload: body.metrics ?? {},
      maxTokens: 1_800,
    });
    return Response.json({ ...result, note: "费用需按DeepSeek当期官方价格另行核算；Token用量已记录。" });
  } catch (error) {
    if (error instanceof DeepSeekServiceError) return Response.json({ error: error.message, degraded: true, code: error.code }, { status: error.status });
    return Response.json({ error: "DeepSeek调用失败", degraded: true }, { status: 502 });
  }
}
