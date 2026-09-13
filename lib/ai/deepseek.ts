import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiUsage } from "@/db/schema";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { parseJsonOutput } from "./json-output.ts";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-v4-flash";

export type DeepSeekEvidence = {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  excerpt: string;
};

export type DeepSeekUsage = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
};

export class DeepSeekServiceError extends Error {
  code: "NOT_CONFIGURED" | "DAILY_LIMIT" | "HTTP_ERROR" | "EMPTY_RESPONSE" | "OUTPUT_TRUNCATED" | "INVALID_JSON";
  status: number;

  constructor(code: "NOT_CONFIGURED" | "DAILY_LIMIT" | "HTTP_ERROR" | "EMPTY_RESPONSE" | "OUTPUT_TRUNCATED" | "INVALID_JSON", message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function validateEvidence(evidence: DeepSeekEvidence[]) {
  if (evidence.length < 1 || evidence.length > 30) throw new DeepSeekServiceError("INVALID_JSON", "需要1—30条结构化证据", 400);
  for (const item of evidence) {
    if (!item.id || !item.source || !/^https?:\/\//.test(item.url) || !/^\d{4}-\d{2}-\d{2}/.test(item.publishedAt)) {
      throw new DeepSeekServiceError("INVALID_JSON", "证据缺少编号、来源、有效链接或发布时间", 400);
    }
  }
}

async function saveUsage(userId: string, usageDate: string, current: typeof aiUsage.$inferSelect | undefined, inputTokens: number, outputTokens: number) {
  const db = getDb();
  const next = {
    requestCount: (current?.requestCount ?? 0) + 1,
    inputTokens: (current?.inputTokens ?? 0) + inputTokens,
    outputTokens: (current?.outputTokens ?? 0) + outputTokens,
  };
  if (current) await db.update(aiUsage).set(next).where(eq(aiUsage.id, current.id));
  else await db.insert(aiUsage).values({ id: crypto.randomUUID(), userId, usageDate, ...next, estimatedCostCny: 0 });
  return next;
}

export async function runDeepSeekEvidenceAnalysis<T>(input: {
  userId: string;
  subject: string;
  evidence: DeepSeekEvidence[];
  deterministicPayload: unknown;
  systemInstruction?: string;
  maxTokens?: number;
}) {
  const env = getRuntimeEnv();
  if (!env.DEEPSEEK_API_KEY) throw new DeepSeekServiceError("NOT_CONFIGURED", "DeepSeek尚未配置", 503);
  validateEvidence(input.evidence);
  const usageDate = shanghaiDate();
  const db = getDb();
  const [usage] = await db.select().from(aiUsage).where(and(eq(aiUsage.userId, input.userId), eq(aiUsage.usageDate, usageDate))).limit(1);
  const dailyLimit = Math.max(1, Math.min(50, Number(env.AI_DAILY_REQUEST_LIMIT ?? 10) || 10));
  if ((usage?.requestCount ?? 0) >= dailyLimit) throw new DeepSeekServiceError("DAILY_LIMIT", "今日主动分析额度已用完", 429);
  const response = await fetch(DEEPSEEK_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: "system",
          content: input.systemInstruction ?? "你是金融证据整理助手。只能依据输入证据和程序计算结果写作，不得补造行情、财务数字、目标价或政策影响。所有判断必须引用evidence_ids；证据不足时明确写数据不足。只输出JSON。",
        },
        {
          role: "user",
          content: JSON.stringify({ subject: input.subject, evidence: input.evidence, deterministic_result: input.deterministicPayload }),
        },
      ],
      thinking: { type: "enabled" },
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      max_tokens: Math.max(800, Math.min(6_000, input.maxTokens ?? 2_400)),
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new DeepSeekServiceError("HTTP_ERROR", `DeepSeek请求失败：${response.status}`, 502);
  const payload = await response.json() as {
    choices?: Array<{ finish_reason?: string | null; message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const inputTokens = payload.usage?.prompt_tokens ?? 0;
  const outputTokens = payload.usage?.completion_tokens ?? 0;
  const nextUsage = await saveUsage(input.userId, usageDate, usage, inputTokens, outputTokens);
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new DeepSeekServiceError("EMPTY_RESPONSE", "DeepSeek返回为空", 502);
  const parsed = parseJsonOutput<T>(content, payload.choices?.[0]?.finish_reason);
  if (!parsed.ok && parsed.reason === "truncated") throw new DeepSeekServiceError("OUTPUT_TRUNCATED", "DeepSeek输出达到长度上限，未生成完整JSON", 502);
  if (!parsed.ok) throw new DeepSeekServiceError("INVALID_JSON", "DeepSeek返回未通过JSON校验", 502);
  return { analysis: parsed.value, usage: nextUsage, model: DEEPSEEK_MODEL, generatedAt: new Date().toISOString() };
}
