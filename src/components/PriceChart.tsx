"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Line, Bar } from "react-chartjs-2";
import { formatCoins } from "@/lib/format";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip);

interface PricePoint {
  price: number;
  timestamp: number;
  holder_count?: number;
}

interface Transaction {
  type: string;
  shares: number;
  price_per_share: number;
  created_at: string;
  status?: string;
}

interface PendingOrder {
  shares: number;
  created_at: string;
}

type TimeFilter = "1h" | "1d" | "7d" | "1m" | "6m" | "all";
type ViewMode = "price" | "trades";

const FILTER_OPTIONS: { key: TimeFilter; label: string; ms: number | null }[] = [
  { key: "1h", label: "1H", ms: 60 * 60 * 1000 },
  { key: "1d", label: "1D", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1m", label: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "6m", label: "6M", ms: 180 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: null },
];

interface MarketSchedule {
  openHour: number;
  closeHour: number;
  tradingDays: number[];
  emergencyClose: boolean;
  isOpen: boolean;
}

const AEST_OFFSET_MS = 10 * 3600000;

function toAEST(ms: number): Date {
  const d = new Date(ms);
  const utcMs = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utcMs + AEST_OFFSET_MS);
}

function isMarketOpenAt(ms: number, sched: MarketSchedule): boolean {
  if (sched.emergencyClose) return false;
  const d = toAEST(ms);
  if (!sched.tradingDays.includes(d.getDay())) return false;
  const h = d.getHours();
  return h >= sched.openHour && h < sched.closeHour;
}

