import type { DeepSeekEvidence } from "./deepseek.ts";
import type { PersonalResearchReport, ReportAiNarrative } from "../report-engine.ts";

type RawNarrative = {
  symbol?: unknown;
  conclusion?: unknown;
  why_consider?: unknown;
  why_not?: unknown;
  scenarios?: unknown;
  terms?: unknown;
  evidence_ids?: unknown;
};

type RawReportAnalysis = {
  overall_summary?: unknown;
  allocation_explanation?: unknown;
  candidates?: unknown;
};

function text(value: unknown, fallback = "数据不足") {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 800) : fallback;
}

function textList(value: unknown, limit = 4) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 500)).slice(0, limit) : [];
}

export function collectReportEvidence(report: PersonalResearchReport, limit = 30) {
  const selected: DeepSeekEvidence[] = [];
  const seen = new Set<string>();
  const candidates = report.candidates.filter((candidate) => candidate.evidenceRefs.length > 0);
  for (const candidate of candidates) {
    const first = candidate.evidenceRefs[0];
    if (!seen.has(first.id)) {
      selected.push(first);
      seen.add(first.id);
    }
  }
  for (const candidate of candidates) {
    for (const evidence of candidate.evidenceRefs.slice(1)) {
      if (selected.length >= limit) break;
      if (!seen.has(evidence.id)) {
        selected.push(evidence);
        seen.add(evidence.id);
      }
    }
  }
  return selected.slice(0, limit);
}

function parseNarratives(raw: RawReportAnalysis, report: PersonalResearchReport, evidence: DeepSeekEvidence[]) {
  const allowedSymbols = report.candidates.map((candidate) => candidate.symbol);
  const allowedEvidence = new Set(evidence.map((item) => item.id));
  const rows = Array.isArray(raw.candidates) ? raw.candidates as RawNarrative[] : [];
  const output: ReportAiNarrative[] = [];
  const seenSymbols = new Set<string>();
  for (const row of rows) {
    const rawSymbol = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
    const symbol = allowedSymbols.find((candidate) => candidate.toUpperCase() === rawSymbol || candidate.slice(0, 6) === rawSymbol.slice(0, 6)) ?? "";
    if (!symbol || seenSymbols.has(symbol)) continue;
    const evidenceIds = textList(row.evidence_ids, 8).filter((id) => allowedEvidence.has(id));
    if (!evidenceIds.length) continue;
    const scenarios = Array.isArray(row.scenarios) ? row.scenarios.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      return [{ name: text(value.name, "未命名情景"), condition: text(value.condition), expectation: text(value.expectation) }];
    }).slice(0, 3) : [];
    const terms = Array.isArray(row.terms) ? row.terms.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const value = item as Record<string, unknown>;
      const term = text(value.term, "");
      const explanation = text(value.explanation, "");
      return term && explanation ? [{ term, explanation }] : [];
    }).slice(0, 5) : [];
    output.push({
      symbol,
      conclusion: text(row.conclusion),
      whyConsider: textList(row.why_consider),
      whyNot: textList(row.why_not),
      scenarios,
      terms,
      evidenceIds,
    });
    seenSymbols.add(symbol);
  }
  return output;
}

function deterministicPayload(report: PersonalResearchReport) {
  return {
    trading_date: report.tradingDate,
    rule_conclusion: report.conclusion,
    risk_boundary: report.riskBoundary,
    allocation_plan: report.allocationPlan,
    immutable_rules: {
      score_is_probability: false,
      ai_may_change_score_or_eligibility: false,
      stocks_are_simulation_only: true,
      candidate_limits: "最多3只A股/ETF和2只基金",
    },
    candidates: report.candidates.map((candidate) => ({
      symbol: candidate.symbol,
      name: candidate.name,
      asset_type: candidate.assetType,
      origin: candidate.origin,
      horizon: candidate.horizon,
      score: candidate.score,
      decision: candidate.decision,
      eligible: candidate.eligible,
      hard_blocks: candidate.hardBlocks,
      strengths: candidate.strengths,
      risks: candidate.risks,
      data_gaps: candidate.dataGaps,
      metrics: candidate.metrics,
      valuation: candidate.valuation,
      evidence_ids: candidate.evidenceRefs.map((item) => item.id),
    })),
  };
}

export async function enrichReportWithDeepSeek(userId: string, report: PersonalResearchReport): Promise<PersonalResearchReport> {
  const evidence = collectReportEvidence(report);
  const generatedAt = new Date().toISOString();
  if (!evidence.length) return {
    ...report,
    aiAnalysis: { status: "degraded", model: null, generatedAt, summary: "没有满足来源、链接和日期要求的证据，未调用DeepSeek。", allocationExplanation: report.allocationPlan?.basis ?? "没有可解释的配置结果。", narratives: [], usage: null, warning: "结构化证据为空" },
    warnings: [...report.warnings, "DeepSeek未调用：结构化证据为空。"],
  };
  try {
    const { DeepSeekServiceError, runDeepSeekEvidenceAnalysis } = await import("./deepseek.ts");
    const result = await runDeepSeekEvidenceAnalysis<RawReportAnalysis>({
      userId,
      subject: `${report.tradingDate}交易日前夜个人研究报告`,
      evidence,
      deterministicPayload: deterministicPayload(report),
      maxTokens: 6_000,
      systemInstruction: "你是资深基金经理视角的金融证据解释助手，但不是交易决策者。程序给出的score、decision、eligible、hard_blocks、风险上限和allocation_plan均为不可修改事实。只能依据evidence与deterministic_result解释为什么关注、为什么不关注、情景与术语；不得生成目标价、收益承诺、确定性涨跌判断或新增标的。A股只允许表述为模拟研究，场外基金期限为3—12个月。必须简洁：overall_summary不超过120字，allocation_explanation不超过100字；每个候选conclusion不超过80字，why_consider最多2条、why_not最多2条，每条不超过50字；scenarios最多2个，每个condition和expectation不超过50字；terms最多2个，每个解释不超过45字；evidence_ids最多4个。严格输出纯JSON，不要Markdown代码框或前后说明：{overall_summary:string,allocation_explanation:string,candidates:[{symbol:string,conclusion:string,why_consider:string[],why_not:string[],scenarios:[{name:string,condition:string,expectation:string}],terms:[{term:string,explanation:string}],evidence_ids:string[]}]}. 每个候选只引用输入中存在的evidence_ids；证据不足就明确写数据不足。",
    });
    const narratives = parseNarratives(result.analysis, report, evidence);
    if (!narratives.length) throw new DeepSeekServiceError("INVALID_JSON", "DeepSeek输出没有可验证的候选证据引用", 502);
    return {
      ...report,
      aiAnalysis: {
        status: "success",
        model: result.model,
        generatedAt: result.generatedAt,
        summary: text(result.analysis.overall_summary, "DeepSeek未返回总括说明。"),
        allocationExplanation: text(result.analysis.allocation_explanation, report.allocationPlan?.basis ?? "配置解释缺失。"),
        narratives,
        usage: result.usage,
        warning: "DeepSeek只解释程序结果，不参与评分、候选资格、价格或回撤计算。",
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return {
      ...report,
      aiAnalysis: { status: "degraded", model: null, generatedAt, summary: `DeepSeek解释层已降级：${message}`, allocationExplanation: report.allocationPlan?.basis ?? "配置解释缺失。", narratives: [], usage: null, warning: message },
      warnings: [...report.warnings, `DeepSeek解释层降级：${message}`],
    };
  }
}
