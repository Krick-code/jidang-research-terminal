"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/lib/demo-data";
import type { PersonalResearchReport, ReportAiNarrative, ReportCandidate } from "@/lib/report-engine";

type StoredReport = {
  id: string;
  version?: number;
  status: string;
  integrityHash?: string;
  lockedAt?: string | null;
  payload: PersonalResearchReport;
};

function candidateAsset(candidate: ReportCandidate): Asset {
  const zone = candidate.observationZone ? `${candidate.observationZone.low.toFixed(3)}—${candidate.observationZone.high.toFixed(3)}（模拟观察）` : "未通过门槛，不设置观察区间";
  return {
    symbol: candidate.symbol,
    name: candidate.name,
    type: candidate.assetType,
    market: candidate.market,
    sector: candidate.sector,
    price: candidate.latestValue === null ? "最新值缺失" : `${candidate.latestValue.toFixed(3)} · ${candidate.priceAsOf ?? "日期缺失"}`,
    change: candidate.metrics?.return5 ?? 0,
    status: candidate.decision,
    confidence: candidate.score,
    scoreKind: "rules",
    horizon: candidate.horizon,
    range: zone,
    invalidation: candidate.invalidationReference ? `${candidate.invalidationReference.price.toFixed(3)}；${candidate.invalidationReference.explanation}` : candidate.hardBlocks.join("；") || "证据不足时退出观察",
    thesis: candidate.strengths.join("；"),
    counter: [...candidate.risks, ...candidate.dataGaps].join("；"),
    sourceState: "live",
  };
}

function scoreText(candidate: ReportCandidate) {
  const components = candidate.scoreComponents;
  return `数据${components.data} · 趋势${components.trend} · 动量${components.momentum} · 风险${components.risk} · 估值${components.valuation} · 事件${components.event}`;
}

function formatShanghaiTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date).replaceAll("/", "-");
}

