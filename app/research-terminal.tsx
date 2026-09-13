"use client";

import { useEffect, useMemo, useState } from "react";
import { assets, marketBreadth, newsItems, type Asset } from "@/lib/demo-data";
import { glossary } from "@/lib/glossary";
import { HistoryAnalysis } from "@/app/history-analysis";
import { FundamentalAnalysis } from "@/app/fundamental-analysis";
import { MarketContextAnalysis } from "@/app/market-context-analysis";
import { DailyReportPanel } from "@/app/daily-report-panel";

type View = "dashboard" | "research" | "watchlist" | "portfolio" | "ledger" | "review" | "glossary" | "admin";
type SessionUser = { id: string; username: string; displayName: string; role: "admin" | "user"; onboardingComplete: boolean; mustChangePassword: boolean };
type ManagedAccount = { id: string; username: string; displayName: string; role: string; status: string; mustChangePassword: boolean };

const nav: Array<{ id: View; label: string; shortLabel: string; key: string }> = [
  { id: "dashboard", label: "市场总览", shortLabel: "总览", key: "01" },
  { id: "research", label: "研究台", shortLabel: "研究", key: "02" },
  { id: "watchlist", label: "我的自选", shortLabel: "自选", key: "03" },
  { id: "portfolio", label: "组合经理", shortLabel: "组合", key: "04" },
  { id: "ledger", label: "交易账本", shortLabel: "账本", key: "05" },
  { id: "review", label: "每周复盘", shortLabel: "复盘", key: "06" },
  { id: "glossary", label: "术语库", shortLabel: "术语", key: "07" },
  { id: "admin", label: "系统状态", shortLabel: "状态", key: "08" },
];

function Term({ name }: { name: keyof typeof glossary }) {
  return <span className="term" title={glossary[name]}>{name}<sup>?</sup></span>;
}

function Sparkline({ values }: { values: number[] }) {
  return <div className="spark" aria-label="市场广度趋势">{values.map((value, index) => <i key={index} style={{ height: `${value}%` }} />)}</div>;
}

function DataBadge({ mode = "demo" }: { mode?: "demo" | "public-web" | "loading" }) {
  const label = mode === "public-web" ? "免费公开数据 · 需交叉核验" : mode === "loading" ? "正在获取公开数据" : "演示降级 · 非实时行情";
  return <span className="data-badge">{label}</span>;
}

function AssetCard({ asset, onOpen, watched, onWatch }: { asset: Asset; onOpen: () => void; watched: boolean; onWatch: () => void }) {
  return (
    <article className="asset-card">
      <div className="asset-top">
        <div><span className={`asset-type ${asset.type}`}>{asset.type === "stock" ? "A股模拟" : asset.type === "etf" ? "ETF" : "公募基金"}</span><small>{asset.symbol}</small></div>
        <button className={`watch-button ${watched ? "active" : ""}`} onClick={onWatch} aria-label={watched ? "移出自选" : "加入自选"}>{watched ? "已自选" : "+ 自选"}</button>
      </div>
      <h3>{asset.name}</h3>
      <p className="asset-meta">{asset.sector} · {asset.market} · {asset.horizon}</p>
      <div className="confidence"><span>{asset.scoreKind === "rules" ? "规则评分（非概率）" : "研究置信度"}</span><b>{asset.confidence}</b><div><i style={{ width: `${asset.confidence}%` }} /></div></div>
      <div className="asset-status"><span>{asset.status}</span><small>{asset.price}</small></div>
      <p className="thesis">{asset.thesis}</p>
      <button className="text-action" onClick={onOpen}>查看完整证据链 →</button>
    </article>
  );
}

