"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from "chart.js";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { formatCoins } from "@/lib/format";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

interface Holding {
  id: number;
  company_id: number;
  shares_owned: number;
  company_name: string;
  ticker: string;
  share_price: number;
  total_shares: number;
}

interface Transaction {
  id: number;
  type: string;
  shares: number;
  price_per_share: number;
  total_amount: number;
  company_name: string;
  ticker: string;
  created_at: string;
}

interface PendingOrder {
  id: number;
  company_id: number;
  type: string;
  shares: number;
  price_per_share: number;
  status: string;
  ticker: string;
  name: string;
  current_price: number;
  created_at: string;
}

type TimeFilter = "1d" | "7d" | "1m" | "6m" | "1y" | "all";

const FILTER_OPTIONS: { key: TimeFilter; label: string; ms: number | null }[] = [
  { key: "1d", label: "1D", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "7D", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "1m", label: "1M", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "6m", label: "6M", ms: 180 * 24 * 60 * 60 * 1000 },
  { key: "1y", label: "1Y", ms: 365 * 24 * 60 * 60 * 1000 },
  { key: "all", label: "All", ms: null },
];

const PIE_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#8b5cf6"];

export default function PortfolioPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalValue, setTotalValue] = useState(0);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [priceHistories, setPriceHistories] = useState<Record<number, { price: number; timestamp: number }[]>>({});
  const [earningsFilter, setEarningsFilter] = useState<TimeFilter>("7d");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 5000);
    return () => clearInterval(interval);
  }, []);

  function fetchPortfolio() {
    fetch("/api/portfolio")
      .then((res) => res.json())
      .then((data) => {
        setHoldings(data.holdings || []);
        setTransactions(data.transactions || []);
        setTotalValue(data.totalValue || 0);
        setPriceHistories(data.priceHistories || {});
      })
      .catch(console.error);

    fetch("/api/orders")
      .then((res) => res.json())
      .then((data) => setOrders(data))
      .catch(() => {});
  }

  async function cancelOrder(orderId: number) {
    try {
      await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      fetchPortfolio();
    } catch (err) {
      console.error(err);
    }
  }

  const userBalance = (session?.user as any)?.balance || 0;
  const totalPortfolio = userBalance + totalValue;
  const pendingOrders = orders.filter((o) => o.status === "pending");

  const reservedBuys = orders.filter((o) => o.status === "pending" && o.type === "buy").reduce((s, o) => s + o.shares * o.price_per_share, 0);
  const reservedSells = orders.filter((o) => o.status === "pending" && o.type === "sell").reduce((s, o) => s + o.shares, 0);

  const totalSharesOwned = holdings.reduce((s, h) => s + h.shares_owned, 0);

  const earningsChart = useMemo(() => {
    const allTimestamps = new Set<number>();
    for (const h of holdings) {
      const ph = priceHistories[h.company_id];
      if (ph) ph.forEach((p) => allTimestamps.add(p.timestamp));
    }
    if (allTimestamps.size === 0) return null;

    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    const portfolioValues: { timestamp: number; value: number }[] = [];
    for (const ts of sortedTimestamps) {
      let totalVal = 0;
      for (const h of holdings) {
        const ph = priceHistories[h.company_id];
        if (!ph) continue;
        let latestPrice = 0;
        for (const p of ph) {
          if (p.timestamp <= ts) latestPrice = p.price;
          else break;
        }
        totalVal += latestPrice * h.shares_owned;
      }
      portfolioValues.push({ timestamp: ts, value: totalVal });
    }

    const now = Date.now();
    const option = FILTER_OPTIONS.find((f) => f.key === earningsFilter);
    let filtered = portfolioValues;
    if (option?.ms) {
      const cutoff = now - option.ms;
      filtered = portfolioValues.filter((p) => p.timestamp >= cutoff);
      if (filtered.length === 0 && portfolioValues.length > 0) {
        filtered = [portfolioValues[portfolioValues.length - 1]];
      }
    }

    if (filtered.length === 0) return null;

    const labels = filtered.map((p) => {
      const date = new Date(p.timestamp);
      if (earningsFilter === "1d") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (earningsFilter === "7d") return date.toLocaleDateString([], { weekday: "short", hour: "2-digit" });
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    });

    const values = filtered.map((p) => p.value / 100);
    const firstVal = values[0];
    const lastVal = values[values.length - 1];
    const isUp = lastVal >= firstVal;
    const lineColor = isUp ? "#22c55e" : "#ef4444";
    const bgColor = isUp ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)";

    const change = lastVal - firstVal;
    const changePercent = firstVal > 0 ? ((change / firstVal) * 100).toFixed(2) : "0.00";

    return {
      labels,
      values,
      current: lastVal,
      change,
      changePercent,
      isUp,
      lineColor,
      bgColor,
    };
  }, [holdings, priceHistories, earningsFilter]);

  const earningsChartJSData = useMemo(() => {
    if (!earningsChart) return null;
    return {
      labels: earningsChart.labels,
      datasets: [
        {
          data: earningsChart.values,
          borderColor: earningsChart.lineColor,
          backgroundColor: earningsChart.bgColor,
          fill: true,
          tension: 0.4,
          pointRadius: earningsChart.values.length < 30 ? 3 : 0,
          pointBackgroundColor: earningsChart.lineColor,
          borderWidth: 2,
        },
      ],
    };
  }, [earningsChart]);

  const earningsChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
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
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: {
            color: "#6b7280",
            font: { size: 11 },
            callback: (val: any) => `${val.toFixed(0)}c`,
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

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-white mb-2">Portfolio</h1>
        <p className="text-gray-400 mb-8">Your holdings and transaction history</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="glass-card text-center">
            <div className="text-sm text-gray-400">Cash Balance</div>
            <div className="text-2xl font-bold text-blue-400">{formatCoins(userBalance)}</div>
            {reservedBuys > 0 && (
              <div className="text-xs text-yellow-400 mt-1">-{formatCoins(reservedBuys)} reserved</div>
            )}
          </div>
          <div className="glass-card text-center">
            <div className="text-sm text-gray-400">Holdings Value</div>
            <div className="text-2xl font-bold text-green-400">{formatCoins(totalValue)}</div>
            {reservedSells > 0 && (
              <div className="text-xs text-yellow-400 mt-1">{reservedSells} shares reserved</div>
            )}
          </div>
          <div className="glass-card text-center">
            <div className="text-sm text-gray-400">Total Net Worth</div>
            <div className="text-2xl font-bold gradient-text">{formatCoins(totalPortfolio)}</div>
          </div>
        </div>

        {holdings.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="glass-card">
              <h2 className="text-lg font-semibold text-white mb-4">Holdings Breakdown</h2>
              <div className="flex flex-col items-center">
                <svg width="200" height="200" viewBox="0 0 200 200">
                  {(() => {
                    const r = 75;
                    const cx = 100, cy = 100;
                    let startAngle = -90;
                    const segments: JSX.Element[] = [];
                    for (let i = 0; i < holdings.length; i++) {
                      const h = holdings[i];
                      const pct = totalSharesOwned > 0 ? h.shares_owned / totalSharesOwned : 0;
                      const angle = pct * 360;
                      if (angle <= 0) continue;
                      const endAngle = startAngle + angle;
                      const startRad = (startAngle * Math.PI) / 180;
                      const endRad = (endAngle * Math.PI) / 180;
                      const x1 = cx + r * Math.cos(startRad);
                      const y1 = cy + r * Math.sin(startRad);
                      const x2 = cx + r * Math.cos(endRad);
                      const y2 = cy + r * Math.sin(endRad);
                      const largeArc = angle > 180 ? 1 : 0;
                      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
                      segments.push(<path key={h.company_id} d={d} fill={PIE_COLORS[i % PIE_COLORS.length]} />);
                      startAngle = endAngle;
                    }
                    return segments;
                  })()}
                  <circle cx={100} cy={100} r={40} fill="#111827" />
                  <text x="100" y="96" textAnchor="middle" className="fill-white text-sm font-bold">
                    {holdings.length}
                  </text>
                  <text x="100" y="110" textAnchor="middle" className="fill-gray-400 text-xs">
                    {totalSharesOwned} shares
                  </text>
                </svg>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 w-full mt-4">
                  {holdings.map((h, i) => (
                    <div key={h.company_id} className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-sm text-gray-300 truncate">{h.ticker}</span>
                      <span className="text-sm text-white font-medium ml-auto">
                        {totalSharesOwned > 0 ? ((h.shares_owned / totalSharesOwned) * 100).toFixed(0) : "0"}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="glass-card">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Portfolio Value</h2>
                  {earningsChart && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xl font-bold text-white">{formatCoins(earningsChart.current * 100)}</span>
                      <span className={`text-sm font-medium ${earningsChart.change >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {earningsChart.change >= 0 ? "+" : ""}{formatCoins(earningsChart.change * 100)} ({earningsChart.change >= 0 ? "+" : ""}{earningsChart.changePercent}%)
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex gap-1 bg-gray-800/50 rounded-lg p-1">
                  {FILTER_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => setEarningsFilter(opt.key)}
                      className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                        earningsFilter === opt.key
                          ? "bg-blue-600 text-white"
                          : "text-gray-400 hover:text-white hover:bg-gray-700"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="h-64">
                {earningsChartJSData ? (
                  <Line data={earningsChartJSData} options={earningsChartOptions} />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                    Not enough price data to chart
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {pendingOrders.length > 0 && (
          <div className="glass-card mb-8 border-yellow-500/30">
            <h2 className="text-xl font-semibold text-white mb-4">Pending Orders ({pendingOrders.length})</h2>
            <div className="space-y-2">
              {pendingOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between py-3 px-4 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${order.type === "buy" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                      {String(order.type).toUpperCase()}
                    </span>
                    <Link href={`/dashboard/stocks/${order.company_id}`} className="text-white font-medium hover:text-blue-400 transition-colors">
                      {order.ticker}
                    </Link>
                    <span className="text-gray-400">{order.shares} shares @ {formatCoins(order.price_per_share)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-xs text-gray-500">Current: {formatCoins(order.current_price)}</div>
                      <div className="text-xs text-gray-500">{new Date(order.created_at).toLocaleString()}</div>
                    </div>
                    <button
                      onClick={() => cancelOrder(order.id)}
                      className="text-red-400 hover:text-red-300 text-sm font-medium px-3 py-1 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="glass-card mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">Holdings</h2>
          {holdings.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-400 mb-4">You don&apos;t own any shares yet</p>
              <Link href="/dashboard" className="btn-primary">
                Browse Markets
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {holdings.map((h) => {
                const heldForSell = orders.filter((o) => o.status === "pending" && o.type === "sell" && o.company_id === h.company_id).reduce((s, o) => s + o.shares, 0);
                return (
                  <Link
                    key={h.id}
                    href={`/dashboard/stocks/${h.company_id}`}
                    className="flex items-center justify-between py-3 px-4 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-2 py-1 rounded">
                        {h.ticker}
                      </span>
                      <div>
                        <div className="text-white font-medium">{h.company_name}</div>
                        <div className="text-xs text-gray-400">{h.shares_owned} shares</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-white font-semibold">
                        {formatCoins(h.share_price * h.shares_owned)}
                      </div>
                      <div className="text-xs text-gray-400">@ {formatCoins(h.share_price)} each</div>
                      {heldForSell > 0 && (
                        <div className="text-xs text-yellow-400">{heldForSell} reserved for sell orders</div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="glass-card">
          <h2 className="text-xl font-semibold text-white mb-4">Transaction History</h2>
          {transactions.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No transactions yet</p>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded ${
                        String(tx.type) === "buy" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                      }`}
                    >
                      {String(tx.type).toUpperCase()}
                    </span>
                    <div>
                      <span className="text-white">{tx.ticker}</span>
                      <span className="text-gray-400 ml-2">
                        {tx.shares} share{tx.shares > 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={String(tx.type) === "buy" ? "text-red-400" : "text-green-400"}>
                      {String(tx.type) === "buy" ? "-" : "+"}{formatCoins(tx.total_amount)}
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(tx.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
