"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import MiniChart from "./MiniChart";
import BuySellModal from "./BuySellModal";
import { formatCoins } from "@/lib/format";

interface StockCardProps {
  company: any;
  isLoggedIn: boolean;
  userHoldings?: Record<number, number>;
}

export default function StockCard({ company, isLoggedIn, userHoldings = {} }: StockCardProps) {
  const router = useRouter();
  const [exiting, setExiting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState<"buy" | "sell">("buy");
  const [userBalance, setUserBalance] = useState(0);
  const [sharesOwned, setSharesOwned] = useState(0);
  const [isAdmin, setIsAdmin] = useState(false);

  const sharesFromProp = userHoldings[company.id] || 0;
  useEffect(() => {
    setSharesOwned(sharesFromProp);
  }, [sharesFromProp]);

  useEffect(() => {
    if (modalOpen) {
      fetch("/api/portfolio")
        .then((r) => r.json())
        .then((data) => {
          if (data.user) {
            setUserBalance(data.user.balance || 0);
            setIsAdmin(!!data.user.isAdmin);
          }
          const holding = data.holdings?.find((h: any) => h.company_id === company.id);
          setSharesOwned(holding?.shares_owned || 0);
        })
        .catch(() => {});
    }
  }, [modalOpen, company.id]);

  async function handleExecute(companyId: number, shares: number) {
    const endpoint = modalType === "buy" ? "/api/stocks/buy" : "/api/stocks/sell";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, shares, requestId: crypto.randomUUID() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Transaction failed");
    return data;
  }

  const price = formatCoins(company.share_price);
  const isUp = company.dayChangePercent >= 0;

  return (
    <div className={`glass-card hover:border-blue-500/30 transition-all group overflow-hidden ${exiting ? "stock-card-exit" : ""}`}>
      <div 
        onClick={() => {
          setExiting(true);
          setTimeout(() => router.push(`/dashboard/stocks/${company.id}`), 280);
        }}
        className="cursor-pointer"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center text-blue-400 font-bold text-sm shrink-0">
              {company.ticker.slice(0, 3)}
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-white group-hover:text-blue-400 transition-colors">{company.ticker}</h3>
              <p className="text-xs text-gray-400 truncate">{company.name}</p>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-2xl font-bold text-white">{price}</span>
            <span className={`text-sm font-medium ${isUp ? "text-green-400" : "text-red-400"}`}>
              {isUp ? "+" : ""}{company.dayChangePercent?.toFixed(2) || "0.00"}%
            </span>
          </div>
        </div>

        {company.shareEvent && (
          <div className="mt-2 flex items-center gap-1.5 bg-yellow-500/10 text-yellow-400 text-xs px-2 py-1 rounded-md">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M2 12h20"/></svg>
            <span>+{company.shareEvent.shares_added.toLocaleString()} new shares released this week</span>
          </div>
        )}

        <div className="mb-4 overflow-hidden">
          <MiniChart prices={company.recentPrices || []} height={60} />
        </div>

        <div className="grid grid-cols-3 gap-3 text-center text-sm text-gray-400 mb-4">
          <div>
            <div className="text-white font-medium">{company.shares_available?.toLocaleString() || "0"}</div>
            <div className="text-xs">Available</div>
          </div>
          <div>
            <div className="text-white font-medium">{company.holderCount || 0}</div>
            <div className="text-xs">Holders</div>
          </div>
          <div>
            <div className="text-white font-medium">{company.buyCount || 0}</div>
            <div className="text-xs">Trades</div>
          </div>
        </div>
      </div>

      {!modalOpen && isLoggedIn && (
        <div className="flex gap-2">
          <button
            onClick={() => { setModalType("buy"); setModalOpen(true); }}
            className="flex-1 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg text-sm font-medium transition-colors"
          >
            Buy
          </button>
          {sharesOwned > 0 ? (
            <button
              onClick={() => { setModalType("sell"); setModalOpen(true); }}
              className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-medium transition-colors"
            >
              Sell
            </button>
          ) : (
            <button
              disabled
              className="flex-1 py-2.5 bg-gray-800 text-gray-600 rounded-lg text-sm font-medium cursor-not-allowed"
            >
              Sell (0)
            </button>
          )}
        </div>
      )}

      {!modalOpen && !isLoggedIn && (
        <Link href="/login" className="block w-full py-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-medium transition-colors text-center">
          Sign In to Trade
        </Link>
      )}

      {modalOpen && (
        <BuySellModal
          company={{ id: company.id, name: company.name, ticker: company.ticker, share_price: company.share_price }}
          mode={modalType}
          userBalance={userBalance}
          sharesOwned={sharesOwned}
          isAdmin={isAdmin}
          onExecute={handleExecute}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