export function ResearchTerminal() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [query, setQuery] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [watchIds, setWatchIds] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Asset | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [ledgerType, setLedgerType] = useState<"fund" | "stock">("fund");
  const [marketResults, setMarketResults] = useState<Asset[]>(assets);
  const [marketMode, setMarketMode] = useState<"demo" | "public-web" | "loading">("demo");
  const [marketWarning, setMarketWarning] = useState("当前展示样本数据，不得据此交易。");
  const [assetCache, setAssetCache] = useState<Record<string, Asset>>(() => Object.fromEntries(assets.map((asset) => [asset.symbol, asset])));

  const visibleResults = useMemo(() => query.trim() ? marketResults : assets, [marketResults, query]);

  useEffect(() => {
    fetch("/api/auth/me").then(async (response) => {
      if (response.ok) setUser(((await response.json()) as { user: SessionUser }).user);
    }).finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    fetch("/api/watchlist").then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { items: Array<{ id: string; symbol: string; assetType: Asset["type"] }> };
      setWatchlist(data.items.map((item) => item.symbol));
      setWatchIds(Object.fromEntries(data.items.map((item) => [item.symbol, item.id])));
      const hydrated = await Promise.all(data.items.map(async (item) => {
        try {
          const marketResponse = await fetch(`/api/market/search?q=${encodeURIComponent(item.symbol)}`);
          if (!marketResponse.ok) return null;
          const payload = await marketResponse.json() as { results?: Asset[] };
          return payload.results?.find((asset) => asset.symbol === item.symbol && asset.type === item.assetType) ?? null;
        } catch {
          return null;
        }
      }));
      setAssetCache((current) => ({ ...current, ...Object.fromEntries(hydrated.filter((asset): asset is Asset => Boolean(asset)).map((asset) => [asset.symbol, asset])) }));
    });
  }, [user]);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setMarketMode("loading");
      try {
        const response = await fetch(`/api/market/search?q=${encodeURIComponent(normalized)}`, { signal: controller.signal });
        const payload = await response.json() as { results?: Asset[]; dataMode?: string; warning?: string; error?: string };
        if (!response.ok) throw new Error(payload.error || `HTTP_${response.status}`);
        const nextResults = payload.results ?? [];
        setMarketResults(nextResults);
        setMarketMode(payload.dataMode === "public-web" ? "public-web" : "demo");
        setMarketWarning(payload.warning || "数据来源状态未知，请勿据此交易。");
        setAssetCache((current) => ({ ...current, ...Object.fromEntries(nextResults.map((asset) => [asset.symbol, asset])) }));
      } catch (error) {
        if (controller.signal.aborted) return;
        setMarketResults([]);
        setMarketMode("demo");
        setMarketWarning(`查询失败：${error instanceof Error ? error.message : "unknown"}`);
      }
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const toggleWatch = async (symbol: string) => {
    if (watchlist.includes(symbol)) {
      const id = watchIds[symbol];
      if (id) await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      setWatchlist((current) => current.filter((item) => item !== symbol));
      setWatchIds((current) => { const next = { ...current }; delete next[symbol]; return next; });
      return;
    }
    const asset = assetCache[symbol];
    const response = await fetch("/api/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, assetType: asset?.type ?? "stock", note: "" }) });
    if (!response.ok) return;
    const data = await response.json() as { id: string };
    setWatchlist((current) => [...current, symbol]);
    setWatchIds((current) => ({ ...current, [symbol]: data.id }));
  };

  if (!authChecked) return <div className="auth-shell"><div className="auth-card"><div className="brand-mark">激</div><h1>激荡</h1><p>正在核验本地会话…</p></div></div>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  if (user.mustChangePassword) return <ChangePassword onChanged={() => setUser({ ...user, mustChangePassword: false })} />;

  return (
    <main className="terminal-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">激</div><div><strong>激荡</strong><span>研究终端 / BETA</span></div></div>
        <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} aria-current={view === item.id ? "page" : undefined}><span className="nav-index">{item.key}</span><span className="nav-label">{item.label}</span><span className="nav-short-label">{item.shortLabel}</span></button>)}</nav>
        <div className="sidebar-foot">
          <div className="risk-meter"><span>组合风险预算</span><b>0 / 15%</b><div><i /></div></div>
          <p>研究工具，不构成投资建议</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="market-clock"><span className="live-dot" />A股已收盘 <b>Asia/Shanghai</b></div>
          <div className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setView("research")} placeholder="输入代码、名称或行业" /></div>
          <button className="profile-button" onClick={() => setShowOnboarding(true)}><span>{user.displayName.slice(0, 1)}</span><div><b>{user.displayName}</b><small>{user.onboardingComplete ? "风险资料已建立" : "风险资料尚未完成"}</small></div></button>
        </header>

        <div className="content">
          {view === "dashboard" && <Dashboard setView={setView} onOpen={setSelected} watched={watchlist} onWatch={toggleWatch} />}
          {view === "research" && <Research query={query} setQuery={setQuery} results={visibleResults} mode={query.trim() ? marketMode : "demo"} warning={query.trim() ? marketWarning : "当前展示样本数据，不得据此交易。"} onOpen={setSelected} watched={watchlist} onWatch={toggleWatch} />}
          {view === "watchlist" && <Watchlist symbols={watchlist} assetCache={assetCache} onOpen={setSelected} onWatch={toggleWatch} />}
          {view === "portfolio" && <Portfolio onProfile={() => setShowOnboarding(true)} />}
          {view === "ledger" && <Ledger type={ledgerType} setType={setLedgerType} />}
          {view === "review" && <Review />}
          {view === "glossary" && <Glossary />}
          {view === "admin" && <Admin role={user.role} />}
        </div>
      </section>

      {selected && <ReportModal asset={selected} onClose={() => setSelected(null)} />}
      {showOnboarding && <Onboarding onClose={() => setShowOnboarding(false)} onSaved={() => setUser({ ...user, onboardingComplete: true })} />}
    </main>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: SessionUser) => void }) {
  const [mode, setMode] = useState<"login" | "bootstrap">("login");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/bootstrap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      const contentType = response.headers.get("content-type") ?? "";
      const data = contentType.includes("application/json")
        ? await response.json() as { user?: SessionUser; error?: string }
        : { error: (await response.text()) || `服务器返回${response.status}` };
      if (!response.ok || !data.user) return setError(data.error ?? "请求失败");
      onAuthenticated(data.user);
    } catch {
      setError("连接初始化服务失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  };
  return <div className="auth-shell"><section className="auth-card"><div className="auth-brand"><div className="brand-mark">激</div><div><h1>激荡</h1><p>股票与基金研究终端</p></div></div><div className="tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>账户登录</button><button className={mode === "bootstrap" ? "active" : ""} onClick={() => setMode("bootstrap")}>首次初始化</button></div><form onSubmit={submit}>{mode === "bootstrap" && <label>显示名称<input name="displayName" required maxLength={30} /></label>}<label>用户名<input name="username" required minLength={3} maxLength={24} pattern="[a-z0-9_]{3,24}" autoComplete="username" /><small>仅限小写字母、数字和下划线，不能有空格，例如 krick_hu</small></label><label>密码<input name="password" type="password" required minLength={10} autoComplete={mode === "login" ? "current-password" : "new-password"} /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? "处理中…" : mode === "login" ? "登录" : "创建首个管理员"}</button></form><div className="notice warn"><b>邀请制</b><span>首次初始化只允许执行一次；之后只能由管理员创建账户，不开放公众注册。</span></div></section></div>;
}

function ChangePassword({ onChanged }: { onChanged: () => void }) {
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/auth/change-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setError(data.error ?? "修改失败");
    onChanged();
  };
  return <div className="auth-shell"><section className="auth-card"><p className="eyebrow">FIRST LOGIN</p><h1>首次登录必须修改密码</h1><p>临时密码由管理员设置。新密码至少10位，不要与其他网站共用。</p><form onSubmit={submit}><label>当前临时密码<input name="currentPassword" type="password" required autoComplete="current-password" /></label><label>新密码<input name="newPassword" type="password" required minLength={10} autoComplete="new-password" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button">保存新密码</button></form></section></div>;
}