function sessionKey(ms: number, sched: MarketSchedule): string | null {
  if (!isMarketOpenAt(ms, sched)) return null;
  const d = toAEST(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${sched.openHour}`;
}

function downsampleTo5Min(data: PricePoint[]): PricePoint[] {
  if (data.length <= 12) return data;
  const bucketMs = 5 * 60 * 1000;
  const out: PricePoint[] = [];
  for (const p of data) {
    const b = Math.floor(p.timestamp / bucketMs) * bucketMs;
    const last = out[out.length - 1];
    if (last && Math.floor(last.timestamp / bucketMs) * bucketMs === b) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

function interpolateGaps(data: PricePoint[], currentPrice: number, sched: MarketSchedule): (PricePoint | null)[] {
  if (data.length === 0) return [{ price: currentPrice, timestamp: Date.now() }];

  const HOUR_MS = 60 * 60 * 1000;
  const result: (PricePoint | null)[] = [data[0]];

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    const prevSession = sessionKey(prev.timestamp, sched);
    const currSession = sessionKey(curr.timestamp, sched);

    if (prevSession && currSession && prevSession === currSession) {
      const gapMs = curr.timestamp - prev.timestamp;
      const gapHours = Math.floor(gapMs / HOUR_MS);
      if (gapHours > 1) {
        for (let h = 1; h < gapHours; h++) {
          const t = prev.timestamp + h * HOUR_MS;
          if (isMarketOpenAt(t, sched)) {
            const fraction = h / gapHours;
            const interpolatedPrice = Math.round(prev.price + (curr.price - prev.price) * fraction);
            result.push({ price: interpolatedPrice, timestamp: t, holder_count: prev.holder_count });
          }
        }
      }
    } else {
      result.push(null);
    }
    result.push(curr);
  }

  return result;
}

function getBucketConfig(filter: TimeFilter) {
  switch (filter) {
    case "1h":
      return { bucketSize: 5 * 60 * 1000, formatLabel: (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    case "1d":
      return { bucketSize: 10 * 60 * 1000, formatLabel: (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
    case "7d":
      return { bucketSize: 60 * 60 * 1000, formatLabel: (ts: number) => new Date(ts).toLocaleDateString([], { weekday: "short", hour: "2-digit" }) };
    case "1m":
      return { bucketSize: 24 * 60 * 60 * 1000, formatLabel: (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" }) };
    case "6m":
      return { bucketSize: 7 * 24 * 60 * 60 * 1000, formatLabel: (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" }) };
    default:
      return { bucketSize: 30 * 24 * 60 * 60 * 1000, formatLabel: (ts: number) => new Date(ts).toLocaleDateString([], { month: "short", year: "2-digit" }) };
  }
}

interface TradeSeries {
  labels: string[];
  transactions: number[];
  avgPrices: number[];
  buys: number[];
  sells: number[];
}

function buildTradeSeries(
  transactions: Transaction[] | undefined,
  buyOrders: PendingOrder[] | undefined,
  sellOrders: PendingOrder[] | undefined,
  filter: TimeFilter,
  sched: MarketSchedule
): TradeSeries | null {
  const now = Date.now();
  const option = FILTER_OPTIONS.find((f) => f.key === filter);

  const inRange = (ts: string) => (!option?.ms || new Date(ts).getTime() >= now - option.ms) && isMarketOpenAt(new Date(ts).getTime(), sched);

  const tx = (transactions || []).filter((t) => inRange(t.created_at));
  const buys = (buyOrders || []).filter((o) => inRange(o.created_at));
  const sells = (sellOrders || []).filter((o) => inRange(o.created_at));

  if (tx.length === 0 && buys.length === 0 && sells.length === 0) return null;

  const { bucketSize, formatLabel } = getBucketConfig(filter);

  const allTimes = [
    ...tx.map((t) => new Date(t.created_at).getTime()),
    ...buys.map((o) => new Date(o.created_at).getTime()),
    ...sells.map((o) => new Date(o.created_at).getTime()),
  ];
  const minTime = Math.min(...allTimes);
  const maxTime = Math.max(...allTimes);

  const buckets = new Map<number, { tx: number; totalPrice: number; buys: number; sells: number }>();
  for (let b = Math.floor(minTime / bucketSize) * bucketSize; b <= maxTime; b += bucketSize) {
    if (!isMarketOpenAt(b, sched)) continue;
    buckets.set(b, { tx: 0, totalPrice: 0, buys: 0, sells: 0 });
  }

  for (const t of tx) {
    const b = Math.floor(new Date(t.created_at).getTime() / bucketSize) * bucketSize;
    const bucket = buckets.get(b);
    if (!bucket) continue;
    const shares = Number(t.shares) || 1;
    bucket.tx += shares;
    bucket.totalPrice += shares * (Number(t.price_per_share) || 0);
  }

  for (const o of buys) {
    const b = Math.floor(new Date(o.created_at).getTime() / bucketSize) * bucketSize;
    const bucket = buckets.get(b);
    if (!bucket) continue;
    bucket.buys += Number(o.shares) || 0;
  }

  for (const o of sells) {
    const b = Math.floor(new Date(o.created_at).getTime() / bucketSize) * bucketSize;
    const bucket = buckets.get(b);
    if (!bucket) continue;
    bucket.sells += Number(o.shares) || 0;
  }

  const sorted = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);

  return {
    labels: sorted.map(([ts]) => formatLabel(ts)),
    transactions: sorted.map(([, v]) => v.tx),
    avgPrices: sorted.map(([, v]) => (v.tx > 0 ? v.totalPrice / v.tx : 0)),
    buys: sorted.map(([, v]) => v.buys),
    sells: sorted.map(([, v]) => v.sells),
  };
}

export default function PriceChart({
  priceHistory,
  currentPrice,
  transactions,
  pendingBuyCount = 0,
  pendingSellCount = 0,
  pendingBuyOrders,
  pendingSellOrders,
}: {
  priceHistory: PricePoint[];
  currentPrice: number;
  transactions?: Transaction[];
  pendingBuyCount?: number;
  pendingSellCount?: number;
  pendingBuyOrders?: PendingOrder[];
  pendingSellOrders?: PendingOrder[];
}) {
  const [filter, setFilter] = useState<TimeFilter>("7d");
  const [viewMode, setViewMode] = useState<ViewMode>("price");
  const [showHolders, setShowHolders] = useState(false);
  const [showTradesTx, setShowTradesTx] = useState(true);
  const [showTradesBuy, setShowTradesBuy] = useState(true);
  const [showTradesSell, setShowTradesSell] = useState(true);
  const hasAnimated = useRef(false);
  const [schedule, setSchedule] = useState<MarketSchedule>({ openHour: 0, closeHour: 24, tradingDays: [0, 1, 2, 3, 4, 5, 6], emergencyClose: false, isOpen: true });

  useEffect(() => {
    let active = true;
    const load = () => {
      fetch(`/api/trading-status?t=${Date.now()}`)
        .then((r) => r.json())
        .then((d: any) => {
          if (!active || !d) return;
          setSchedule({
            openHour: d.openHour ?? 0,
            closeHour: d.closeHour ?? 24,
            tradingDays: Array.isArray(d.tradingDays) && d.tradingDays.length ? d.tradingDays : [0, 1, 2, 3, 4, 5, 6],
            emergencyClose: !!d.emergencyClose,
            isOpen: d.isOpen !== false,
          });
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60000);
    return () => { active = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { hasAnimated.current = true; }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const filteredData = useMemo(() => {
    const now = Date.now();
    const option = FILTER_OPTIONS.find((f) => f.key === filter);
    let data = priceHistory;
    if (option?.ms) {
      const cutoff = now - option.ms;
      data = priceHistory.filter((p) => p.timestamp >= cutoff);
    }
    data = data.filter((p) => (p.price || 0) > 0 && isMarketOpenAt(p.timestamp, schedule));
    if (filter === "1h") data = downsampleTo5Min(data);
    return interpolateGaps(data, currentPrice, schedule);
  }, [priceHistory, filter, currentPrice, schedule]);

  const tradeSeries = useMemo(
    () => buildTradeSeries(transactions, pendingBuyOrders, pendingSellOrders, filter, schedule),
    [transactions, pendingBuyOrders, pendingSellOrders, filter, schedule]
  );

  const validPoints = useMemo(() => filteredData.filter((p): p is PricePoint => p !== null), [filteredData]);

  const holdersYScale = useMemo(() => {
    if (validPoints.length === 0) return { min: 0, max: 10 };
    const holders = validPoints.map((p) => p.holder_count ?? 0);
    const maxH = Math.max(...holders);
    const range = maxH;
    const padding = range > 0 ? Math.max(range * 0.15, 1) : 2;
    return { min: 1, max: Math.ceil(maxH + padding) };
  }, [validPoints]);

  const priceChartData = useMemo(() => {
    if (validPoints.length === 0) {
      return {
        labels: ["No data"],
        datasets: [{ data: [0], borderColor: "#3b82f6", backgroundColor: "rgba(59, 130, 246, 0.1)", fill: true, tension: 0.4, pointRadius: 0 }],
      };
    }

    const labels = filteredData.map((p) => {
      if (!p) return "";
      const date = new Date(p.timestamp);
      if (filter === "1h") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (filter === "1d") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (filter === "7d") return date.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    });

    const prices = filteredData.map((p) => (p ? p.price / 100 : null));
    const firstPrice = validPoints[0].price / 100;
    const lastPrice = validPoints[validPoints.length - 1].price / 100;
    const isUp = lastPrice >= firstPrice;
    const lineColor = isUp ? "#22c55e" : "#ef4444";
    const bgColor = isUp ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)";

    const datasets: any[] = [
      {
        label: "Price",
        data: prices,
        borderColor: lineColor,
        backgroundColor: bgColor,
        fill: true,
        tension: 0.4,
        spanGaps: false,
        pointRadius: validPoints.length < 30 ? 3 : 0,
        pointBackgroundColor: lineColor,
        borderWidth: 2,
        yAxisID: "y",
      },
    ];

    if (showHolders) {
      const holders = filteredData.map((p) => (p ? (p.holder_count ?? 0) : null));
      datasets.push({
        label: "Holders",
        data: holders,
        borderColor: "#a78bfa",
        backgroundColor: "rgba(167, 139, 250, 0.05)",
        fill: true,
        tension: 0.3,
        spanGaps: false,
        pointRadius: 0,
        pointBackgroundColor: "#a78bfa",
        borderWidth: 1.5,
        yAxisID: "y1",
      });
    }

    return { labels, datasets };
  }, [filteredData, validPoints, filter, showHolders]);

  const tradeChartData = useMemo(() => {
    const datasets: any[] = [];
    if (showTradesTx) {
      datasets.push({
        label: "Transactions",
        data: tradeSeries ? tradeSeries.transactions : [0],
        backgroundColor: "rgba(99, 102, 241, 0.7)",
        borderRadius: 4,
        yAxisID: "y",
      });
    }
    if (showTradesBuy) {
      datasets.push({
        label: "Buy Orders",
        data: tradeSeries ? tradeSeries.buys : [0],
        backgroundColor: "rgba(34, 197, 94, 0.7)",
        borderRadius: 4,
        yAxisID: "y1",
      });
    }
    if (showTradesSell) {
      datasets.push({
        label: "Sell Orders",
        data: tradeSeries ? tradeSeries.sells : [0],
        backgroundColor: "rgba(239, 68, 68, 0.7)",
        borderRadius: 4,
        yAxisID: "y1",
      });
    }
    if (datasets.length === 0) {
      datasets.push({ label: "No data", data: [0], backgroundColor: "rgba(75, 85, 99, 0.5)", borderRadius: 4, yAxisID: "y" });
    }
    return {
      labels: tradeSeries ? tradeSeries.labels : ["No data"],
      datasets,
    };
  }, [tradeSeries, showTradesTx, showTradesBuy, showTradesSell]);

  const yScale = useMemo(() => {
    if (validPoints.length === 0) return { min: 0, max: 1 };
    const prices = validPoints.map((p) => p.price / 100);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP;
    const padding = range > 0 ? range * 0.15 : Math.max(minP * 0.5, 0.5);
    return {
      min: Math.max(0, minP - padding),
      max: maxP + padding,
    };
  }, [validPoints]);

  const priceOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: hasAnimated.current ? false : { duration: 800, easing: "easeOutQuart" } as any,
      plugins: {
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.8)",
          titleColor: "#fff",
          bodyColor: "#fff",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          callbacks: {
            label: (ctx: any) => {
              if (ctx.dataset.yAxisID === "y1") return `${ctx.parsed.y} holder${ctx.parsed.y !== 1 ? "s" : ""}`;
              return `${ctx.parsed.y.toFixed(2)}c`;
            },
          },
        },
        legend: showHolders ? {
          display: true,
          labels: { color: "#9ca3af", font: { size: 11 }, boxWidth: 12 },
        } : { display: false },
      },
      scales: {
        x: {
          display: true,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#6b7280", maxTicksLimit: 8, font: { size: 11 } },
          border: { display: false },
        },
        y: {
          display: true,
          position: "left" as const,
          min: yScale.min,
          max: yScale.max,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: {
            color: "#6b7280",
            font: { size: 11 },
            callback: (val: any) => `${val.toFixed(2)}c`,
          },
          border: { display: false },
        },
        ...(showHolders && {
          y1: {
            display: true,
            position: "right" as const,
            min: holdersYScale.min,
            max: holdersYScale.max,
            grid: { drawOnChartArea: false },
            ticks: {
              color: "#a78bfa",
              font: { size: 11 },
              stepSize: 1,
              callback: (val: any) => `${val}`,
            },
            border: { display: false },
          },
        }),
      },
      interaction: {
        intersect: false,
        mode: "index" as const,
      },
    }),
    [yScale, showHolders, holdersYScale]
  );

  const maxOrderCount = useMemo(() => {
    if (!tradeSeries) return Math.max(pendingBuyCount, pendingSellCount, 1) * 1.2;
    const peak = Math.max(...tradeSeries.buys, ...tradeSeries.sells, 1);
    return peak * 1.2;
  }, [tradeSeries, pendingBuyCount, pendingSellCount]);

  const tradeOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: hasAnimated.current ? false : { duration: 800, easing: "easeOutQuart" } as any,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(17,24,39,0.95)",
          titleColor: "#f3f4f6",
          bodyColor: "#d1d5db",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 8,
          bodySpacing: 6,
          titleFont: { size: 13, weight: "bold" as const },
          bodyFont: { size: 12 },
          callbacks: {
            title: (items: any[]) => {
              if (!items.length) return "";
              return items[0].label || "";
            },
            label: (ctx: any) => {
              const idx = ctx.dataIndex;
              const label = ctx.dataset.label;
              const val = ctx.parsed.y;
              if (val === 0) return;
              if (label === "Transactions") {
                const avgPrice = tradeSeries?.avgPrices[idx];
                if (avgPrice && avgPrice > 0) {
                  return `${val} share${val !== 1 ? "s" : ""} traded @ avg ${formatCoins(Math.round(avgPrice))}`;
                }
                return `${val} share${val !== 1 ? "s" : ""} traded`;
              }
              if (label === "Buy Orders") return `${val.toLocaleString()} share${val !== 1 ? "s" : ""} in buy orders`;
              return `${val.toLocaleString()} share${val !== 1 ? "s" : ""} in sell orders`;
            },
          },
        },
      },
      scales: {
        x: {
          display: true,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#6b7280", maxTicksLimit: 8, font: { size: 11 } },
          border: { display: false },
        },
        y: {
          display: showTradesTx,
          position: "left" as const,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: {
            color: "#6b7280",
            font: { size: 11 },
            stepSize: 1,
            callback: (val: any) => val,
          },
          border: { display: false },
          title: {
            display: showTradesTx,
            text: "Shares",
            color: "#6b7280",
            font: { size: 10 },
          },
        },
        y1: {
          display: showTradesBuy || showTradesSell,
          position: "right" as const,
          min: 0,
          max: maxOrderCount + 1,
          grid: { drawOnChartArea: false },
          ticks: {
            color: "#6b7280",
            font: { size: 10 },
            callback: (val: any) => Number.isInteger(val) ? val.toLocaleString() : "",
          },
          border: { display: false },
          title: {
            display: showTradesBuy || showTradesSell,
            text: "Shares",
            color: "#6b7280",
            font: { size: 10 },
          },
        },
      },
      interaction: {
        intersect: false,
        mode: "index" as const,
      },
    }),
    [tradeSeries, maxOrderCount, showTradesTx, showTradesBuy, showTradesSell]
  );

  const displayPrice = validPoints.length > 0 ? validPoints[validPoints.length - 1].price / 100 : 0;
  const startPrice = validPoints.length > 0 ? validPoints[0].price / 100 : 0;
  const change = displayPrice - startPrice;
  const changePercent = startPrice > 0 ? ((change / startPrice) * 100).toFixed(2) : "0.00";

  const chartKey = `${filter}-${viewMode}-${showHolders}`;

  const totalTx = (tradeSeries?.transactions || []).reduce((a, b) => a + b, 0) || 0;

  return (
    <div className="glass-card">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">
            {viewMode === "price" ? "Price History" : "Trade Activity"}
          </h3>
          <div className="flex items-center gap-2 mt-1">
            {viewMode === "price" ? (
              <>
                <span className="text-xl font-bold text-white">{formatCoins(displayPrice * 100)}</span>
                <span className={`text-sm font-medium ${change >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {change >= 0 ? "+" : ""}{formatCoins(change * 100)} ({change >= 0 ? "+" : ""}{changePercent}%)
                </span>
              </>
            ) : (
              <>
                <span className="text-sm text-indigo-400 font-medium">{totalTx} traded</span>
                <span className="text-gray-600">·</span>
                <span className="text-sm text-green-400 font-medium">{pendingBuyCount.toLocaleString()} buy shares</span>
                <span className="text-gray-600">·</span>
                <span className="text-sm text-red-400 font-medium">{pendingSellCount.toLocaleString()} sell shares</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
            <button
              onClick={() => setViewMode("price")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "price"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              Price
            </button>
            <button
              onClick={() => setViewMode("trades")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                viewMode === "trades"
                  ? "bg-blue-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-700"
              }`}
            >
              Trades
            </button>
          </div>
          <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
            {FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  filter === opt.key
                    ? "bg-blue-600 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {viewMode === "price" && (
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setShowHolders(!showHolders)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
              showHolders
                ? "bg-violet-600/30 text-violet-300 border border-violet-500/40"
                : "text-gray-500 hover:text-gray-300 border border-gray-700/50"
            }`}
          >
            <span className={`w-3 h-3 rounded-sm transition-colors ${
              showHolders ? "bg-violet-400" : "bg-gray-600"
            }`} />
            Holders
          </button>
        </div>
      )}
      <div className="h-64 sm:h-80">
        {viewMode === "price" ? (
          <Line key={chartKey} data={priceChartData} options={priceOptions} />
        ) : (
          <Bar key={chartKey} data={tradeChartData} options={tradeOptions} />
        )}
      </div>
      {viewMode === "trades" && tradeChartData.labels.length > 1 && (
        <div className="flex items-center justify-center gap-4 mt-2 text-xs flex-wrap">
          <button onClick={() => setShowTradesTx(v => !v)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${showTradesTx ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/40" : "text-gray-500 border border-gray-700/50"}`}>
            <span className={`w-3 h-3 rounded-sm transition-colors ${showTradesTx ? "bg-indigo-400" : "bg-gray-600"}`} />
            Transactions ({totalTx})
          </button>
          <button onClick={() => setShowTradesBuy(v => !v)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${showTradesBuy ? "bg-green-600/20 text-green-300 border border-green-500/40" : "text-gray-500 border border-gray-700/50"}`}>
            <span className={`w-3 h-3 rounded-sm transition-colors ${showTradesBuy ? "bg-green-400" : "bg-gray-600"}`} />
            Buy Orders ({pendingBuyCount.toLocaleString()})
          </button>
          <button onClick={() => setShowTradesSell(v => !v)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${showTradesSell ? "bg-red-600/20 text-red-300 border border-red-500/40" : "text-gray-500 border border-gray-700/50"}`}>
            <span className={`w-3 h-3 rounded-sm transition-colors ${showTradesSell ? "bg-red-400" : "bg-gray-600"}`} />
            Sell Orders ({pendingSellCount.toLocaleString()})
          </button>
        </div>
      )}
    </div>
  );
}
