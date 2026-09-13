"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/lib/demo-data";
import type { MarketMetrics } from "@/lib/analysis/market-metrics";

type HistoryPayload = {
  metrics: MarketMetrics;
  source: string;
  basis: "前复权收盘价" | "累计净值";
  warning: string;
  dataMode: "public-web";
};

function percent(value: number | null) {
  if (value === null) return "样本不足";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function magnitudePercent(value: number | null) {
  if (value === null) return "样本不足";
  return `${Math.abs(value).toFixed(2)}%`;
}

function number(value: number | null) {
  if (value === null) return "样本不足";
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value);
}

const trendLabels: Record<MarketMetrics["trend"], string> = {
  up: "短期均线多头排列",
  down: "短期均线空头排列",
  mixed: "短期均线交错",
  insufficient: "样本不足",
};

export function HistoryAnalysis({ symbol, assetType }: { symbol: string; assetType: Asset["type"] }) {
  const [data, setData] = useState<HistoryPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/market/history?symbol=${encodeURIComponent(symbol)}&type=${assetType}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as HistoryPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
        setData(payload);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "unknown");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [assetType, symbol]);

  if (loading) return <article className="history-panel"><h3>历史行情计算</h3><p>正在读取历史数据并计算指标…</p></article>;
  if (error || !data) return <article className="history-panel error"><h3>历史行情计算失败</h3><p>{error || "没有可用数据"}</p><small>失败时不生成趋势、波动或价格区间，避免用演示值冒充真实计算。</small></article>;

  const metrics = data.metrics;
  return <article className="history-panel">
    <div className="history-title"><div><h3>历史行情计算</h3><p>{data.source} · 口径：{data.basis} · 截止 {metrics.latestDate}</p></div><em>{metrics.sampleSize} 个披露日</em></div>
    <div className="history-verdict"><b>{trendLabels[metrics.trend]}</b><span>最新分析基准 {number(metrics.latestValue)}</span></div>
    <div className="history-metrics">
      <div><span>5日收益</span><b>{percent(metrics.return5)}</b></div>
      <div><span>20日收益</span><b>{percent(metrics.return20)}</b></div>
      <div><span>60日收益</span><b>{percent(metrics.return60)}</b></div>
      <div><span>20日年化波动率</span><b>{magnitudePercent(metrics.volatility20Annualized)}</b></div>
      <div><span>60日最大回撤</span><b>{percent(metrics.maxDrawdown60)}</b></div>
      <div><span>20日区间位置</span><b>{metrics.rangePosition20 === null ? "样本不足" : `${metrics.rangePosition20.toFixed(1)}%`}</b></div>
    </div>
    <div className="history-levels">
      <span>20日低点 <b>{number(metrics.low20)}</b></span>
      <span>20日高点 <b>{number(metrics.high20)}</b></span>
      <span>MA5 / MA10 / MA20 <b>{number(metrics.ma5)} / {number(metrics.ma10)} / {number(metrics.ma20)}</b></span>
      {assetType !== "fund" && <span>ATR14 <b>{number(metrics.atr14)}（{magnitudePercent(metrics.atr14Percent)}）</b></span>}
    </div>
    <div className="history-explain">
      <p><b>均线（MA）</b>：过去若干交易日价格或累计净值的平均值。“多头排列”只表示短期价格高于各均线且短均线高于长均线，不保证继续上涨。</p>
      <p><b>年化波动率</b>：把最近20个交易日的日收益波动换算成年尺度，用来描述价格不稳定程度，不是预期收益。</p>
      <p><b>最大回撤</b>：最近60个披露日内，从阶段高点到之后低点的最大跌幅。</p>
      {assetType !== "fund" && <p><b>ATR14</b>：最近14个交易日的平均真实波幅，用来衡量日常价格震荡，不是自动止损价。</p>}
      <p><b>{data.basis}</b>：{data.basis === "前复权收盘价" ? "把历史价格按分红送转因素调整后连接起来，适合比较收益，但不等于当时成交价。" : "基金成立以来单位净值与历次分红的累计结果，用于降低分红造成的收益误判。"}</p>
    </div>
    <div className="notice warn"><b>数据限制</b><span>{data.warning} 这些指标只描述历史，不直接给出买入或止损结论。</span></div>
  </article>;
}
