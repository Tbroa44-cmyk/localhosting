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
}

interface Transaction {
  type: string;
  shares: number;
  price_per_share: number;
  created_at: string;
  status?: string;
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

function interpolateGaps(data: PricePoint[], now: number, currentPrice: number): PricePoint[] {
  if (data.length === 0) return [{ price: currentPrice, timestamp: now }];
  if (data.length === 1) {
    if (data[0].timestamp < now - 60_000) {
      return [data[0], { price: currentPrice, timestamp: now }];
    }
    return [...data, { price: currentPrice, timestamp: now }];
  }

  const HOUR_MS = 60 * 60 * 1000;
  const result: PricePoint[] = [data[0]];

  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1];
    const curr = data[i];
    const gapMs = curr.timestamp - prev.timestamp;
    const gapHours = Math.floor(gapMs / HOUR_MS);

    if (gapHours > 1) {
      for (let h = 1; h < gapHours; h++) {
        const t = prev.timestamp + h * HOUR_MS;
        const fraction = h / gapHours;
        const interpolatedPrice = Math.round(prev.price + (curr.price - prev.price) * fraction);
        result.push({ price: interpolatedPrice, timestamp: t });
      }
    }
    result.push(curr);
  }

  result.push({ price: currentPrice, timestamp: now });

  return result;
}

function groupTransactionsByTime(transactions: Transaction[], filter: TimeFilter) {
  const now = Date.now();
  const option = FILTER_OPTIONS.find((f) => f.key === filter);
  let filtered = transactions;

  if (option?.ms) {
    const cutoff = now - option.ms;
    filtered = transactions.filter((t) => new Date(t.created_at).getTime() >= cutoff);
  }

  let bucketSize: number;
  let formatLabel: (ts: number) => string;

  switch (filter) {
    case "1h":
      bucketSize = 5 * 60 * 1000;
      formatLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      break;
    case "1d":
      bucketSize = 60 * 60 * 1000;
      formatLabel = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      break;
    case "7d":
      bucketSize = 24 * 60 * 60 * 1000;
      formatLabel = (ts) => new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      break;
    case "1m":
      bucketSize = 24 * 60 * 60 * 1000;
      formatLabel = (ts) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
      break;
    case "6m":
      bucketSize = 7 * 24 * 60 * 60 * 1000;
      formatLabel = (ts) => new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
      break;
    default:
      bucketSize = 30 * 24 * 60 * 60 * 1000;
      formatLabel = (ts) => new Date(ts).toLocaleDateString([], { month: "short", year: "2-digit" });
  }

  if (filtered.length === 0) {
    return { labels: ["No data"], buys: [0], sells: [0], confirmedBuys: [0], confirmedSells: [0], rawBuys: [0], rawSells: [0] };
  }

  const minTime = Math.min(...filtered.map((t) => new Date(t.created_at).getTime()));
  const maxTime = Math.max(...filtered.map((t) => new Date(t.created_at).getTime()));

  const buckets = new Map<number, { buys: number; sells: number; confirmedBuys: number; confirmedSells: number }>();

  for (const tx of filtered) {
    const txTime = new Date(tx.created_at).getTime();
    const bucketStart = Math.floor((txTime - minTime) / bucketSize) * bucketSize + minTime;
    if (!buckets.has(bucketStart)) {
      buckets.set(bucketStart, { buys: 0, sells: 0, confirmedBuys: 0, confirmedSells: 0 });
    }
    const bucket = buckets.get(bucketStart)!;
    const shares = Number(tx.shares) || 1;
    const isConfirmed = tx.status === "confirmed";
    if (String(tx.type).toLowerCase().includes("buy")) {
      bucket.buys += shares;
      if (isConfirmed) bucket.confirmedBuys += shares;
    } else {
      bucket.sells += shares;
      if (isConfirmed) bucket.confirmedSells += shares;
    }
  }

  const sortedBuckets = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);

  return {
    labels: sortedBuckets.map(([ts]) => formatLabel(ts)),
    buys: sortedBuckets.map(([, b]) => b.buys),
    sells: sortedBuckets.map(([, b]) => b.sells),
    confirmedBuys: sortedBuckets.map(([, b]) => b.confirmedBuys),
    confirmedSells: sortedBuckets.map(([, b]) => b.confirmedSells),
    rawBuys: sortedBuckets.map(([, b]) => b.buys),
    rawSells: sortedBuckets.map(([, b]) => b.sells),
  };
}

