"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/lib/demo-data";
import type { FundamentalResult, FundFundamentalResult, StockFundamentalResult } from "@/lib/providers/fundamentals";

type Payload = { result: FundamentalResult; dataMode: "public-web"; provider: string };

function signedPercent(value: number | null) {
  if (value === null) return "缺失";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
function ratio(value: number | null) {
  return value === null ? "缺失" : `${value.toFixed(2)}%`;
}

function money(value: number | null) {
  if (value === null) return "缺失";
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)}亿元`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(2)}万元`;
  return `${value.toFixed(2)}元`;
}

function fee(value: number | null) {
  return value === null ? "未返回" : `${value.toFixed(2)}%/年`;
}

function QualityBlock({ quality }: { quality: FundamentalResult["quality"] }) {
  return <div className="quality-block"><div><b>自动质量检查</b>{quality.checks.map((check) => <span key={check}>✓ {check}</span>)}</div><div><b>使用限制 · 证据等级：中</b>{quality.warnings.map((warning) => <span key={warning}>! {warning}</span>)}</div></div>;
}

function StockFundamentals({ data }: { data: StockFundamentalResult }) {
  return <>
    <div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>报告期</th><th>营业收入</th><th>营收同比</th><th>归母净利润</th><th>净利同比</th><th>ROE</th><th>毛利率</th><th>资产负债率</th><th>基本EPS</th></tr></thead><tbody>{data.financials.map((row) => <tr key={row.reportDate}><td><b>{row.reportName}</b><small>披露 {row.noticeDate}</small></td><td>{money(row.revenue)}</td><td>{signedPercent(row.revenueYoy)}</td><td>{money(row.netProfit)}</td><td>{signedPercent(row.netProfitYoy)}</td><td>{ratio(row.roe)}</td><td>{ratio(row.grossMargin)}</td><td>{ratio(row.debtRatio)}</td><td>{row.eps === null ? "缺失" : row.eps.toFixed(2)}</td></tr>)}</tbody></table></div>
    <div className="term-explain"><p><b>同比</b>：与上年同一报告期比较；一季报、中报和三季报通常是年初至报告期末累计数据。</p><p><b>归母净利润</b>：归属于上市公司普通股股东的净利润。</p><p><b>ROE（净资产收益率）</b>：净利润相对股东净资产的比例，用于观察资本使用效率。</p><p><b>毛利率</b>：营业收入扣除营业成本后的比例；高低必须结合行业比较。</p><p><b>资产负债率</b>：总负债占总资产的比例，不同行业合理水平差异很大。</p><p><b>EPS（每股收益）</b>：归属于普通股股东的利润折算到每股后的金额。</p></div>
    <section className="announcement-list"><h4>最近公告</h4>{data.announcements.length ? data.announcements.map((item) => <div key={`${item.date}-${item.title}`}><span><b>{item.title}</b><small>{item.date} · {item.category}</small></span><a href={item.mirrorUrl} target="_blank" rel="noreferrer">查看原文镜像 ↗</a></div>) : <p>未取得公告列表。</p>}</section>
    <QualityBlock quality={data.quality} />
  </>;
}

function FundFundamentals({ data }: { data: FundFundamentalResult }) {
  const profile = data.profile;
  return <>
    <div className="fund-profile-grid"><div><span>基金经理</span><b>{profile.managers.join("、") || "未返回"}</b></div><div><span>基金公司</span><b>{profile.company}</b></div><div><span>成立日期</span><b>{profile.establishedDate}</b></div><div><span>基金类型</span><b>{profile.fundType}</b></div><div><span>管理费</span><b>{fee(profile.managementFeeRate)}</b></div><div><span>托管费</span><b>{fee(profile.custodianFeeRate)}</b></div><div><span>销售服务费</span><b>{fee(profile.salesServiceFeeRate)}</b></div><div><span>托管人</span><b>{profile.custodian}</b></div></div>
    <div className="fund-text"><p><b>业绩比较基准</b>{profile.benchmark}</p><p><b>投资目标</b>{profile.objective}</p></div>
    <section className="fund-holdings"><div><h4>最近披露前十大持仓</h4><span>截止 {data.holdingsAsOf || "日期缺失"} · 合计 {data.topHoldingsPercent === null ? "缺失" : `${data.topHoldingsPercent.toFixed(2)}%`}</span></div>{data.holdings.length ? <table><thead><tr><th>排名</th><th>代码</th><th>名称</th><th>占基金净值</th><th>持股/万股</th><th>市值/万元</th></tr></thead><tbody>{data.holdings.map((holding) => <tr key={holding.code}><td>{holding.rank}</td><td>{holding.code}</td><td>{holding.name}</td><td>{holding.navPercent.toFixed(2)}%</td><td>{holding.sharesWan?.toFixed(2) ?? "缺失"}</td><td>{holding.marketValueWan?.toFixed(2) ?? "缺失"}</td></tr>)}</tbody></table> : <p>本期未解析出股票持仓，可能是非股票基金或上游页面结构变化。</p>}</section>
    <div className="term-explain"><p><b>占基金净值</b>：单项持仓市值占基金资产净值的比例；前十大合计不等于股票总仓位。</p><p><b>管理费</b>：支付给基金管理人的年度费用，通常从基金资产中按日计提。</p><p><b>托管费</b>：支付给基金托管人的年度费用，通常从基金资产中按日计提。</p><p><b>销售服务费</b>：部分基金份额持续收取的销售服务费用；未返回不等于一定为零。</p><p><b>业绩比较基准</b>：基金合同用于评价表现的参考组合，不是保证收益。</p></div>
    <QualityBlock quality={data.quality} />
  </>;
}

export function FundamentalAnalysis({ symbol, assetType }: { symbol: string; assetType: Asset["type"] }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/market/fundamentals?symbol=${encodeURIComponent(symbol)}&type=${assetType}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Payload & { error?: string };
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
  if (loading) return <article className="fundamental-panel"><h3>基本面证据</h3><p>正在读取并检查基本面资料…</p></article>;
  if (error || !data) return <article className="fundamental-panel error"><h3>基本面证据暂不可用</h3><p>{error || "没有可用数据"}</p><small>基本面失败不会阻止历史行情显示，但报告不得据此形成买入结论。</small></article>;
  return <article className="fundamental-panel"><div className="fundamental-title"><div><h3>基本面证据</h3><p>{data.provider} · 第三方结构化资料</p></div><em>证据等级：中</em></div>{data.result.kind === "stock" ? <StockFundamentals data={data.result} /> : <FundFundamentals data={data.result} />}</article>;
}
