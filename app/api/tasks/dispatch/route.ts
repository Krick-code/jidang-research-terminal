import { getRuntimeEnv } from "@/lib/runtime-env";
import { runEveningReport, runPreopenSupplement, runWeeklyReview } from "@/lib/tasks";

export async function POST(request: Request) {
  const secret = getRuntimeEnv().TASK_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || authorization !== `Bearer ${secret}`) return Response.json({ error: "无权执行任务" }, { status: 401 });
  const body = await request.json() as { task?: string; now?: string };
  const now = body.now ? new Date(body.now) : new Date();
  if (Number.isNaN(now.getTime())) return Response.json({ error: "now格式无效" }, { status: 400 });
  if (body.task === "daily-evening") return Response.json(await runEveningReport(now));
  if (body.task === "preopen") return Response.json(await runPreopenSupplement(now));
  if (body.task === "weekly-review") return Response.json(await runWeeklyReview(now));
  return Response.json({ error: "未知任务" }, { status: 400 });
}