export default function PriceChart({
  priceHistory,
  currentPrice,
  transactions,
}: {
  priceHistory: PricePoint[];
  currentPrice: number;
  transactions?: Transaction[];
}) {
  const [filter, setFilter] = useState<TimeFilter>("7d");
  const [viewMode, setViewMode] = useState<ViewMode>("price");
  const hasAnimated = useRef(false);

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
    return interpolateGaps(data, now, currentPrice);
  }, [priceHistory, filter, currentPrice]);

  const priceChartData = useMemo(() => {
    if (filteredData.length === 0) {
      return {
        labels: ["No data"],
        datasets: [{ data: [0], borderColor: "#3b82f6", backgroundColor: "rgba(59, 130, 246, 0.1)", fill: true, tension: 0.4, pointRadius: 0 }],
      };
    }

    const labels = filteredData.map((p) => {
      const date = new Date(p.timestamp);
      if (filter === "1h") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (filter === "1d") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (filter === "7d") return date.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    });

    const prices = filteredData.map((p) => p.price / 100);
    const firstPrice = prices[0];
    const lastPrice = prices[prices.length - 1];
    const isUp = lastPrice >= firstPrice;
    const lineColor = isUp ? "#22c55e" : "#ef4444";
    const bgColor = isUp ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)";

    return {
      labels,
      datasets: [
        {
          data: prices,
          borderColor: lineColor,
          backgroundColor: bgColor,
          fill: true,
          tension: 0.4,
          pointRadius: filteredData.length < 30 ? 3 : 0,
          pointBackgroundColor: lineColor,
          borderWidth: 2,
        },
      ],
    };
  }, [filteredData, filter]);

  const tradeChartData = useMemo(() => {
    if (!transactions || transactions.length === 0) {
      return {
        labels: ["No trades"],
        datasets: [
          { data: [0], backgroundColor: "rgba(34, 197, 94, 0.7)", borderRadius: 4 },
          { data: [0], backgroundColor: "rgba(239, 68, 68, 0.7)", borderRadius: 4 },
        ],
      };
    }

    const grouped = groupTransactionsByTime(transactions, filter);

    return {
      labels: grouped.labels,
      datasets: [
        {
          label: "Buys (pending)",
          data: grouped.buys.map((b, i) => b - grouped.confirmedBuys[i]),
          backgroundColor: "rgba(34, 197, 94, 0.7)",
          borderRadius: 4,
          stack: "buys",
        },
        {
          label: "Buys (confirmed)",
          data: grouped.confirmedBuys,
          backgroundColor: "rgba(59, 130, 246, 0.8)",
          borderRadius: 4,
          stack: "buys",
        },
        {
          label: "Sells (pending)",
          data: grouped.sells.map((s, i) => s - grouped.confirmedSells[i]),
          backgroundColor: "rgba(239, 68, 68, 0.7)",
          borderRadius: 4,
          stack: "sells",
        },
        {
          label: "Sells (confirmed)",
          data: grouped.confirmedSells,
          backgroundColor: "rgba(59, 130, 246, 0.8)",
          borderRadius: 4,
          stack: "sells",
        },
      ],
    };
  }, [transactions, filter]);

  const yScale = useMemo(() => {
    if (filteredData.length === 0) return { min: 0, max: 1 };
    const prices = filteredData.map((p) => p.price / 100);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP;
    const padding = range > 0 ? range * 0.15 : Math.max(minP * 0.5, 0.5);
    return {
      min: Math.max(0, minP - padding),
      max: maxP + padding,
    };
  }, [filteredData]);

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
            label: (ctx: any) => `${ctx.parsed.y.toFixed(2)}c`,
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
          display: true,
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
      },
      interaction: {
        intersect: false,
        mode: "index" as const,
      },
    }),
    [yScale]
  );

  const tradeOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: hasAnimated.current ? false : { duration: 800, easing: "easeOutQuart" } as any,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(0,0,0,0.8)",
          titleColor: "#fff",
          bodyColor: "#fff",
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
        },
      },
      scales: {
        x: {
          display: true,
          stacked: true,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#6b7280", maxTicksLimit: 8, font: { size: 11 } },
          border: { display: false },
        },
        y: {
          display: true,
          stacked: true,
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: {
            color: "#6b7280",
            font: { size: 11 },
            stepSize: 1,
            callback: (val: any) => val,
          },
          border: { display: false },
        },
      },
      interaction: {
        intersect: false,
        mode: "index" as const,
      },
    }),
    []
  );

  const displayPrice = filteredData.length > 0 ? filteredData[filteredData.length - 1].price / 100 : 0;
  const startPrice = filteredData.length > 0 ? filteredData[0].price / 100 : 0;
  const change = displayPrice - startPrice;
  const changePercent = startPrice > 0 ? ((change / startPrice) * 100).toFixed(2) : "0.00";

  const chartKey = `${filter}-${viewMode}`;

  const totalBuys = (tradeChartData.datasets[0]?.data.reduce((a: number, b: number) => a + (b as number), 0) || 0)
    + (tradeChartData.datasets[1]?.data.reduce((a: number, b: number) => a + (b as number), 0) || 0);
  const totalSells = (tradeChartData.datasets[2]?.data.reduce((a: number, b: number) => a + (b as number), 0) || 0)
    + (tradeChartData.datasets[3]?.data.reduce((a: number, b: number) => a + (b as number), 0) || 0);

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
                <span className="text-sm text-green-400 font-medium">{totalBuys} bought</span>
                <span className="text-gray-600">·</span>
                <span className="text-sm text-red-400 font-medium">{totalSells} sold</span>
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
      <div className="h-64 sm:h-80">
        {viewMode === "price" ? (
          <Line key={chartKey} data={priceChartData} options={priceOptions} />
        ) : (
          <Bar key={chartKey} data={tradeChartData} options={tradeOptions} />
        )}
      </div>
      {viewMode === "trades" && tradeChartData.labels.length > 1 && (
        <div className="flex items-center justify-center gap-6 mt-2 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(34, 197, 94, 0.7)" }} />
            <span className="text-gray-400">Buys ({totalBuys})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(239, 68, 68, 0.7)" }} />
            <span className="text-gray-400">Sells ({totalSells})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: "rgba(59, 130, 246, 0.8)" }} />
            <span className="text-gray-400">Confirmed</span>
          </div>
        </div>
      )}
    </div>
  );
}