function Dashboard({ setView, onOpen, watched, onWatch }: { setView: (view: View) => void; onOpen: (asset: Asset) => void; watched: string[]; onWatch: (symbol: string) => void }) {
  return <>
    <div className="page-heading"><div><p className="eyebrow">NEXT SESSION / 2026官方休市日历已内置</p><h1>下一交易日前夜研究台</h1><p>每个交易日前一晚20:00生成，交易日08:30仅追加新增风险。</p></div><DataBadge /></div>
    <section className="hero-grid">
      <article className="market-panel panel"><div className="panel-title"><div><span>市场风险状态</span><strong>中性偏谨慎</strong></div><em>规则演示</em></div><div className="market-score"><b>56</b><span>/ 100</span><div><i style={{ width: "56%" }} /></div></div><Sparkline values={marketBreadth} /><div className="market-stats"><div><span>模拟仓位</span><b>0%</b></div><div><span>组合回撤</span><b>0%</b></div><div><span>风险上限</span><b>15%</b></div></div></article>
      <article className="schedule-panel panel"><div className="panel-title"><div><span>报告任务</span><strong>2026休市日历已确认</strong></div><em className="amber">本地规则</em></div><div className="timeline"><div className="done"><b>20:00</b><span>前夜报告</span><small>读取周末与晚间信息</small></div><div><b>08:30</b><span>盘前补充</span><small>不覆盖原始判断</small></div><div><b>20:00</b><span>周六复盘</span><small>保留失败样本</small></div></div><p className="locked-note">原始结论发布后锁定，后续只允许追加带时间戳的跟踪。</p></article>
    </section>
    <DailyReportPanel onOpen={onOpen} />
    <section className="section-head"><div><p className="eyebrow">RESEARCH QUEUE</p><h2>候选研究样本</h2></div><button onClick={() => setView("research")}>进入研究台 →</button></section>
    <div className="asset-grid">{assets.slice(0, 3).map((asset) => <AssetCard key={asset.symbol} asset={asset} onOpen={() => onOpen(asset)} watched={watched.includes(asset.symbol)} onWatch={() => onWatch(asset.symbol)} />)}</div>
    <section className="lower-grid"><article className="panel news-panel"><div className="panel-title"><div><span>风险与任务信号</span><strong>系统边界</strong></div></div>{newsItems.map((item) => <div className="news-row" key={item.title}><em className={item.tone}>{item.type}</em><div><b>{item.title}</b><small>{item.time}</small></div></div>)}</article><article className="panel principle-panel"><p className="eyebrow">DISCIPLINE</p><h3>今天没有好机会，也是一种结论。</h3><p>系统不会为了凑满3只股票和2只基金强行推荐。证据不足时，现金和等待本身就是仓位。</p><div><span>常规单笔风险</span><b>7%</b></div><div><span>绝对亏损上限</span><b>15%</b></div></article></section>
  </>;
}