function AiNarrativeBlock({ candidate, narrative }: { candidate: ReportCandidate; narrative?: ReportAiNarrative }) {
  if (!narrative) return null;
  const references = narrative.evidenceIds.flatMap((id) => {
    const ref = candidate.evidenceRefs?.find((item) => item.id === id);
    return ref ? [ref] : [];
  });
  return <section className="candidate-ai"><div className="candidate-ai-title"><b>DeepSeek证据解释</b><span>不修改规则评分</span></div><p>{narrative.conclusion}</p><div className="candidate-ai-columns"><div><b>为什么关注</b><ul>{narrative.whyConsider.map((item) => <li key={item}>{item}</li>)}</ul></div><div><b>为什么谨慎</b><ul>{narrative.whyNot.map((item) => <li key={item}>{item}</li>)}</ul></div></div>{narrative.scenarios.length ? <div className="candidate-ai-scenarios">{narrative.scenarios.map((item) => <span key={`${item.name}-${item.condition}`}><b>{item.name}</b>{item.condition}；{item.expectation}</span>)}</div> : null}{narrative.terms.length ? <p className="candidate-ai-terms"><b>术语解释</b>{narrative.terms.map((item) => `${item.term}：${item.explanation}`).join("；")}</p> : null}{references.length ? <p className="candidate-ai-sources"><b>引用证据</b>{references.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer">[{item.id}] {item.title}</a>)}</p> : null}</section>;
}

export function DailyReportPanel({ onOpen }: { onOpen: (asset: Asset) => void }) {
  const [report, setReport] = useState<StoredReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/reports")
      .then(async (response) => {
        const data = await response.json() as { report?: StoredReport | null; error?: string };
        if (!response.ok) throw new Error(data.error || `HTTP_${response.status}`);
        if (active) setReport(data.report ?? null);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "unknown"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const generate = async () => {
    setGenerating(true);
    setError("");
    try {
      const response = await fetch("/api/reports", { method: "POST" });
      const data = await response.json() as { report?: StoredReport; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error || `HTTP_${response.status}`);
      setReport(data.report);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "unknown");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <section className="daily-report panel"><p>正在读取个人锁定报告…</p></section>;
  return <section className="daily-report panel"><div className="daily-report-title"><div><p className="eyebrow">PRIVATE EVIDENCE REPORT</p><h2>{report?.payload.title ?? "尚未生成真实个人报告"}</h2><p>{report ? `自选${report.payload.watchlistCount}项 · 市场初筛${report.payload.marketShortlistCount ?? 0}项 · 深度分析${report.payload.analyzedCount}项 · A股/ETF候选${report.payload.stockCandidateCount ?? report.payload.candidates.filter((candidate) => candidate.eligible && candidate.assetType !== "fund").length}项 · 基金中期候选${report.payload.fundCandidateCount ?? report.payload.candidates.filter((candidate) => candidate.eligible && candidate.assetType === "fund").length}项 · 版本${report.version ?? 1}` : "报告读取你的隔离自选池、风险画像和公共市场初筛，不访问其他用户数据。"}</p></div><button className="primary-button" onClick={generate} disabled={generating}>{generating ? "正在逐项核验…" : report ? "重新生成研究快照" : "生成真实研究报告"}</button></div>{error && <div className="notice warn"><b>报告没有生成</b><span>{error}</span></div>}{report ? <>{report.payload.marketUniverse ? <div className="notice"><b>市场初筛范围</b><span>A股全市场{report.payload.marketUniverse.stockUniverseTotal}只，读取成交额前{report.payload.marketUniverse.stockRowsEvaluated}只；基金读取{report.payload.marketUniverse.fundRowsEvaluated}/{report.payload.marketUniverse.fundUniverseTotal}条。初筛不等于逐只完成基本面研究。</span></div> : null}{report.payload.allocationPlan ? <div className="report-allocation"><b>程序化研究配置</b><span>现金{report.payload.allocationPlan.cashPct}% · 基金{report.payload.allocationPlan.fundPct}% · A股模拟{report.payload.allocationPlan.stockSimulationPct}%</span><small>{report.payload.allocationPlan.basis}</small></div> : null}{report.payload.aiAnalysis ? <div className={`notice ai-status ${report.payload.aiAnalysis.status === "success" ? "" : "warn"}`}><b>{report.payload.aiAnalysis.status === "success" ? "DeepSeek已完成证据解释" : "DeepSeek解释层已降级"}</b><span>{report.payload.aiAnalysis.summary} {report.payload.aiAnalysis.allocationExplanation}{report.payload.aiAnalysis.usage ? `；今日累计请求${report.payload.aiAnalysis.usage.requestCount}次，输入${report.payload.aiAnalysis.usage.inputTokens} Token，输出${report.payload.aiAnalysis.usage.outputTokens} Token。` : ""}</span></div> : null}<div className={`report-conclusion ${report.payload.candidateCount ? "has-candidate" : "no-candidate"}`}><b>{report.payload.candidateCount ? "有标的通过程序门槛" : "本次不强行推荐"}</b><span>{report.payload.conclusion}</span></div>{report.payload.candidates.length ? <div className="report-candidate-list">{report.payload.candidates.map((candidate) => <article key={`${candidate.symbol}-${candidate.rank}`} className={candidate.eligible ? "eligible" : ""}><header><span><em>#{candidate.rank}</em><b>{candidate.name}</b><small>{candidate.symbol} · {candidate.assetType === "stock" ? "A股模拟" : candidate.assetType === "etf" ? "ETF" : "场外公募中期"} · {candidate.origin === "market-universe" ? "市场初筛" : "我的自选"}</small></span><div><strong>{candidate.score}</strong><small>规则评分/100</small></div></header><div className="candidate-decision"><b>{candidate.decision}</b><span>{scoreText(candidate)}</span></div><div className="candidate-reasons"><p><b>支持证据</b>{candidate.strengths.join("；")}</p><p><b>主要风险</b>{[...candidate.risks, ...candidate.dataGaps].join("；")}</p></div><AiNarrativeBlock candidate={candidate} narrative={report.payload.aiAnalysis?.narratives.find((item) => item.symbol === candidate.symbol)} />{candidate.note ? <p className="candidate-zone"><b>进入研究池原因</b>{candidate.note}</p> : null}{candidate.observationZone ? <p className="candidate-zone"><b>模拟观察区间</b>{candidate.observationZone.low.toFixed(3)}—{candidate.observationZone.high.toFixed(3)}；{candidate.observationZone.label}</p> : null}{candidate.hardBlocks.length ? <p className="candidate-blocks">硬性限制：{candidate.hardBlocks.join("；")}</p> : null}<button className="text-action" onClick={() => onOpen(candidateAsset(candidate))}>展开标的完整数据层 →</button></article>)}</div> : <div className="empty compact"><h3>没有可分析结果</h3><p>检查自选池、市场初筛状态和公开数据连接；不要把空结果理解为低风险。</p></div>}{report.payload.skipped.length ? <div className="skipped-list"><b>跳过记录</b>{report.payload.skipped.map((item) => <span key={`${item.symbol}-${item.reason}`}>{item.symbol}：{item.reason}</span>)}</div> : null}<footer className="report-lock"><span>生成 {formatShanghaiTime(report.payload.generatedAt)} · 关键字段与AI解释共同锁定</span><small>{report.integrityHash ? `完整性摘要 ${report.integrityHash.slice(0, 12)}…` : "新生成结果将在重新读取后显示完整性摘要"}</small></footer></> : <div className="empty compact"><h3>先生成第一份研究报告</h3><p>系统会合并你的自选池与公共市场初筛；没有标的通过硬门槛时，结论就是等待。</p></div>}</section>;
}
