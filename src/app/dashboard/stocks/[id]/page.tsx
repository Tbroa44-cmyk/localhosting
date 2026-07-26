"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import PriceChart from "@/components/PriceChart";
import TradeAnimation from "@/components/TradeAnimation";
import LoadingSpinner from "@/components/LoadingSpinner";
import ButtonSpinner from "@/components/ButtonSpinner";
import CommentsSection from "@/components/CommentsSection";
import { showToast } from "@/components/Toast";
import { formatCoins } from "@/lib/format";
import PageBackground from "@/components/PageBackground";
import { useIsMobile } from "@/hooks/useIsMobile";

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
}

export default function StockDetailPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const params = useParams();
  const isMobile = useIsMobile();
  const isInitialLoad = useRef(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [userBalance, setUserBalance] = useState(0);
  const [sharesOwned, setSharesOwned] = useState(0);
  const [myOrders, setMyOrders] = useState<any[]>([]);

  const [orderType, setOrderType] = useState<"buy" | "sell">("buy");
  const [orderShares, setOrderShares] = useState(1);
  const [orderPrice, setOrderPrice] = useState("");
  const [orderMode, setOrderMode] = useState<"market" | "limit">("market");
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderSuccess, setOrderSuccess] = useState("");
  const [tradeAnimType, setTradeAnimType] = useState<"buy" | "sell" | "cancel" | null>(null);
  const [loadingSections, setLoadingSections] = useState({
    chart: true,
    orders: true,
    position: true,
    trades: true,
  });

  const companyId = Number(params.id);

  const fetchData = () => {
    if (isInitialLoad.current) {
      setLoadingSections({ chart: true, orders: true, position: true, trades: true });
    }

    fetch(`/api/stocks/${companyId}`)
      .then((res) => res.json())
      .then((data) => {
        setCompany(data);
        isInitialLoad.current = false;
        setLoadingSections(prev => ({ ...prev, chart: false }));
      })
      .catch(() => setLoadingSections(prev => ({ ...prev, chart: false })));

    if (session) {
      fetch(`/api/portfolio`)
        .then((res) => res.json())
        .then((data) => {
          if (data.user) setUserBalance(data.user.balance || 0);
          const holding = data.holdings?.find((h: any) => h.company_id === companyId);
          setSharesOwned(holding?.shares_owned || 0);
          setLoadingSections(prev => ({ ...prev, position: false }));
        })
        .catch(() => setLoadingSections(prev => ({ ...prev, position: false })));

      fetch(`/api/orders`)
        .then((res) => res.json())
        .then((orders) => {
          setMyOrders(orders.filter((o: any) => o.company_id === companyId && o.status === "pending"));
          setLoadingSections(prev => ({ ...prev, orders: false, trades: false }));
        })
        .catch(() => setLoadingSections(prev => ({ ...prev, orders: false, trades: false })));
    } else {
      setLoadingSections(prev => ({ ...prev, position: false, orders: false, trades: false }));
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [companyId, session]);

  async function handlePlaceOrder() {
    setOrderError("");
    setOrderSuccess("");
    setOrderLoading(true);

    try {
      if (orderMode === "market") {
        const endpoint = orderType === "buy" ? "/api/stocks/buy" : "/api/stocks/sell";
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, shares: orderShares, requestId: crypto.randomUUID() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setOrderSuccess(orderType === "buy"
          ? (data.pendingShares > 0
            ? data.message || `Bought ${data.filledShares || 0}, ${data.pendingShares} pending`
            : `Market buy executed! ${orderShares} share${orderShares > 1 ? "s" : ""} purchased.`)
          : `Sell order listed! ${orderShares} share${orderShares > 1 ? "s" : ""} at ${formatCoins(currentPrice)}.`);
        setTradeAnimType(orderType);
      } else {
        const priceCents = Math.round(parseFloat(orderPrice) * 100);
        if (isNaN(priceCents) || priceCents <= 0) throw new Error("Enter a valid price");

        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, type: orderType, shares: orderShares, priceCents, requestId: crypto.randomUUID() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setOrderSuccess(data.message || "Limit order placed!");
        setTradeAnimType(orderType);
      }
      fetchData();
    } catch (err: any) {
      setOrderError(err.message || "Failed");
    } finally {
      setOrderLoading(false);
    }
  }

  async function handleCancelOrder(orderId: number) {
    if (!confirm("Cancel this order? This cannot be undone.")) return;
    try {
      setTradeAnimType("cancel");
      const res = await fetch(`/api/orders/${orderId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      fetchData();
    } catch (err: any) {
      showToast(err.message || "Failed to cancel order", "error");
    }
  }

  if (!company) {
    return (
      <div className="min-h-screen">
        <PageBackground variant="stock" />
        <Navbar />
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner size="lg" text="Loading..." />
        </div>
      </div>
    );
  }

  const canTrade = !!session;
  const isAdmin = (session?.user as any)?.isAdmin;
  const priceHistory = company.price_history || [];
  const currentPrice = company.share_price;
  const startPrice = priceHistory.length > 0 ? priceHistory[0].price : company.share_price;
  const priceChange = currentPrice - startPrice;
  const priceChangePercent = startPrice > 0 ? ((priceChange / startPrice) * 100).toFixed(2) : "0.00";

  const reservedSells = myOrders.filter((o) => o.type === "sell").reduce((sum, o) => sum + o.shares, 0);
  const availableToSell = Math.max(0, sharesOwned - reservedSells);
  const reservedBuys = myOrders.filter((o) => o.type === "buy").reduce((sum, o) => sum + o.shares * o.price_per_share, 0);
  const availableBalance = Math.max(0, userBalance - reservedBuys);

  const suggestedBuyPrice = orderType === "buy" ? (currentPrice * 0.95) : 0;
  const suggestedSellPrice = orderType === "sell" ? (currentPrice * 1.05) : 0;

  return (
    <div className="min-h-screen">
      <PageBackground />
      <Navbar />
      <TradeAnimation type={tradeAnimType} onComplete={() => setTradeAnimType(null)} />
      <div className="max-w-6xl mx-auto px-3 md:px-4 py-6 md:py-8 animate-stock-zoom">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white mb-6 inline-block">
          &larr; Back to Markets
        </button>

        <div className="glass-card mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-sm font-mono text-blue-400 bg-blue-400/10 px-3 py-1 rounded">{company.ticker}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">{company.name}</h1>
              <p className="text-gray-400 mb-4">{company.description}</p>
              <div className="text-sm text-gray-500">
                {company.total_shares.toLocaleString()} total shares &middot; {company.available_shares.toLocaleString()} available at market
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
          {(company as any).shareEvent && (
            <div className="mt-4 flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm px-4 py-2 rounded-lg">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"/></svg>
              <span>This stock released <strong>+{(company as any).shareEvent.shares_added.toLocaleString()}</strong> new shares in the past week</span>
            </div>
          )}
        </div>

        {canTrade && (
          <div className="glass-card mb-6">
            <h3 className="text-lg font-semibold text-white mb-4">Place Order</h3>

            <div className="flex gap-2 mb-4">
              <button
                onClick={() => { setOrderType("buy"); setOrderPrice(""); }}
                className={`flex-1 py-2.5 rounded-lg font-medium transition-colors ${orderType === "buy" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                Buy
              </button>
              <button
                onClick={() => { setOrderType("sell"); setOrderPrice(""); }}
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
                onClick={() => setOrderMode("market")}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${orderMode === "market" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
              >
                Market Order ({orderType === "buy" ? "instant" : "at market price"})
              </button>
              <button
                onClick={() => setOrderMode("limit")}
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
                  onChange={(e) => { const v = parseInt(e.target.value); if (v > 0) setOrderShares(v); }}
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
                      <span>Total cost:</span>
                      <span className={isAdmin ? "text-green-400" : "text-red-400"}>
                        {isAdmin ? "FREE" : formatCoins(currentPrice * orderShares)}
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
                    {orderType === "buy" ? formatCoins(parseFloat(orderPrice) * 100 * orderShares) : `${orderShares} shares`}
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

        {canTrade && isInitialLoad.current && loadingSections.orders ? (
          <div className="glass-card mb-6 border-yellow-500/30">
            <h3 className="text-lg font-semibold text-white mb-4">My Pending Orders</h3>
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 bg-gray-800/50 rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
        ) : canTrade && myOrders.length > 0 && (
          <div className="glass-card mb-6 border-yellow-500/30">
            <h3 className="text-lg font-semibold text-white mb-4">My Pending Orders ({myOrders.length})</h3>
            <div className="space-y-2">
              {myOrders.map((order) => {
                const original = order.original_shares || order.shares;
                const filled = original - order.shares;
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
          {isInitialLoad.current && loadingSections.chart ? (
            <div className="glass-card">
              <div className="h-8 w-40 bg-gray-800 rounded animate-pulse mb-4" />
              <div className="h-64 sm:h-80 bg-gray-800/50 rounded-lg animate-pulse" />
            </div>
          ) : (
            <PriceChart priceHistory={priceHistory} currentPrice={currentPrice} transactions={company.recent_transactions} />
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          {canTrade && (
            <div className="glass-card">
              <h3 className="text-lg font-semibold text-white mb-4">Your Position</h3>
              {isInitialLoad.current && loadingSections.position ? (
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
                      const ownershipPercent = company.total_shares > 0 ? (sharesOwned / company.total_shares) * 100 : 0;
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
                      {company.total_shares > 0 ? ((sharesOwned / company.total_shares) * 100).toFixed(1) : "0.0"}%
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
                      <div className="text-lg font-bold text-gray-300">{company.total_shares > 0 ? ((sharesOwned / company.total_shares) * 100).toFixed(1) : "0.0"}%</div>
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

          <div className="glass-card">
            <h3 className="text-lg font-semibold text-white mb-4">{canTrade ? "My Trades" : "Recent Trades"}</h3>
            {isInitialLoad.current && loadingSections.trades ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 bg-gray-800/50 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : (!canTrade || (company as any).my_trades?.length === 0) && company.recent_transactions?.length === 0 ? (
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
                        <span className="text-white">{tx.shares} shares</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${
                          tx.status === "confirmed" ? "bg-blue-500/20 text-blue-400" :
                          tx.status === "pending" ? "bg-yellow-500/20 text-yellow-400 group-hover:bg-red-500/20 group-hover:text-red-400" :
                          "bg-gray-500/20 text-gray-400"
                        }`}>
                          {tx.status === "confirmed" ? "Confirmed" :
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
    </div>
  );
}
