export type HistoricalPoint = {
  date: string;
  value: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
};

export type MarketMetrics = {
  sampleSize: number;
  latestDate: string;
  latestValue: number;
  return5: number | null;
  return20: number | null;
  return60: number | null;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  volatility20Annualized: number | null;
  maxDrawdown60: number | null;
  low20: number | null;
  high20: number | null;
  rangePosition20: number | null;
  atr14: number | null;
  atr14Percent: number | null;
  trend: "up" | "down" | "mixed" | "insufficient";
};

function rounded(value: number, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function movingAverage(points: HistoricalPoint[], period: number) {
  if (points.length < period) return null;
  return rounded(average(points.slice(-period).map((point) => point.value)));
}

function periodReturn(points: HistoricalPoint[], period: number) {
  if (points.length <= period) return null;
  const previous = points[points.length - 1 - period].value;
  if (previous <= 0) return null;
  return rounded((points.at(-1)!.value / previous - 1) * 100, 2);
}

function annualizedVolatility(points: HistoricalPoint[], period: number) {
  if (points.length < 3) return null;
  const window = points.slice(-(period + 1));
  const returns: number[] = [];
  for (let index = 1; index < window.length; index += 1) {
    if (window[index - 1].value > 0 && window[index].value > 0) returns.push(Math.log(window[index].value / window[index - 1].value));
  }
  if (returns.length < 2) return null;
  const mean = average(returns);
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return rounded(Math.sqrt(variance) * Math.sqrt(252) * 100, 2);
}

function maxDrawdown(points: HistoricalPoint[], period: number) {
  const window = points.slice(-period);
  if (window.length < 2) return null;
  let peak = window[0].value;
  let worst = 0;
  for (const point of window) {
    peak = Math.max(peak, point.value);
    if (peak > 0) worst = Math.min(worst, point.value / peak - 1);
  }
  return rounded(worst * 100, 2);
}

function averageTrueRange(points: HistoricalPoint[], period: number) {
  const usable = points.filter((point) => Number.isFinite(point.high) && Number.isFinite(point.low));
  if (usable.length <= period) return null;
  const ranges: number[] = [];
  for (let index = 1; index < usable.length; index += 1) {
    const high = usable[index].high!;
    const low = usable[index].low!;
    const previousClose = usable[index - 1].value;
    ranges.push(Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose)));
  }
  return rounded(average(ranges.slice(-period)));
}

export function calculateMarketMetrics(rawPoints: HistoricalPoint[]): MarketMetrics {
  const points = rawPoints
    .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value) && point.value > 0)
    .sort((left, right) => left.date.localeCompare(right.date));
  if (!points.length) throw new Error("EMPTY_HISTORY");
  const latestValue = points.at(-1)!.value;
  const ma5 = movingAverage(points, 5);
  const ma10 = movingAverage(points, 10);
  const ma20 = movingAverage(points, 20);
  const window20 = points.slice(-20).map((point) => point.value);
  const low20 = window20.length ? Math.min(...window20) : null;
  const high20 = window20.length ? Math.max(...window20) : null;
  const position = low20 !== null && high20 !== null && high20 > low20 ? ((latestValue - low20) / (high20 - low20)) * 100 : null;
  const atr14 = averageTrueRange(points, 14);
  let trend: MarketMetrics["trend"] = "insufficient";
  if (ma5 !== null && ma10 !== null && ma20 !== null) {
    if (latestValue > ma5 && ma5 > ma10 && ma10 > ma20) trend = "up";
    else if (latestValue < ma5 && ma5 < ma10 && ma10 < ma20) trend = "down";
    else trend = "mixed";
  }
  return {
    sampleSize: points.length,
    latestDate: points.at(-1)!.date,
    latestValue: rounded(latestValue),
    return5: periodReturn(points, 5),
    return20: periodReturn(points, 20),
    return60: periodReturn(points, 60),
    ma5,
    ma10,
    ma20,
    volatility20Annualized: annualizedVolatility(points, 20),
    maxDrawdown60: maxDrawdown(points, 60),
    low20: low20 === null ? null : rounded(low20),
    high20: high20 === null ? null : rounded(high20),
    rangePosition20: position === null ? null : rounded(position, 1),
    atr14,
    atr14Percent: atr14 === null ? null : rounded((atr14 / latestValue) * 100, 2),
    trend,
  };
}
