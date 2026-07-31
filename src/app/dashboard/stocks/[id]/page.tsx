"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
} from "chart.js";
import Navbar from "@/components/Navbar";
import PriceChart from "@/components/PriceChart";
import TradeAnimation from "@/components/TradeAnimation";
import ButtonSpinner from "@/components/ButtonSpinner";
import CommentsSection from "@/components/CommentsSection";
import { showToast } from "@/components/Toast";
import { formatCoins } from "@/lib/format";
import PageBackground from "@/components/PageBackground";
import { useIsMobile } from "@/hooks/useIsMobile";
import { playClick, playBuyConfirm, playSellConfirm, playCancel, playOrderConfirmed, playOrderProgress } from "@/lib/sounds";
import ConfirmModal from "@/components/ConfirmModal";
import { showTradeNotification } from "@/components/TradeNotification";
import InvestmentChart from "@/components/InvestmentChart";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

interface Company {
  id: number;
  name: string;
  ticker: string;
  description: string;
  share_price: number;
  total_shares: number;
  price_history: any[];
  recent_transactions: any[];
  available_shares: number;
  shareEvent: { shares_added: number } | null;
  pending_buy_count?: number;
  pending_sell_count?: number;
}

function ProfitChart({ myTrades }: { myTrades: any[] }) {
  const profitData = useMemo(() => {
    let shares = 0;
    let totalCost = 0;
    let cumulativeProfit = 0;
    const points: { date: string; profit: number }[] = [];

    const confirmed = myTrades
      .filter((t: any) => String(t.status) === "confirmed")
      .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    for (const trade of confirmed) {
      const date = new Date(trade.created_at);
      const dateStr = date.toLocaleDateString([], { month: "short", day: "numeric" });

      if (String(trade.type).includes("buy")) {
        shares += Number(trade.shares);
        totalCost += Number(trade.shares) * Number(trade.price_per_share);
      } else {
        const avgCost = shares > 0 ? totalCost / shares : 0;
        const sellProfit = (Number(trade.price_per_share) - avgCost) * Number(trade.shares);
        cumulativeProfit += sellProfit;
        shares -= Number(trade.shares);
        totalCost -= Number(trade.shares) * avgCost;
        if (totalCost < 0) totalCost = 0;
      }

      points.push({ date: dateStr, profit: cumulativeProfit });
    }

    return points;
  }, [myTrades]);

  if (profitData.length < 2) return null;

  const isUp = profitData[profitData.length - 1].profit >= 0;
  const totalProfit = profitData[profitData.length - 1].profit;

  return (
    <div className="mt-6 pt-6 border-t border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-300">Realized Profit</h4>
        <span className={`text-sm font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
          {totalProfit >= 0 ? "+" : ""}{formatCoins(Math.round(totalProfit))}
        </span>
      </div>
      <div className="h-24">
        <Line
          data={{
            labels: profitData.map((p) => p.date),
            datasets: [
              {
                label: "Cumulative Profit",
                data: profitData.map((p) => p.profit / 100),
                borderColor: isUp ? "#22c55e" : "#ef4444",
                backgroundColor: isUp ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                fill: true,
                tension: 0.3,
                pointRadius: 0,
                borderWidth: 2,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              tooltip: {
                backgroundColor: "rgba(0,0,0,0.8)",
                titleColor: "#fff",
                bodyColor: "#fff",
                callbacks: {
                  label: (ctx: any) => `${ctx.parsed.y >= 0 ? "+" : ""}${ctx.parsed.y.toFixed(2)}c`,
                },
              },
              legend: { display: false },
            },
            scales: {
              x: { display: true, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6b7280", maxTicksLimit: 6, font: { size: 10 } }, border: { display: false } },
              y: { display: true, grid: { color: "rgba(255,255,255,0.05)" }, ticks: { color: "#6b7280", font: { size: 10 }, callback: (v: any) => `${v.toFixed(1)}c` }, border: { display: false } },
            },
          }}
        />
      </div>
    </div>
  );
}

export default function StockDetailPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const isMobile = useIsMobile();
  const [company, setCompany] = useState<Company | null>(null);
  const [userBalance, setUserBalance] = useState(0);
  const [sharesOwned, setSharesOwned] = useState(0);
  const [myOrders, setMyOrders] = useState<any[]>([]);

  const [orderType, setOrderType] = useState<"buy" | "sell">("buy");
  const [orderShares, setOrderShares] = useState<string | number>(1);
  const [orderPrice, setOrderPrice] = useState("");
  const [orderMode, setOrderMode] = useState<"market" | "limit">("market");
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderSuccess, setOrderSuccess] = useState("");
  const [tradeAnimType, setTradeAnimType] = useState<"buy" | "sell" | "cancel" | null>(null);
  const [companyLoaded, setCompanyLoaded] = useState(false);
  const [positionLoaded, setPositionLoaded] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const prevOrdersRef = useRef<any[]>([]);
  const prevTradesRef = useRef<any[]>([]);
  const pendingOrderRef = useRef<{ orderType: "buy" | "sell"; orderMode: "market" | "limit"; shares: number; priceCents: number } | null>(null);
  const [cancelOrderId, setCancelOrderId] = useState<number | null>(null);
  const [showInvestment, setShowInvestment] = useState(false);
  const [pressReleases, setPressReleases] = useState<any[]>([]);
  const [pressReleaseTotal, setPressReleaseTotal] = useState(0);
  const [pressReleaseOpen, setPressReleaseOpen] = useState(false);
  const [pressReleaseOffset, setPressReleaseOffset] = useState(0);
  const PR_LIMIT = 3;

  async function loadMorePressReleases() {
    const newOffset = pressReleaseOffset + PR_LIMIT;
    try {
      const res = await fetch(`/api/press-releases/${companyId}?limit=5&offset=${newOffset}`);
      const data = await res.json();
      if (Array.isArray(data.press_releases)) {
        setPressReleases((prev: any[]) => [...prev, ...data.press_releases]);
        setPressReleaseOffset(newOffset);
      }
    } catch {}
  }

  const companyId = Number(params.id);
  const canTrade = status === "authenticated";

  const fetchData = useCallback(() => {
    fetch(`/api/stocks/${companyId}`)
      .then((res) => res.json())
      .then((data) => {
        setCompany(data);
        setCompanyLoaded(true);
      })
      .catch(() => setCompanyLoaded(true));

    fetch(`/api/press-releases/${companyId}?limit=3&offset=0`)
      .then((res) => res.json())
      .then((data) => { if (Array.isArray(data.press_releases)) { setPressReleases(data.press_releases); setPressReleaseTotal(data.total || 0); setPressReleaseOffset(0); } })
      .catch(() => {});

    if (status === "authenticated") {
      fetch(`/api/portfolio`)
        .then((res) => res.json())
        .then((data) => {
          if (data.user) setUserBalance(data.user.balance || 0);
          const holding = data.holdings?.find((h: any) => h.company_id === companyId);
          setSharesOwned(holding?.shares_owned || 0);
          setPositionLoaded(true);
        })
        .catch(() => setPositionLoaded(true));

      fetch(`/api/orders`)
        .then((res) => res.json())
        .then((orders) => {
          const pending = orders.filter((o: any) => o.company_id === companyId && o.status === "pending" && o.shares > 0);
          const prevPending = prevOrdersRef.current;
          if (prevPending.length > 0) {
            for (const prev of prevPending) {
              const curr = pending.find((p: any) => p.id === prev.id);
              if (!curr) {
                playOrderConfirmed();
                showTradeNotification({
                  stockName: company?.name || "",
                  ticker: company?.ticker || "",
                  action: prev.type,
                  shares: prev.original_shares || prev.shares,
                  price: prev.price_per_share,
                });
              } else if (curr.shares < prev.shares) {
                playOrderProgress();
                const filledNow = Math.max(0, (prev.original_shares || prev.shares) - curr.shares);
                showTradeNotification({
                  stockName: company?.name || "",
                  ticker: company?.ticker || "",
                  action: prev.type,
                  shares: filledNow,
                  price: prev.price_per_share,
                });
              }
            }
          }
          prevOrdersRef.current = pending;
          setMyOrders(pending);
          setOrdersLoaded(true);
        })
        .catch(() => setOrdersLoaded(true));
    } else if (status === "unauthenticated") {
      setPositionLoaded(true);
      setOrdersLoaded(true);
    }
  }, [companyId, status]);

  useEffect(() => {
    if (status === "loading") return;
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData, status]);

  function handlePlaceOrder() {
    setOrderError("");
    setOrderSuccess("");
    playClick();

    const shares = Number(orderShares);
    if (!shares || shares <= 0 || !Number.isInteger(shares)) {
      setOrderError("Enter a valid number of shares");
      return;
    }

    let priceCents = 0;
    if (orderMode === "limit") {
      priceCents = Math.round(parseFloat(orderPrice) * 100);
      if (isNaN(priceCents) || priceCents <= 0) {
        setOrderError("Enter a valid price");
        return;
      }
    }

    pendingOrderRef.current = { orderType, orderMode, shares, priceCents };
    setOrderLoading(true);
    setTradeAnimType(orderType);
    if (orderType === "buy") playBuyConfirm(); else playSellConfirm();
  }

  async function submitOrder(params: { orderType: "buy" | "sell"; orderMode: "market" | "limit"; shares: number; priceCents: number }) {
    try {
      if (params.orderMode === "market") {
        const endpoint = params.orderType === "buy" ? "/api/stocks/buy" : "/api/stocks/sell";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, shares: params.shares, requestId: crypto.randomUUID() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (data.duplicate) {
          setOrderSuccess(data.message || "Order already placed");
        } else if (params.orderType === "buy") {
          const filled = data.filledShares || 0;
          const pending = data.pendingShares || 0;
          if (pending > 0) {
            setOrderSuccess(data.message || `Bought ${filled}, ${pending} pending`);
          } else if (filled > 0) {
            setOrderSuccess(`Market buy executed! ${filled} share${filled > 1 ? "s" : ""} purchased.`);
            showTradeNotification({ stockName: company?.name || "", ticker: company?.ticker || "", action: "buy", shares: filled, price: company?.share_price || 0 });
          } else {
            setOrderSuccess(`Order placed, waiting for sellers.`);
          }
          if (filled > 0) {
            setSharesOwned((prev) => prev + filled);
          }
          if (typeof data.newBalance === "number" && data.newBalance >= 0) {
            setUserBalance(data.newBalance);
          }
        } else {
          const sold = data.filledShares || params.shares;
          const pending = data.pendingShares || 0;
          if (pending > 0) {
            setOrderSuccess(data.message || `Listed ${sold} share${sold > 1 ? "s" : ""}, ${pending} pending.`);
          } else if (sold > 0) {
            setOrderSuccess(`Sell order listed! ${sold} share${sold > 1 ? "s" : ""} on the market.`);
            showTradeNotification({ stockName: company?.name || "", ticker: company?.ticker || "", action: "sell", shares: sold, price: company?.share_price || 0 });
          } else {
            setOrderSuccess(`Order placed, waiting for buyers.`);
          }
          setSharesOwned((prev) => Math.max(0, prev - sold));
          if (typeof data.newBalance === "number" && data.newBalance >= 0) {
            setUserBalance(data.newBalance);
          }
        }
        window.dispatchEvent(new Event("balance-changed"));
      } else {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, type: params.orderType, shares: params.shares, priceCents: params.priceCents, requestId: crypto.randomUUID() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setOrderSuccess(data.message || "Limit order placed!");
        window.dispatchEvent(new Event("balance-changed"));
      }
      fetchData();
    } catch (err: any) {
      setOrderError(err.message || "Failed");
    } finally {
      setOrderLoading(false);
    }
  }

  async function handleCancelOrder(orderId: number) {
    setCancelOrderId(orderId);
  }

  async function confirmCancelOrder() {
    if (cancelOrderId === null) return;
    const orderId = cancelOrderId;
    setCancelOrderId(null);
    try {
      playCancel();
      setTradeAnimType("cancel");
      const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      prevOrdersRef.current = prevOrdersRef.current.filter(o => o.id !== orderId);
      window.dispatchEvent(new Event("balance-changed"));
      fetchData();
    } catch (err: any) {
      showToast(err.message || "Failed to cancel order", "error");
    }
  }

  const priceHistory = company?.price_history || [];
  const currentPrice = company?.share_price || 0;
  const startPrice = priceHistory.length > 0 ? priceHistory[0].price : currentPrice;
  const priceChange = currentPrice - startPrice;
  const priceChangePercent = startPrice > 0 ? ((priceChange / startPrice) * 100).toFixed(2) : "0.00";
  const isAdmin = (session?.user as any)?.isAdmin;

  const isDelisted = (company as any)?.delisted === 1;

  const reservedSells = myOrders.filter((o) => o.type === "sell").reduce((sum, o) => sum + Math.max(0, o.shares), 0);
  const availableToSell = Math.max(0, sharesOwned - reservedSells);
  const reservedBuys = myOrders.filter((o) => o.type === "buy").reduce((sum, o) => sum + o.shares * o.price_per_share, 0);
  const availableBalance = Math.max(0, userBalance - reservedBuys);

  const suggestedBuyPrice = orderType === "buy" ? (currentPrice * 0.95) : 0;
  const suggestedSellPrice = orderType === "sell" ? (currentPrice * 1.05) : 0;

  return (
    <div className="min-h-screen">
      <PageBackground />
      <Navbar />
      <TradeAnimation
        type={tradeAnimType}
        onComplete={() => {
          setTradeAnimType(null);
          if (pendingOrderRef.current) {
            const pending = pendingOrderRef.current;
            pendingOrderRef.current = null;
            submitOrder(pending);
          }
        }}
      />
      <div className="max-w-6xl mx-auto px-3 md:px-4 py-6 md:py-8 animate-stock-zoom">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white mb-6 inline-block">
          &larr; Back to Markets
        </button>

        <div className="glass-card mb-6">
          {!companyLoaded ? (
            <div className="space-y-3">
              <div className="h-5 w-16 bg-gray-800/50 rounded animate-pulse" />
              <div className="h-8 w-48 bg-gray-800/50 rounded animate-pulse" />
              <div className="h-4 w-64 bg-gray-800/50 rounded animate-pulse" />
              <div className="flex justify-between mt-4">
                <div className="h-4 w-32 bg-gray-800/50 rounded animate-pulse" />
                <div className="h-10 w-24 bg-gray-800/50 rounded animate-pulse" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-sm font-mono text-blue-400 bg-blue-400/10 px-3 py-1 rounded">{(company as any)?.ticker || "—"}</span>
                </div>
                <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">{(company as any)?.name || "Unknown"}</h1>
                <p className="text-gray-400 mb-4">{(company as any)?.description || ""}</p>
                {pressReleases.length > 0 && (
                  <div className="mb-4">
                    <button
                      onClick={() => setPressReleaseOpen(!pressReleaseOpen)}
                      className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg border border-gray-700/50 text-gray-300 hover:bg-white/5 text-sm transition-all"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                      <span className="font-medium">Press Releases ({pressReleaseTotal})</span>
                      <svg className={`ml-auto w-4 h-4 transition-transform ${pressReleaseOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9" /></svg>
                    </button>
                    {pressReleaseOpen && (
                      <div className="mt-2 space-y-2">
                        {pressReleases.map((pr: any, idx: number) => (
                          <div key={pr.id || idx} className={`px-3 py-3 rounded-lg border text-sm ${
                            pr.type === "positive"
                              ? "bg-green-500/5 border-green-500/20"
                              : "bg-red-500/5 border-red-500/20"
                          }`}>
                            <div className={`text-xs font-medium mb-1 ${pr.type === "positive" ? "text-green-400" : "text-red-400"}`}>
                              {pr.type === "positive" ? (Number(pr.severity) >= 3 ? "▲ Really Good" : "▲ Good") : (Number(pr.severity) >= 3 ? "▼ Really Bad" : "▼ Bad")} &middot; {new Date(pr.created_at).toLocaleDateString()}
                            </div>
                            <div className="text-gray-300 whitespace-pre-wrap">{pr.content}</div>
                          </div>
                        ))}
                        {pressReleaseOffset + PR_LIMIT < pressReleaseTotal && (
                          <button onClick={loadMorePressReleases} className="w-full text-center text-blue-400 hover:text-blue-300 text-sm py-2 transition-colors">
                            Load More
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="text-sm text-gray-500 flex flex-wrap gap-x-2">
                  <span>{((company as any)?.total_shares || 0).toLocaleString()} total shares</span>
                  <span className="text-gray-600">·</span>
                  <span>{((company as any)?.available_shares || 0).toLocaleString()} available</span>
                  <span className="text-gray-600">·</span>
                  <span className="text-violet-400">{(company as any)?.holder_count ?? 0} holder{((company as any)?.holder_count ?? 0) !== 1 ? "s" : ""}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-3xl md:text-4xl font-bold text-white mb-1">{formatCoins(currentPrice)}</div>
                <div className={`text-sm font-medium mb-4 ${priceChange >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {priceChange >= 0 ? "+" : ""}{formatCoins(priceChange)} ({priceChange >= 0 ? "+" : ""}{priceChangePercent}%)
                </div>
                {!canTrade && (
                  <Link href="/login" className="btn-success px-8 py-3 text-lg inline-block">Sign In to Trade</Link>
                )}
              </div>
            </div>
          )}
          {companyLoaded && (company as any)?.shareEvent && (
            <div className="mt-4 flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm px-4 py-2 rounded-lg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"/></svg>
              <span>This stock released <strong>+{(company as any).shareEvent.shares_added.toLocaleString()}</strong> new shares in the past week</span>
            </div>
          )}
        </div>

        {canTrade && companyLoaded && isDelisted && (
          <div className="glass-card mb-6 animate-fade-up border-red-500/20">
            <div className="flex items-center gap-3 text-red-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              <div>
                <div className="text-white font-semibold">Market Closed</div>
                <div className="text-sm text-red-400">This stock has been delisted and cannot be traded</div>
              </div>
            </div>
          </div>
        )}

        {canTrade && companyLoaded && !isDelisted && (
          <div className="glass-card mb-6 animate-fade-up">
            <h3 className="text-lg font-semibold text-white mb-4">Place Order</h3>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => { playClick(); setOrderType("buy"); setOrderPrice(""); }}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${orderType === "buy" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                Buy
              </button>
              <button
                onClick={() => { playClick(); setOrderType("sell"); setOrderPrice(""); }}
                disabled={sharesOwned === 0}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${
                  orderType === "sell" ? "bg-red-600 text-white" : sharesOwned === 0 ? "bg-gray-800 text-gray-600 cursor-not-allowed" : "bg-gray-800 text-gray-400 hover:text-white"
                }`}
              >
                Sell {sharesOwned === 0 ? "(0 shares)" : ""}
              </button>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => { playClick(); setOrderMode("market"); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${orderMode === "market" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                Market Order ({orderType === "buy" ? "instant" : "at market price"})
              </button>
              <button
                onClick={() => { playClick(); setOrderMode("limit"); }}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${orderMode === "limit" ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                Limit Order (set price)
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Shares</label>
                <input
                  type="number"
                  min="1"
                  value={orderShares}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || val === "-") { setOrderShares(val); return; }
                    const v = parseInt(val);
                    if (!isNaN(v) && v > 0) setOrderShares(v);
                  }}
                  className="input-field text-center text-lg font-bold"
                />
              </div>
              {orderMode === "limit" && (
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">
                    {orderType === "buy" ? "Max Price (c)" : "Min Price (c)"}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={orderPrice}
                    onChange={(e) => setOrderPrice(e.target.value)}
                    placeholder={orderType === "buy" ? `e.g. ${formatCoins(suggestedBuyPrice)}` : `e.g. ${formatCoins(suggestedSellPrice)}`}
                    className="input-field text-center text-lg font-bold"
                  />
                </div>
              )}
            </div>

            {orderMode === "market" ? (
              <div className="text-sm text-gray-400 mb-4 space-y-1">
                <div className="flex justify-between">
                  <span>Price per share:</span>
                  <span className="text-white">{formatCoins(currentPrice)}</span>
                </div>
                {orderType === "buy" ? (
                  <>
                    <div className="flex justify-between font-bold">
                      <span>                      Total cost:</span>
                      <span className={isAdmin ? "text-green-400" : "text-red-400"}>
                        {isAdmin ? "FREE" : formatCoins(currentPrice * Number(orderShares))}
                      </span>
                    </div>
                    {!isAdmin && (
                      <div className="flex justify-between text-xs">
                        <span>Your balance:</span>
                        <span>{formatCoins(userBalance)}</span>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Order type:</span>
                      <span>Listed on market (waits for buyer)</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Shares available to sell:</span>
                      <span>{availableToSell}</span>
                    </div>
                  </>
                )}
              </div>
            ) : orderPrice ? (
              <div className="text-sm text-gray-400 mb-4 space-y-1">
                <div className="flex justify-between">
                  <span>Your limit price:</span>
                  <span className="text-white">{formatCoins(parseFloat(orderPrice) * 100)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Current market price:</span>
                  <span className="text-white">{formatCoins(currentPrice)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Reserved {orderType === "buy" ? "cost" : "shares"}:</span>
                  <span className="text-yellow-400">
                    {orderType === "buy" ? formatCoins(parseFloat(orderPrice) * 100 * Number(orderShares)) : `${Number(orderShares)} shares`}
                  </span>
                </div>
                {orderType === "sell" && (
                  <div className="flex justify-between text-xs">
                    <span>Shares available to sell:</span>
                    <span>{availableToSell}</span>
                  </div>
                )}
                {orderType === "buy" && parseFloat(orderPrice) * 100 >= currentPrice && (
                  <p className="text-green-400 text-xs">Your price is at or above market - may fill immediately!</p>
                )}
                {orderType === "sell" && parseFloat(orderPrice) * 100 <= currentPrice && (
                  <p className="text-green-400 text-xs">Your price is at or below market - may fill immediately!</p>
                )}
              </div>
            ) : null}

            {orderError && <p className="text-red-400 text-sm mb-3">{orderError}</p>}
            {orderSuccess && <p className="text-green-400 text-sm mb-3">{orderSuccess}</p>}

            <button
              onClick={handlePlaceOrder}
              disabled={orderLoading || (orderMode === "limit" && !orderPrice)}
              className={`w-full py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${
                orderType === "buy" ? "bg-green-600 hover:bg-green-500" : "bg-red-600 hover:bg-red-500"
              }`}
            >
              {orderLoading ? <><ButtonSpinner size={18} /> Processing...</> : orderMode === "market" ? (orderType === "buy" ? "Buy Now" : "List for Sale") : `Place ${orderType} Limit Order`}
            </button>
          </div>
        )}

        {canTrade && !ordersLoaded ? (
          <div className="glass-card mb-6 border-yellow-500/30 animate-fade-up">
            <h3 className="text-lg font-semibold text-white mb-4">My Pending Orders</h3>
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 bg-gray-800/50 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        ) : canTrade && myOrders.length > 0 && (
          <div className="glass-card mb-6 border-yellow-500/30 animate-fade-up">
            <h3 className="text-lg font-semibold text-white mb-4">My Pending Orders ({myOrders.length})</h3>
            <div className="space-y-2">
              {myOrders.map((order) => {
                const original = order.original_shares || order.shares;
                const filled = Math.min(original, Math.max(0, original - order.shares));
                const fillPercent = original > 0 ? Math.round((filled / original) * 100) : 0;
                const isPartial = fillPercent > 0;
                return (
                  <div
                    key={order.id}
                    className="flex items-center justify-between py-2 px-3 bg-gray-800/50 rounded-lg group"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${order.type === "buy" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {order.type.toUpperCase()}
                      </span>
                      {order.is_market_order === 1 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 uppercase tracking-wide" title="Price auto-updates to match the market rate">Auto</span>
                      )}
                      <span className="text-white">
                        {order.shares} shares @ {formatCoins(order.price_per_share)}
                      </span>
                      {isPartial && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">
                          {fillPercent}% filled ({filled}/{original})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {isPartial && (
                        <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${fillPercent}%` }} />
                        </div>
                      )}
                      <span className="text-xs text-gray-500">{new Date(order.created_at).toLocaleString()}</span>
                      <span
                        onClick={(e) => { e.stopPropagation(); handleCancelOrder(order.id); }}
                        className="text-red-400 hover:text-red-300 text-xs font-medium cursor-pointer px-2 py-1 rounded hover:bg-red-500/10"
                      >Cancel</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-6">
          {!companyLoaded ? (
            <div className="glass-card animate-fade-up">
              <div className="h-8 w-40 bg-gray-800 rounded animate-pulse mb-4" />
              <div className="h-64 sm:h-80 bg-gray-800/50 rounded-lg animate-pulse" />
            </div>
          ) : (
            <div className="animate-fade-up">
              <PriceChart priceHistory={priceHistory} currentPrice={currentPrice} transactions={(company as any)?.recent_transactions} pendingBuyCount={(company as any)?.pending_buy_shares ?? 0} pendingSellCount={(company as any)?.pending_sell_shares ?? 0} pendingBuyOrders={(company as any)?.pending_buy_orders} pendingSellOrders={(company as any)?.pending_sell_orders} />
              {canTrade && (
                <button
                  onClick={() => setShowInvestment(!showInvestment)}
                  className="w-full mt-2 py-3 bg-gray-800/60 hover:bg-gray-800 border border-gray-700/50 rounded-xl text-sm text-gray-300 hover:text-white transition-all flex items-center justify-center gap-2 group"
                >
                  <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`transition-transform duration-300 ${showInvestment ? "rotate-180" : ""}`}
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                  {showInvestment ? "Hide" : "Show"} Your Investment
                </button>
              )}
              {showInvestment && (
                <div className="glass-card mt-2 animate-fade-up">
                  <h3 className="text-lg font-semibold text-white mb-4">Your Investment</h3>
                  <InvestmentChart
                    trades={(company as any).my_trades || []}
                    priceHistory={priceHistory}
                    currentPrice={currentPrice}
                  />
                  <ProfitChart myTrades={(company as any).my_trades || []} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {canTrade && (
            <div className="glass-card animate-fade-up">
              <h3 className="text-lg font-semibold text-white mb-4">Your Position</h3>
              {!positionLoaded ? (
                <div className="flex flex-col items-center space-y-4">
                  <div className="w-40 h-40 rounded-full bg-gray-800/50 animate-pulse" />
                  <div className="grid grid-cols-2 gap-4 w-full">
                    {[1,2,3,4].map(i => <div key={i} className="h-14 bg-gray-800/50 rounded-lg animate-pulse" />)}
                  </div>
                </div>
              ) : sharesOwned > 0 ? (
                <div className="flex flex-col items-center">
                  <svg width="160" height="160" viewBox="0 0 160 160">
                    {(() => {
                      const totalShares = (company as any)?.total_shares || 0;
                      const ownershipPercent = totalShares > 0 ? (sharesOwned / totalShares) * 100 : 0;
                      const unownedPercent = 100 - ownershipPercent;
                      const ownedAngle = (ownershipPercent / 100) * 360;
                      const r = 60;
                      const cx = 80, cy = 80;
                      const polarToCart = (angle: number) => {
                        const rad = ((angle - 90) * Math.PI) / 180;
                        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
                      };
                      if (ownershipPercent >= 100) {
                        return <circle cx={cx} cy={cy} r={r} fill="#3b82f6" />;
                      }
                      if (ownershipPercent <= 0) {
                        return <circle cx={cx} cy={cy} r={r} fill="#374151" />;
                      }
                      const start = polarToCart(0);
                      const end = polarToCart(ownedAngle);
                      const largeArc = ownedAngle > 180 ? 1 : 0;
                      const d = `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
                      return (
                        <>
                          <circle cx={cx} cy={cy} r={r} fill="#374151" />
                          <path d={d} fill="#3b82f6" />
                        </>
                      );
                    })()}
                    <text x="80" y="76" textAnchor="middle" className="fill-white text-xl font-bold">
                      {((company as any)?.total_shares > 0 ? ((sharesOwned / ((company as any)?.total_shares ?? 1)) * 100).toFixed(1) : "0.0")}%
                    </text>
                    <text x="80" y="94" textAnchor="middle" className="fill-gray-400 text-xs">
                      of market
                    </text>
                  </svg>
                  <div className="grid grid-cols-2 gap-4 w-full mt-4">
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Shares Owned</div>
                      <div className="text-lg font-bold text-white">{sharesOwned}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Available to Sell</div>
                      <div className="text-lg font-bold text-blue-400">{availableToSell}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Market Share</div>
                      <div className="text-lg font-bold text-gray-300">{((company as any)?.total_shares > 0 ? ((sharesOwned / ((company as any)?.total_shares ?? 1)) * 100).toFixed(1) : "0.0")}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400">Market Value</div>
                      <div className="text-lg font-bold text-green-400">{formatCoins(sharesOwned * currentPrice)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-gray-400 text-sm">You don&apos;t own any shares in this company</p>
              )}
            </div>
          )}

          <div className="glass-card animate-fade-up">
            <h3 className="text-lg font-semibold text-white mb-4">{canTrade ? "My Trades" : "Recent Trades"}</h3>
            {!companyLoaded ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-gray-800/50 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (!canTrade || (company as any).my_trades?.length === 0) && (company as any)?.recent_transactions?.length === 0 ? (
              <p className="text-gray-400 text-sm">No trades yet for this stock</p>
            ) : canTrade ? (
              (company as any).my_trades?.length === 0 ? (
                <p className="text-gray-400 text-sm">You haven&apos;t traded this stock yet</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {(company as any).my_trades?.map((tx: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => tx.status === "pending" && tx.order_id ? handleCancelOrder(tx.order_id) : undefined}
                      className={`flex items-center justify-between py-2 border-b border-gray-800 last:border-0 ${tx.status === "pending" ? "cursor-pointer hover:bg-red-500/10 rounded px-1 transition-colors group" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${String(tx.type).includes("buy") ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                          {String(tx.type).toUpperCase().replace("_", " ")}
                        </span>
                        {tx.status === "pending" && tx.is_market_order === 1 && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 uppercase tracking-wide" title="Price auto-updates to match the market rate">Auto</span>
                        )}
                        <span className="text-white">
                          {tx.status === "pending" && tx.original_shares && tx.original_shares > tx.shares
                            ? `${tx.shares}/${tx.original_shares} shares`
                            : `${tx.shares} shares`}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          tx.status === "confirmed" ? "bg-blue-500/20 text-blue-400" :
                          tx.status === "pending" ? tx.original_shares && tx.original_shares > tx.shares
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-yellow-500/20 text-yellow-400 group-hover:bg-red-500/20 group-hover:text-red-400"
                          : "bg-gray-500/20 text-gray-400"
                        }`}>
                          {tx.status === "confirmed" ? "Confirmed" :
                           tx.status === "pending" && tx.original_shares && tx.original_shares > tx.shares ? `${tx.shares}/${tx.original_shares} ${String(tx.type).includes("buy") ? "bought" : "sold"}` :
                           tx.status === "pending" ? "Click to Cancel" :
                           "Cancelled"}
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-white">{formatCoins(tx.total_amount)}</div>
                        <div className="text-xs text-gray-500">@ {formatCoins(tx.price_per_share)}</div>
                        {tx.created_at && (
                          <div className="text-xs text-gray-600">{new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {(company as any).recent_transactions?.map((tx: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-bold px-2 py-1 rounded ${String(tx.type).includes("buy") ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                        {String(tx.type).toUpperCase().replace("_", " ")}
                      </span>
                      <span className="text-white">{tx.shares} shares</span>
                    </div>
                    <div className="text-right">
                      <div className="text-white">{formatCoins(tx.total_amount)}</div>
                      <div className="text-xs text-gray-500">@ {formatCoins(tx.price_per_share)}</div>
                      {tx.created_at && (
                        <div className="text-xs text-gray-600">{new Date(tx.created_at).toLocaleDateString()} {new Date(tx.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <CommentsSection companyId={companyId} isLoggedIn={!!session} />
      </div>
      <ConfirmModal
        open={cancelOrderId !== null}
        title="Cancel Order"
        message="Cancel this order? This cannot be undone."
        confirmText="Cancel Order"
        cancelText="Keep Order"
        danger
        onConfirm={confirmCancelOrder}
        onCancel={() => setCancelOrderId(null)}
      />
    </div>
  );
}
