export type Asset = {
  symbol: string;
  name: string;
  type: "stock" | "fund" | "etf";
  market: string;
  sector: string;
  price: string;
  change: number;
  status: string;
  confidence: number;
  scoreKind?: "rules";
  horizon: string;
  range: string;
  invalidation: string;
  thesis: string;
  counter: string;
  sourceState: "demo" | "live";
};

export const assets: Asset[] = [
  {
    symbol: "600519",
    name: "贵州茅台",
    type: "stock",
    market: "上交所",
    sector: "食品饮料",
    price: "演示数据",
    change: 0,
    status: "继续观察",
    confidence: 62,
    horizon: "1—2周",
    range: "待实时行情Provider计算",
    invalidation: "放量跌破结构支撑，或基本面出现未经定价的负面变化",
    thesis: "品牌与现金流质量较强，适合作为研究样本；当前未连接实时行情，不能形成入场结论。",
    counter: "消费复苏节奏、估值消化和渠道库存仍需用最新披露验证。",
    sourceState: "demo",
  },
  {
    symbol: "300750",
    name: "宁德时代",
    type: "stock",
    market: "深交所",
    sector: "电力设备",
    price: "演示数据",
    change: 0,
    status: "等待更好价格",
    confidence: 58,
    horizon: "1—2周",
    range: "待实时行情Provider计算",
    invalidation: "行业价格战恶化或盈利预期出现明显下修",
    thesis: "产业地位和研发投入值得跟踪，但短周期价格表现对市场情绪较敏感。",
    counter: "行业竞争、海外政策与盈利波动可能压缩风险收益比。",
    sourceState: "demo",
  },
  {
    symbol: "510300",
    name: "沪深300ETF",
    type: "etf",
    market: "上交所",
    sector: "宽基指数",
    price: "演示数据",
    change: 0,
    status: "可分批关注",
    confidence: 72,
    horizon: "3—12个月",
    range: "按月分批，不设置单日追价",
    invalidation: "用户应急资金不足或组合回撤接近15%",
    thesis: "分散度和透明度高，较适合小额定期投入的基础研究仓位。",
    counter: "指数仍会随市场整体下跌，短期不保证正收益。",
    sourceState: "demo",
  },
  {
    symbol: "000001",
    name: "华夏成长混合",
    type: "fund",
    market: "场外基金",
    sector: "主动混合",
    price: "待正式净值",
    change: 0,
    status: "继续观察",
    confidence: 55,
    horizon: "3—12个月",
    range: "待基金正式净值与费率数据确认",
    invalidation: "风格持续漂移、基金经理变化或规模风险上升",
    thesis: "作为真实基金搜索与报告结构的样本，必须在正式数据接入后再比较。",
    counter: "主动基金需验证基金经理稳定性、费用与长期超额收益。",
    sourceState: "demo",
  },
];

export const marketBreadth = [38, 46, 42, 55, 51, 64, 59, 68, 62, 71, 66, 69];

export const newsItems = [
  { type: "任务", title: "周一报告将在周日20:00生成", time: "规则已配置", tone: "info" },
  { type: "数据", title: "免费公开行情搜索已接入", time: "无稳定性承诺，需交叉核验", tone: "warn" },
  { type: "盘前", title: "08:30仅追加风险变化，不覆盖原报告", time: "审计规则", tone: "safe" },
];
