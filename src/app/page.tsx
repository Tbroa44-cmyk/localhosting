"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MiniChart from "@/components/MiniChart";
import { formatCoins } from "@/lib/format";

export default function Home() {
  const router = useRouter();
  const [stocks, setStocks] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/stocks?t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length >= 3) {
          const shuffled = [...data].sort(() => Math.random() - 0.5);
          setStocks(shuffled.slice(0, 3));
        } else if (Array.isArray(data)) {
          setStocks(data);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 via-transparent to-purple-900/20 pointer-events-none" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

      <nav className="relative z-10 flex justify-between items-center px-6 py-5">
        <div className="text-2xl font-bold gradient-text">stockgame.uk</div>
        <button
          onClick={() => router.push("/login")}
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-300 border
            ${hoveredBtn === "signin"
              ? "bg-blue-600/30 border-blue-400/60 text-blue-300 scale-105 rotate-[-1deg]"
              : "bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/30"
            }`}
          onMouseEnter={() => setHoveredBtn("signin")}
          onMouseLeave={() => setHoveredBtn(null)}
          style={{ transform: hoveredBtn === "signin" ? "rotate(-1deg) scale(1.05)" : "rotate(0.5deg)" }}
        >
          Sign In
        </button>
      </nav>

      <div className="relative z-10 max-w-7xl mx-auto px-6 pt-10 pb-20">
        <div className="text-center mb-16 animate-fade-up">
          <h1 className="text-6xl md:text-7xl font-bold mb-6">
            <span className="gradient-text">Trade Virtual Stocks</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-xl mx-auto mb-4">
            Buy and sell real-time virtual company shares. Watch prices move with every trade.
          </p>
          <p className="text-sm text-gray-500">No real money. Pure strategy.</p>
        </div>

        {stocks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20 max-w-4xl mx-auto">
            {stocks.map((stock, i) => {
              const rotations = ["rotate-[-1.5deg]", "rotate-[1deg]", "rotate-[-0.5deg]"];
              const delays = ["animation-delay-100", "animation-delay-300", "animation-delay-500"];
              const isUp = (stock.dayChangePercent || 0) >= 0;
              return (
                <div
                  key={stock.id}
                  className={`glass-card cursor-pointer group ${rotations[i]} hover:!rotate-0 transition-all duration-500 animate-fade-up ${delays[i]}`}
                  style={{ animationDelay: `${100 + i * 200}ms` }}
                  onClick={() => router.push(`/dashboard/stocks/${stock.id}`)}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-blue-500/20 rounded flex items-center justify-center text-blue-400 font-bold text-xs">
                      {stock.ticker?.slice(0, 3)}
                    </div>
                    <span className="text-xs text-gray-500 font-mono">{stock.ticker}</span>
                  </div>
                  <div className="text-2xl font-bold text-white mb-1">{formatCoins(stock.share_price)}</div>
                  <div className={`text-sm font-medium mb-3 ${isUp ? "text-green-400" : "text-red-400"}`}>
                    {isUp ? "+" : ""}{stock.dayChangePercent?.toFixed(2) || "0.00"}%
                  </div>
                  <div className="overflow-hidden rounded">
                    <MiniChart prices={stock.recentPrices || []} height={48} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loaded && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20 max-w-4xl mx-auto">
            {[0, 1, 2].map((i) => (
              <div key={i} className="glass-card animate-pulse" style={{ animationDelay: `${i * 150}ms` }}>
                <div className="h-4 bg-gray-700/50 rounded w-16 mb-3" />
                <div className="h-7 bg-gray-700/50 rounded w-24 mb-1" />
                <div className="h-4 bg-gray-700/50 rounded w-14 mb-3" />
                <div className="h-12 bg-gray-700/30 rounded" />
              </div>
            ))}
          </div>
        )}

        <div className="relative max-w-lg mx-auto" style={{ minHeight: "280px" }}>
          <button
            onClick={() => router.push("/register")}
            className="absolute top-0 right-0 px-8 py-4 rounded-xl text-lg font-semibold transition-all duration-300 border border-green-500/30 bg-green-600/10 text-green-400 hover:bg-green-600/25 hover:border-green-400/50 hover:scale-105 hover:rotate-[1deg]"
            style={{ transform: "rotate(-2deg)" }}
            onMouseEnter={() => setHoveredBtn("signup")}
            onMouseLeave={() => setHoveredBtn(null)}
          >
            Sign Up Free
            <span className="block text-xs text-green-500/60 mt-1 font-normal">Start with 1.00c bonus</span>
          </button>

          <button
            onClick={() => router.push("/login")}
            className="absolute top-16 left-0 px-7 py-3.5 rounded-xl text-base font-medium transition-all duration-300 border border-purple-500/30 bg-purple-600/10 text-purple-400 hover:bg-purple-600/25 hover:border-purple-400/50 hover:scale-105 hover:rotate-[2deg]"
            style={{ transform: "rotate(1.5deg)" }}
            onMouseEnter={() => setHoveredBtn("guest")}
            onMouseLeave={() => setHoveredBtn(null)}
            onMouseDown={() => {
              document.cookie = "guest=1;path=/;max-age=86400";
              router.push("/dashboard");
            }}
          >
            Enter as Guest
            <span className="block text-xs text-purple-500/60 mt-1 font-normal">Browse without account</span>
          </button>
        </div>

        <div className="mt-20 grid grid-cols-3 gap-6 text-center max-w-2xl mx-auto">
          <div className="glass-card !p-4" style={{ transform: "rotate(-0.5deg)" }}>
            <div className="text-2xl font-bold text-white mb-1">10+</div>
            <div className="text-xs text-gray-400">Companies</div>
          </div>
          <div className="glass-card !p-4" style={{ transform: "rotate(0.3deg)" }}>
            <div className="text-2xl font-bold gradient-text mb-1">Live</div>
            <div className="text-xs text-gray-400">Real-time prices</div>
          </div>
          <div className="glass-card !p-4" style={{ transform: "rotate(-0.8deg)" }}>
            <div className="text-2xl font-bold text-white mb-1">XP</div>
            <div className="text-xs text-gray-400">Level up system</div>
          </div>
        </div>
      </div>
    </div>
  );
}
