"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useSession } from "next-auth/react";
import StockCard from "@/components/StockCard";
import Navbar from "@/components/Navbar";
import LoadingSpinner from "@/components/LoadingSpinner";
import MarketLoader from "@/components/MarketLoader";

type SortKey = "name" | "price-asc" | "price-desc" | "day-asc" | "day-desc" | "month-asc" | "month-desc" | "holders" | "buyers" | "sellers";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [companies, setCompanies] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("name");
  const [scrollScale, setScrollScale] = useState(1);
  const [isBanned, setIsBanned] = useState(false);
  const [banInfo, setBanInfo] = useState<{ banned: boolean; bannedUntil: string | null }>({ banned: false, bannedUntil: null });
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onScroll() {
      const scrollY = window.scrollY;
      const maxScroll = 800;
      const progress = Math.min(scrollY / maxScroll, 1);
      const scale = 1 + progress * 0.03;
      setScrollScale(scale);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    function loadStocks() {
      fetch(`/api/stocks?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" } })
        .then((r) => r.json())
        .then((data) => {
          setCompanies(Array.isArray(data) ? data : []);
          setLoading(false);
        })
        .catch(() => { setCompanies([]); setLoading(false); });
    }
    loadStocks();
    const interval = setInterval(loadStocks, 5000);
    const onVisible = () => { if (document.visibilityState === "visible") loadStocks(); };
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
        <Navbar />
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="flex items-center justify-center h-64">
            <MarketLoader text="Loading markets..." />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
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
      <div className="max-w-7xl mx-auto px-6 py-8" ref={mainRef} style={{ transform: `scale(${scrollScale})`, transformOrigin: "top center" }}>
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">
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
          className="w-full text-lg py-4 px-6 bg-gray-800/60 border border-gray-600/50 rounded-xl text-white placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
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
            {filtered.map((company) => (
              <StockCard key={company.id} company={company} isLoggedIn={!!session} />
            ))}
          </div>
        </div>
      ) : (
        <>
          <Section title="Top Gainers Today" subtitle="Biggest winners in the last 24 hours" items={topGainers} isLoggedIn={!!session} />
          <Section title="Top Losers Today" subtitle="Biggest losers in the last 24 hours" items={topLosers} isLoggedIn={!!session} />
          <Section title="Most Held" subtitle="Companies with the most shareholders" items={mostHeld} isLoggedIn={!!session} />
          <Section title="Most Bought" subtitle="Highest number of buy orders" items={mostTradedBuy} isLoggedIn={!!session} />
          <Section title="Most Sold" subtitle="Highest number of sell orders" items={mostTradedSell} isLoggedIn={!!session} />
          <Section title="Highest Price" subtitle="Most expensive stocks" items={priciest} isLoggedIn={!!session} />

          <div className="mt-10 mb-6">
            <h2 className="text-2xl font-bold text-white mb-1">All Companies</h2>
            <p className="text-gray-400 text-sm mb-4">{filtered.length} companies</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((company) => (
                <StockCard key={company.id} company={company} isLoggedIn={!!session} />
              ))}
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}

function Section({ title, subtitle, items, isLoggedIn }: { title: string; subtitle: string; items: any[]; isLoggedIn: boolean }) {
  if (items.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-white mb-1">{title}</h2>
      <p className="text-gray-400 text-sm mb-3">{subtitle}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((company) => (
          <StockCard key={company.id} company={company} isLoggedIn={isLoggedIn} />
        ))}
      </div>
    </div>
  );
}
