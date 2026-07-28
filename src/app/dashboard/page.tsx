"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import StockCard from "@/components/StockCard";
import Navbar from "@/components/Navbar";
import MarketLoader from "@/components/MarketLoader";
import PageBackground from "@/components/PageBackground";

type SortKey = "name" | "price-asc" | "price-desc" | "day-asc" | "day-desc" | "month-asc" | "month-desc" | "holders" | "buyers" | "sellers";

function SkeletonCard({ index }: { index: number }) {
  return (
    <div className="glass-card overflow-hidden animate-pulse" style={{ animationDelay: `${Math.min(index * 40, 300)}ms` }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-gray-700/50" />
          <div>
            <div className="h-4 w-16 bg-gray-700/50 rounded mb-2" />
            <div className="h-3 w-24 bg-gray-700/30 rounded" />
          </div>
        </div>
        <div className="text-right">
          <div className="h-6 w-16 bg-gray-700/50 rounded mb-2 ml-auto" />
          <div className="h-4 w-12 bg-gray-700/30 rounded ml-auto" />
        </div>
      </div>
      <div className="h-[60px] bg-gray-700/30 rounded mb-4" />
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="text-center"><div className="h-4 bg-gray-700/40 rounded mb-1 mx-auto w-8" /><div className="h-3 bg-gray-700/20 rounded mx-auto w-12" /></div>
        <div className="text-center"><div className="h-4 bg-gray-700/40 rounded mb-1 mx-auto w-8" /><div className="h-3 bg-gray-700/20 rounded mx-auto w-12" /></div>
        <div className="text-center"><div className="h-4 bg-gray-700/40 rounded mb-1 mx-auto w-8" /><div className="h-3 bg-gray-700/20 rounded mx-auto w-12" /></div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 h-10 bg-gray-700/40 rounded-lg" />
        <div className="flex-1 h-10 bg-gray-700/30 rounded-lg" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [isBanned, setIsBanned] = useState(false);
  const [banInfo, setBanInfo] = useState<{ banned: boolean; bannedUntil: string | null }>({ banned: false, bannedUntil: null });
  const [userHoldings, setUserHoldings] = useState<Record<number, number>>({});
  const [cardsRevealed, setCardsRevealed] = useState(false);
  const prevCountRef = useRef(0);

  function loadHoldings() {
    fetch("/api/portfolio").then(r => r.json()).then(data => {
      const map: Record<number, number> = {};
      if (Array.isArray(data.holdings)) {
        for (const h of data.holdings) {
          map[h.company_id] = h.shares_owned;
        }
      }
      setUserHoldings(map);
    }).catch(() => {});
  }

  useEffect(() => {
    function loadStocks() {
      fetch(`/api/stocks`, { headers: { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" } })
        .then((r) => r.json())
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          const isNewLoad = companies.length === 0;
          setCompanies(list);
          setLoading(false);
          if (isNewLoad && list.length > 0) {
            setCardsRevealed(true);
          }
        })
        .catch(() => { setCompanies([]); setLoading(false); });
    }
    loadStocks();
    const interval = setInterval(loadStocks, 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        loadStocks();
        if (status === "authenticated") loadHoldings();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    fetch("/api/auth/check-ban").then(r => r.json()).then(d => {
      if (d.banned) {
        setBanInfo({ banned: true, bannedUntil: d.bannedUntil || null });
        setIsBanned(true);
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get("banned") === "1") setIsBanned(true);
    }).catch(() => {});

    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  useEffect(() => {
    if (status === "authenticated") loadHoldings();
  }, [status]);

  const filtered = useMemo(() => {
    let list = [...companies];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.ticker.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q)
      );
    }
    switch (sortBy) {
      case "price-asc": list.sort((a, b) => a.share_price - b.share_price); break;
      case "price-desc": list.sort((a, b) => b.share_price - a.share_price); break;
      case "day-asc": list.sort((a, b) => (a.dayChangePercent || 0) - (b.dayChangePercent || 0)); break;
      case "day-desc": list.sort((a, b) => (b.dayChangePercent || 0) - (a.dayChangePercent || 0)); break;
      case "month-asc": list.sort((a, b) => (a.monthChangePercent || 0) - (b.monthChangePercent || 0)); break;
      case "month-desc": list.sort((a, b) => (b.monthChangePercent || 0) - (a.monthChangePercent || 0)); break;
      case "holders": list.sort((a, b) => (b.holderCount || 0) - (a.holderCount || 0)); break;
      case "buyers": list.sort((a, b) => (b.buyCount || 0) - (a.buyCount || 0)); break;
      case "sellers": list.sort((a, b) => (b.sellCount || 0) - (a.sellCount || 0)); break;
      default: list.sort((a, b) => a.ticker.localeCompare(b.ticker));
    }
    return list;
  }, [companies, search, sortBy]);

  const topGainers = useMemo(() =>
    [...companies].sort((a, b) => (b.dayChangePercent || 0) - (a.dayChangePercent || 0)).slice(0, 6),
    [companies]
  );

  const topLosers = useMemo(() =>
    [...companies].sort((a, b) => (a.dayChangePercent || 0) - (b.dayChangePercent || 0)).slice(0, 6),
    [companies]
  );

  const mostHeld = useMemo(() =>
    [...companies].sort((a, b) => (b.holderCount || 0) - (a.holderCount || 0)).slice(0, 6),
    [companies]
  );

  const mostTradedBuy = useMemo(() =>
    [...companies].sort((a, b) => (b.buyCount || 0) - (a.buyCount || 0)).slice(0, 6),
    [companies]
  );

  const mostTradedSell = useMemo(() =>
    [...companies].sort((a, b) => (b.sellCount || 0) - (a.sellCount || 0)).slice(0, 6),
    [companies]
  );

  const priciest = useMemo(() =>
    [...companies].sort((a, b) => b.share_price - a.share_price).slice(0, 6),
    [companies]
  );

  const isFiltering = search.trim().length > 0 || sortBy !== "name";

  if (loading) {
    return (
      <div className="min-h-screen">
        <PageBackground variant="market" />
        <Navbar />
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="mb-8">
            <div className="h-10 w-48 bg-gray-700/40 rounded-lg animate-pulse mb-2" />
            <div className="h-5 w-64 bg-gray-700/30 rounded animate-pulse" />
          </div>
          <div className="mb-8">
            <div className="h-14 w-full bg-gray-700/30 rounded-xl animate-pulse" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 18 }).map((_, i) => (
              <SkeletonCard key={i} index={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PageBackground />
      <Navbar />
      {isBanned && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-red-400 text-sm">
              {banInfo.bannedUntil
                ? <>Your account is banned until <strong>{new Date(banInfo.bannedUntil).toLocaleDateString()}</strong>.</>
                : <>Your account has been <strong>banned until further notice</strong>.</>
              }{" "}
              You can browse the market but cannot trade, view your portfolio, or add funds.
            </p>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl md:text-4xl font-bold mb-2">
          <span className="gradient-text">Stock Market</span>
        </h1>
        <p className="text-gray-400">{companies.length} companies available for trading</p>
      </div>

      <div className="mb-8">
        <input
          type="text"
          placeholder="Search by ticker or company name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full text-base md:text-lg py-3 md:py-4 px-4 md:px-6 bg-gray-800/60 border border-gray-600/50 rounded-xl text-white placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
        />
      </div>

      <div className="mb-8">
        <label className="text-sm text-gray-400 mr-2">Sort:</label>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
        >
          <option value="name">A-Z</option>
          <option value="price-desc">Price: High → Low</option>
          <option value="price-asc">Price: Low → High</option>
          <option value="day-desc">% Today: Best</option>
          <option value="day-asc">% Today: Worst</option>
          <option value="month-desc">% Month: Best</option>
          <option value="month-asc">% Month: Worst</option>
          <option value="holders">Most Holders</option>
          <option value="buyers">Most Buyers</option>
          <option value="sellers">Most Sellers</option>
        </select>
      </div>

      {isFiltering ? (
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-1">Results</h2>
          <p className="text-gray-400 text-sm mb-4">{filtered.length} companies found</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((company, i) => (
              <AnimatedCard key={company.id} company={company} index={i} isLoggedIn={!!session} userHoldings={userHoldings} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <Section title="Top Gainers Today" subtitle="Biggest winners in the last 24 hours" items={topGainers} isLoggedIn={!!session} userHoldings={userHoldings} />
          <Section title="Top Losers Today" subtitle="Biggest losers in the last 24 hours" items={topLosers} isLoggedIn={!!session} userHoldings={userHoldings} />
          <Section title="Most Held" subtitle="Companies with the most shareholders" items={mostHeld} isLoggedIn={!!session} userHoldings={userHoldings} />
          <Section title="Most Bought" subtitle="Highest number of buy orders" items={mostTradedBuy} isLoggedIn={!!session} userHoldings={userHoldings} />
          <Section title="Most Sold" subtitle="Highest number of sell orders" items={mostTradedSell} isLoggedIn={!!session} userHoldings={userHoldings} />
          <Section title="Highest Price" subtitle="Most expensive stocks" items={priciest} isLoggedIn={!!session} userHoldings={userHoldings} />

          <div className="mt-10 mb-6">
            <h2 className="text-2xl font-bold text-white mb-1">All Companies</h2>
            <p className="text-gray-400 text-sm mb-4">{filtered.length} companies</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((company, i) => (
                <AnimatedCard key={company.id} company={company} index={i} isLoggedIn={!!session} userHoldings={userHoldings} />
              ))}
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function AnimatedCard({ company, index, isLoggedIn, userHoldings }: { company: any; index: number; isLoggedIn: boolean; userHoldings: Record<number, number> }) {
  return (
    <div className="stock-card-enter" style={{ animationDelay: `${Math.min(index * 50, 400)}ms` }}>
      <StockCard company={company} isLoggedIn={isLoggedIn} userHoldings={userHoldings} />
    </div>
  );
}

function Section({ title, subtitle, items, isLoggedIn, userHoldings }: { title: string; subtitle: string; items: any[]; isLoggedIn: boolean; userHoldings: Record<number, number> }) {
  if (items.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
      <p className="text-gray-400 text-sm mb-3">{subtitle}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((company, i) => (
          <AnimatedCard key={company.id} company={company} index={i} isLoggedIn={isLoggedIn} userHoldings={userHoldings} />
        ))}
      </div>
    </div>
  );
}
