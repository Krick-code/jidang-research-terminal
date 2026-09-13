"use client";

import { useEffect, useState } from "react";
import type { Asset } from "@/lib/demo-data";
import type { MarketContextResult } from "@/lib/providers/market-context";

type Payload = { result: MarketContextResult; dataMode: "public-web"; providers: string[] };

function multiple(value: number | null) {
  return value === null ? "不适用/缺失" : `${value.toFixed(2)}倍`;
}

function money(value: number | null) {
  if (value === null) return "缺失";
  if (value >= 1e12) return `${(value / 1e12).toFixed(2)}万亿元`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿元`;
  return `${value.toFixed(2)}元`;
}

function percentile(value: number | null) {
  return value === null ? "缺失" : `${value.toFixed(1)}%`;
}

function Distribution({ label, value, dateRange }: { label: string; value: NonNullable<Extract<MarketContextResult["valuation"], { kind: "stock" }>["history"]["pe"]>; dateRange: string }) {
  return <div className="distribution-card"><div><span>{label} 历史位置</span><b>{value.percentile.toFixed(1)}% 分位</b></div><p>当前 {value.current.toFixed(2)}倍，高于样本中 {value.percentile.toFixed(1)}% 的有效观测；不是买卖信号。</p><dl><div><dt>25%分位</dt><dd>{value.p25.toFixed(2)}</dd></div><div><dt>中位数</dt><dd>{value.median.toFixed(2)}</dd></div><div><dt>75%分位</dt><dd>{value.p75.toFixed(2)}</dd></div><div><dt>有效样本</dt><dd>{value.validCount}</dd></div></dl><small>{dateRange}</small></div>;
}

function Quality({ data }: { data: MarketContextResult }) {
  return <div className="quality-block"><div><b>自动质量检查</b>{data.quality.checks.map((check) => <span key={check}>✓ {check}</span>)}</div><div><b>使用限制 · 证据等级：{data.quality.evidenceGrade === "medium" ? "中" : "低"}</b>{data.quality.warnings.map((warning) => <span key={warning}>! {warning}</span>)}</div></div>;
}

function Valuation({ data }: { data: MarketContextResult }) {
  const valuation = data.valuation;
  if (!valuation) return <section className="context-section"><div className="context-heading"><h4>估值快照</h4><span>本次未取得</span></div><p className="context-empty">估值失败不影响其他证据显示，但不得据此形成价格判断。</p></section>;
  if (valuation.kind === "stock") {
    const range = `${valuation.history.startDate} 至 ${valuation.history.endDate}`;
    return <section className="context-section"><div className="context-heading"><h4>最新交易日估值</h4><span>{valuation.industry} · 收盘日 {valuation.quoteAsOf || "时间缺失"}</span></div><div className="valuation-grid stock-current"><div><span>PE（TTM）</span><b>{multiple(valuation.peTtm)}</b></div><div><span>PB（MRQ）</span><b>{multiple(valuation.pb)}</b></div><div><span>PS（TTM）</span><b>{multiple(valuation.psTtm)}</b></div><div><span>总市值</span><b>{money(valuation.marketCap)}</b></div></div><div className="subsection-heading"><h5>历史估值位置</h5><span>{valuation.history.sampleCount}个无重复交易日</span></div><div className="distribution-grid">{valuation.history.pe ? <Distribution label="PE（TTM）" value={valuation.history.pe} dateRange={range} /> : <p className="context-empty">PE没有足够的正数样本。</p>}{valuation.history.pb ? <Distribution label="PB（MRQ）" value={valuation.history.pb} dateRange={range} /> : <p className="context-empty">PB没有足够的正数样本。</p>}</div>{valuation.peers ? <><div className="subsection-heading"><h5>同板块估值截面</h5><span>{valuation.peers.boardName} · {valuation.peers.asOf} · {valuation.peers.totalCount}家公司</span></div><div className="peer-summary"><span>目标PE分位 <b>{percentile(valuation.peers.pePercentile)}</b></span><span>同行PE中位数 <b>{multiple(valuation.peers.peMedian)}</b></span><span>目标PB分位 <b>{percentile(valuation.peers.pbPercentile)}</b></span><span>同行PB中位数 <b>{multiple(valuation.peers.pbMedian)}</b></span></div><div className="peer-table-wrap"><table className="peer-table"><thead><tr><th>公司</th><th>代码</th><th>总市值</th><th>PE TTM</th><th>PB MRQ</th><th>PS TTM</th></tr></thead><tbody>{valuation.peers.rows.map((row) => <tr key={row.symbol} className={row.isTarget ? "target" : ""}><td>{row.name}{row.isTarget ? "（当前）" : ""}</td><td>{row.symbol}</td><td>{money(row.marketCap)}</td><td>{multiple(row.peTtm)}</td><td>{multiple(row.pb)}</td><td>{multiple(row.psTtm)}</td></tr>)}</tbody></table></div><small className="peer-note">表格展示同板块内按总市值排序的代表公司；PE统计仅使用正数值，共{valuation.peers.positivePeCount}家，PB有效{valuation.peers.positivePbCount}家。</small></> : <p className="context-empty">同行截面本次未取得，历史分位仍可单独查看。</p>}<div className="term-explain"><p><b>PE（TTM）</b>：总市值除以最近四个季度归母净利润之和；非正PE不参与分位统计。</p><p><b>PB（MRQ）</b>：总市值相对最近报告期净资产的倍数，本页使用数据接口明确标注的 PB_MRQ 字段。</p><p><b>历史分位</b>：按“有效样本中小于或等于当前值的比例”计算，只表示相对位置。</p><p><b>同行分位</b>：在同一交易日、同一板块分类中比较；同板块不等于业务质量完全可比。</p></div></section>;
  }
  return <section className="context-section"><div className="context-heading"><h4>前十大持仓穿透估值</h4><span>持仓截止 {valuation.holdingsAsOf || "日期缺失"} · 估值日 {valuation.valuationAsOf || "缺失"}</span></div><div className="valuation-grid fund"><div><span>穿透PE（TTM）</span><b>{multiple(valuation.peTtm)}</b><small>有效覆盖 {valuation.peCoveragePercent.toFixed(2)}% 净值</small></div><div><span>穿透PB（MRQ）</span><b>{multiple(valuation.pb)}</b><small>有效覆盖 {valuation.pbCoveragePercent.toFixed(2)}% 净值</small></div><div><span>前十大合计</span><b>{valuation.topHoldingsPercent === null ? "缺失" : `${valuation.topHoldingsPercent.toFixed(2)}%`}</b></div><div><span>取得明确估值</span><b>{valuation.valuedHoldings}/{valuation.totalHoldings}</b></div></div><div className="term-explain"><p><b>穿透估值</b>：按披露持仓权重对底层股票估值做加权汇总，本程序使用更适合组合倍数的加权调和平均。</p><p><b>有效覆盖</b>：有可用正数估值的持仓占基金净值比例；它不是基金股票仓位。</p><p><b>时间错位</b>：持仓来自季报，估值来自最近交易日，基金经理可能已经调仓。</p><p><b>使用边界</b>：时间口径不一致，所以不计算基金历史分位或同行排名，也不能据此推导目标净值。</p></div></section>;
}

function News({ data }: { data: MarketContextResult }) {
  return <section className="context-section"><div className="context-heading"><h4>资产相关新闻线索</h4><span>{data.news.length}条 · 公告主题/媒体相似度核验</span></div>{data.news.length ? <div className="context-list news-verified">{data.news.map((item) => <div className="news-row" key={`${item.date}-${item.url}`}><a href={item.url} target="_blank" rel="noreferrer"><span><em>{item.eventType}</em><b>{item.title}</b><small>{item.date} · {item.source} · {item.relevance}</small></span><i>查看报道 ↗</i></a><div className={`verification ${item.verification === "公告主题支持" ? "official" : item.verification === "多家媒体相似报道" ? "multi" : "single"}`}><b>{item.verification}</b><span>{item.verificationDetail}</span>{item.supportUrl ? <a href={item.supportUrl} target="_blank" rel="noreferrer">核对公告原文 ↗</a> : null}</div></div>)}</div> : <p className="context-empty">没有取得直接匹配的新闻。没有结果不等于没有事件，报告必须保留缺口。</p>}</section>;
}

function Policies({ data }: { data: MarketContextResult }) {
  return <section className="context-section"><div className="context-heading"><h4>证监会官方政策</h4><span>{data.policies.length}条 · 原文入口</span></div>{data.policies.length ? <div className="context-list policy">{data.policies.map((item) => <a href={item.url} target="_blank" rel="noreferrer" key={`${item.date}-${item.url}`}><span><em>{item.scope}</em><b>{item.title}</b><small>{item.date} · 中国证监会</small></span><i>{item.relevance} ↗</i></a>)}</div> : <p className="context-empty">证监会政策列表本次未取得，不能用媒体转载替代官方原文。</p>}</section>;
}

export function MarketContextAnalysis({ symbol, name, assetType }: { symbol: string; name: string; assetType: Asset["type"] }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ symbol, name, type: assetType });
    fetch(`/api/market/context?${params}`, { signal: controller.signal })
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
  }, [assetType, name, symbol]);
  if (loading) return <article className="market-context-panel"><h3>新闻、政策与估值</h3><p>正在读取公开资料并执行相关性与覆盖率检查…</p></article>;
  if (error || !data) return <article className="market-context-panel error"><h3>新闻、政策与估值暂不可用</h3><p>{error || "没有可用数据"}</p><small>该层失败时，报告必须继续保持“等待完整研究”。</small></article>;
  return <article className="market-context-panel"><div className="fundamental-title"><div><h3>新闻、政策与估值</h3><p>{data.providers.join(" · ")} · 抓取 {data.result.fetchedAt.slice(0, 19).replace("T", " ")}</p></div><em>证据等级：{data.result.quality.evidenceGrade === "medium" ? "中" : "低"}</em></div><Valuation data={data.result} /><News data={data.result} /><Policies data={data.result} /><Quality data={data.result} /></article>;
}