function Research({ query, setQuery, results, mode, warning, onOpen, watched, onWatch }: { query: string; setQuery: (q: string) => void; results: Asset[]; mode: "demo" | "public-web" | "loading"; warning: string; onOpen: (asset: Asset) => void; watched: string[]; onWatch: (symbol: string) => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">EVIDENCE DESK</p><h1>股票与基金研究台</h1><p>支持A股、场内ETF与国内公募基金；公开行情只是研究起点，不是买入结论。</p></div><DataBadge mode={mode} /></div><div className="research-search"><span>⌕</span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="试试 600519、沪深300、主动混合" /><kbd>ENTER</kbd></div><div className="notice"><b>数据边界</b><span>{warning}</span></div><div className="filter-row"><button className="active">全部</button><button>A股模拟</button><button>公募基金</button><button>ETF</button><span>{mode === "loading" ? "查询中" : `${results.length} 个结果`}</span></div><div className="asset-grid research-grid">{results.map((asset) => <AssetCard key={`${asset.type}-${asset.symbol}`} asset={asset} onOpen={() => onOpen(asset)} watched={watched.includes(asset.symbol)} onWatch={() => onWatch(asset.symbol)} />)}</div>{mode !== "loading" && results.length === 0 && <Empty title="没有找到匹配标的" text="请检查六位代码或尝试更完整的基金、股票名称。" />}</>;
}

function Watchlist({ symbols, assetCache, onOpen, onWatch }: { symbols: string[]; assetCache: Record<string, Asset>; onOpen: (asset: Asset) => void; onWatch: (symbol: string) => void }) {
  const selected = symbols.map((symbol) => assetCache[symbol]).filter((asset): asset is Asset => Boolean(asset));
  return <><div className="page-heading"><div><p className="eyebrow">PRIVATE WATCHLIST</p><h1>我的自选</h1><p>自选属于个人数据，其他普通用户与管理界面不可读取。</p></div><span className="count-badge">{selected.length} 项</span></div>{selected.length ? <div className="asset-grid">{selected.map((asset) => <AssetCard key={asset.symbol} asset={asset} onOpen={() => onOpen(asset)} watched onWatch={() => onWatch(asset.symbol)} />)}</div> : <Empty title="自选列表为空" text="去研究台搜索股票或基金，再加入自选。" />}</>;
}

function Portfolio({ onProfile }: { onProfile: () => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">PORTFOLIO MANAGER</p><h1>如果我是组合经理</h1><p>资料未确认前只能展示非个性化示例，不能冒充仓位建议。</p></div><button className="primary-button" onClick={onProfile}>完善风险资料</button></div><div className="notice warn"><b>非个性化示例</b><span>请先独立填写资金、期限和风险承受能力。</span></div><div className="portfolio-grid"><article className="panel allocation"><div className="donut"><div><b>100%</b><span>示例配置</span></div></div><div className="alloc-list"><div><i className="c1"/><span>现金及货币基金</span><b>40%</b></div><div><i className="c2"/><span>宽基指数基金</span><b>35%</b></div><div><i className="c3"/><span>主动与行业基金</span><b>15%</b></div><div><i className="c4"/><span>A股模拟仓位</span><b>10%</b></div></div></article><article className="panel"><div className="panel-title"><div><span>纪律检查</span><strong>组合边界</strong></div></div><div className="rule-list"><div><span>比例合计</span><b className="safe-text">100% 通过</b></div><div><span>整体最大回撤</span><b>15%</b></div><div><span>基金投入周期</span><b>3—12个月</b></div><div><span>A股状态</span><b>仅模拟</b></div><div><span>真实自动下单</span><b>禁止</b></div></div></article></div></>;
}

function Ledger({ type, setType }: { type: "fund" | "stock"; setType: (type: "fund" | "stock") => void }) {
  return <><div className="page-heading"><div><p className="eyebrow">LEDGER</p><h1>交易账本</h1><p>基金记录真实申赎，A股只记录模拟交易；第一版仅手动录入。</p></div><button className="primary-button">+ 新增记录</button></div><div className="tabs"><button className={type === "fund" ? "active" : ""} onClick={() => setType("fund")}>基金真实账本</button><button className={type === "stock" ? "active" : ""} onClick={() => setType("stock")}>A股模拟账本</button></div><div className="metric-row"><div><span>{type === "fund" ? "累计投入" : "模拟本金"}</span><b>¥0.00</b></div><div><span>当前市值</span><b>¥0.00</b></div><div><span>累计收益</span><b>0.00%</b></div><div><span>最大回撤</span><b>0.00%</b></div></div><Empty title={type === "fund" ? "尚未记录基金交易" : "尚未创建模拟交易"} text={type === "fund" ? "记录申购、确认净值、份额和费用；不要上传券商账户资料。" : "从候选报告创建模拟交易，保留原始理由和失效条件。"} /></>;
}

function Review() {
  return <><div className="page-heading"><div><p className="eyebrow">SATURDAY REVIEW</p><h1>每周复盘</h1><p>每周六20:00生成，不删除失败候选，不用事后解释替代证据。</p></div><span className="count-badge">等待首周样本</span></div><div className="metric-row"><div><span>已跟踪候选</span><b>0</b></div><div><span>1周胜率</span><b>—</b></div><div><span>平均收益</span><b>—</b></div><div><span>最大回撤</span><b>—</b></div></div><article className="panel review-framework"><h3>复盘不是总结情绪，而是定位错误来源</h3><div className="review-steps"><div><b>01</b><span>数据</span><p>当时数据是否完整、时间口径是否正确？</p></div><div><b>02</b><span>逻辑</span><p>支持与反对理由是否能被证据验证？</p></div><div><b>03</b><span>模型</span><p>AI是否越过了确定性计算边界？</p></div><div><b>04</b><span>执行</span><p>是否违反仓位、期限或风险线？</p></div></div></article></>;
}

function Glossary() {
  return <><div className="page-heading"><div><p className="eyebrow">PLAIN-LANGUAGE FINANCE</p><h1>金融术语库</h1><p>每份报告首次出现专业术语时给出解释，末尾自动汇总本报告术语。</p></div></div><div className="glossary-grid">{Object.entries(glossary).map(([term, definition]) => <article key={term}><b>{term}</b><p>{definition}</p><button>查看计算与局限 →</button></article>)}</div></>;
}

function Admin({ role }: { role: "admin" | "user" }) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [message, setMessage] = useState("");
  const loadAccounts = async () => {
    if (role !== "admin") return;
    const response = await fetch("/api/admin/users");
    if (response.ok) setAccounts(((await response.json()) as { users: ManagedAccount[] }).users);
  };
  useEffect(() => {
    if (role !== "admin") return;
    fetch("/api/admin/users").then(async (response) => {
      if (response.ok) setAccounts(((await response.json()) as { users: ManagedAccount[] }).users);
    });
  }, [role]);
  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setMessage("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/admin/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
    const data = await response.json() as { error?: string };
    setMessage(response.ok ? "账户已创建；首次登录必须改密并独立填写风险资料。" : data.error ?? "创建失败");
    if (response.ok) { event.currentTarget.reset(); await loadAccounts(); }
  };
  const manage = async (userId: string, action: "disable" | "enable" | "reset_password") => {
    const temporaryPassword = action === "reset_password" ? window.prompt("输入至少10位临时密码。不要使用你的个人密码。") ?? "" : undefined;
    if (action === "reset_password" && (temporaryPassword?.length ?? 0) < 10) return setMessage("临时密码至少10位");
    const response = await fetch("/api/admin/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId, action, temporaryPassword }) });
    const data = await response.json() as { error?: string };
    setMessage(response.ok ? "账户状态已更新" : data.error ?? "操作失败");
    if (response.ok) await loadAccounts();
  };
  const rows = [{ name: "股票行情", state: "基础层已验证", detail: "公开报价与120日历史日线已实测；无稳定性承诺，未接交易所授权行情", tone: "info" }, { name: "公募基金净值", state: "基础层已验证", detail: "公开净值与120个披露日历史数据已实测；长期周期仍不完整", tone: "info" }, { name: "历史指标", state: "程序计算已验证", detail: "5/20/60日收益、波动率、最大回撤、区间、均线和ATR已通过自动测试", tone: "info" }, { name: "基本面证据", state: "基础层已验证", detail: "股票财务摘要/公告与基金资料/费率/持仓已实测；第三方摘要仍需正式文件交叉核验", tone: "info" }, { name: "新闻政策与估值", state: "相对尺度已验证", detail: "750日估值分位、同日同行截面、明确PB_MRQ口径及基金穿透已实测；新闻三档核验已测试，逐项事实仍需人工核对", tone: "info" }, { name: "个人报告流水线", state: "真实样本已验证", detail: "当前用户自选→三层证据→六维评分→硬门槛→锁定报告已跑通；评分不是上涨概率", tone: "info" }, { name: "DeepSeek", state: "未配置", detail: "当前真实报告使用透明规则，不依赖AI补造结论", tone: "warn" }, { name: "20:00任务", state: "用户级调度已启用", detail: "周日前夜任务已手动写入周一报告；首次20:00准点执行仍待运行日志确认，电脑必须保持登录且不休眠", tone: "info" }, { name: "08:30盘前", state: "本地已验证", detail: "追加补充且原报告哈希不变；真实增量新闻核验仍待下一步", tone: "info" }];
  const statusRows = rows.map((row) => row.name === "DeepSeek" ? { name: "DeepSeek", state: "已接入主流程", detail: "每份个人报告最多调用一次，只解释带来源编号的证据；不修改规则评分和候选资格，失败自动降级并记录Token", tone: "info" } : row);
  return <><div className="page-heading"><div><p className="eyebrow">SYSTEM EVIDENCE</p><h1>系统状态与完成边界</h1><p>配置、代码、真实运行和正式上线分开记录。</p></div><DataBadge /></div>{role === "admin" && <section className="admin-accounts panel"><h2>邀请制账户 <small>{accounts.length}/5</small></h2><form onSubmit={createAccount}><input name="displayName" placeholder="显示名称" required /><input name="username" placeholder="用户名" pattern="[a-z0-9_]{3,24}" required /><input name="password" type="password" minLength={10} placeholder="临时密码（至少10位）" required /><select name="role" defaultValue="user"><option value="user">普通用户</option><option value="admin">管理员</option></select><button className="primary-button">创建账户</button></form>{message && <p className="admin-message">{message}</p>}<div className="account-list">{accounts.map((account) => <div key={account.id}><span><b>{account.displayName}</b><small>{account.username} · {account.role} · {account.mustChangePassword ? "待改密" : "密码已更新"}</small></span><em>{account.status === "active" ? "启用" : "停用"}</em><button onClick={() => manage(account.id, account.status === "active" ? "disable" : "enable")}>{account.status === "active" ? "停用" : "启用"}</button><button onClick={() => manage(account.id, "reset_password")}>重置密码</button></div>)}</div></section>}<div className="status-table"><div className="status-header"><span>能力</span><span>状态</span><span>证据边界</span></div>{statusRows.map((row) => <div key={row.name}><b>{row.name}</b><em className={row.tone}>{row.state}</em><span>{row.detail}</span></div>)}</div><div className="notice"><b>隐私边界</b><span>普通管理页面不可查看他人私人数据；服务器控制者在运维层仍可能具备技术访问能力。</span></div></>;
}

function ReportModal({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const isPublicData = asset.sourceState === "live";
  return <div className="modal-backdrop"><section className="report-modal"><header><div><span className={`asset-type ${asset.type}`}>{asset.type === "stock" ? "A股模拟研究" : "基金研究"}</span><h2>{asset.name} <small>{asset.symbol}</small></h2><p>适用期限 {asset.horizon} · 数据状态：{isPublicData ? "免费公开数据" : "演示降级"}</p></div><button onClick={onClose}>×</button></header><div className="notice warn"><b>{isPublicData ? "公开数据不是买入结论" : "不能形成实时交易结论"}</b><span>{isPublicData ? "历史、基本面、新闻政策与估值分别标注来源和质量限制；公告主题匹配不代表新闻中的每个数字或因果关系已核实。" : "行情、财务与正式净值数据不足；以下用于验证报告结构。"}</span></div><div className="report-score"><div><span>结论</span><b>{asset.status}</b></div><div><span>{asset.scoreKind === "rules" ? "规则评分（非概率）" : "置信度"}</span><b>{asset.confidence}/100</b></div><div><span>参考区间</span><b>{asset.range}</b></div></div>{isPublicData && <><HistoryAnalysis symbol={asset.symbol} assetType={asset.type} /><FundamentalAnalysis symbol={asset.symbol} assetType={asset.type} /><MarketContextAnalysis symbol={asset.symbol} name={asset.name} assetType={asset.type} /></>}<div className="report-columns"><article><h3>支持理由</h3><p>{asset.thesis}</p></article><article><h3>反对理由</h3><p>{asset.counter}</p></article></div><article className="evidence-block"><h3>情景与失效条件</h3><div><b>基准情景</b><p>完成公告原文、新闻事实与跨来源核验后，才能计算可执行的风险收益比。</p></div><div><b>悲观情景</b><p>{asset.invalidation}</p></div></article><article className="term-box"><h3>本报告术语</h3><p><Term name="风险收益比" />：{glossary["风险收益比"]}</p><p><Term name="最大回撤" />：{glossary["最大回撤"]}</p>{asset.type !== "stock" && <p><Term name="基金净值" />：{glossary["基金净值"]}</p>}</article><footer><span>报告发布后关键字段锁定 · 后续只追加跟踪</span><button onClick={onClose}>关闭报告</button></footer></section></div>;
}

function Onboarding({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const holdings = String(form.get("currentHoldings") ?? "").split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
    const payload = {
      capitalBand: form.get("capitalBand"), monthlyContribution: Number(form.get("monthlyContribution")), experience: form.get("experience"), objective: form.get("objective"),
      stockHorizon: "1—2周", fundHorizon: "3—12个月", routineRiskPct: Number(form.get("routineRiskPct")), absoluteRiskPct: Number(form.get("absoluteRiskPct")), maxDrawdownPct: Number(form.get("maxDrawdownPct")),
      preferredAssets: form.get("preferredAssets"), excludedScope: form.get("excludedScope"), currentHoldings: holdings, fundLedgerEnabled: form.has("fundLedgerEnabled"), stockLedgerEnabled: form.has("stockLedgerEnabled"), acceptedDisclaimer: form.has("acceptedDisclaimer"),
    };
    const response = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json() as { error?: string };
    if (!response.ok) return setError(data.error ?? "保存失败");
    onSaved(); onClose();
  };
  return <div className="modal-backdrop"><section className="onboarding"><header><div><p className="eyebrow">INDEPENDENT PROFILE</p><h2>独立填写你的风险资料</h2><p>每个管理员和普通用户都必须重新填写，不能复制他人数据。</p></div><button onClick={onClose}>×</button></header><form onSubmit={submit}><label>可投资资金区间<select name="capitalBand" defaultValue="1000"><option value="约1000元">约 ¥1,000</option><option value="1000至5000元">¥1,000—5,000</option><option value="5000至20000元">¥5,000—20,000</option></select></label><label>每月追加金额<input name="monthlyContribution" type="number" min="0" defaultValue="200" /></label><label>投资经验<select name="experience" defaultValue="some"><option value="none">暂无经验</option><option value="some">买过一段时间基金和股票</option><option value="experienced">三年以上持续记录</option></select></label><label>主要目标<input name="objective" defaultValue="学习与争取年化10%，不作收益承诺" /></label><label>偏好资产<select name="preferredAssets" defaultValue="A股模拟,公募基金"><option>A股模拟,公募基金</option><option>优先宽基基金</option><option>优先A股模拟研究</option></select></label><label>禁投行业或产品<input name="excludedScope" placeholder="没有可留空" /></label><label>现有持仓（代码或名称，用逗号分隔）<input name="currentHoldings" placeholder="当前空仓可留空" /></label><div className="form-row"><label>单笔常规风险线<input name="routineRiskPct" type="number" min="1" max="15" defaultValue="7" /></label><label>绝对亏损上限<input name="absoluteRiskPct" type="number" min="1" max="15" defaultValue="15" /></label><label>组合最大回撤<input name="maxDrawdownPct" type="number" min="1" max="50" defaultValue="15" /></label></div><div className="form-row"><label className="check"><input name="fundLedgerEnabled" type="checkbox" defaultChecked />启用基金真实账本</label><label className="check"><input name="stockLedgerEnabled" type="checkbox" defaultChecked />启用A股模拟账本</label></div><label className="check"><input name="acceptedDisclaimer" type="checkbox" required />我理解本系统仅用于研究与风险教育，不构成投资建议，未来亏损可能超过历史回撤。</label>{error && <p className="form-error">{error}</p>}<div className="form-actions"><button type="button" onClick={onClose}>稍后填写</button><button className="primary-button" type="submit">保存新版本风险画像</button></div></form></section></div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="empty"><div>∅</div><h3>{title}</h3><p>{text}</p></div>;
}
