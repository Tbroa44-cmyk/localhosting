"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import MiniChart from "@/components/MiniChart";
import { formatCoins } from "@/lib/format";

const clickEffects = [
  "scale(1.15) rotate(-2deg)",
  "scale(0.92) rotate(1deg)",
  "scale(1.05) translateY(-4px)",
  "scale(0.97) rotate(-0.5deg)",
];

export default function Home() {
  const router = useRouter();
  const [stocks, setStocks] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [clickAnim, setClickAnim] = useState<string | null>(null);
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const rippleId = useRef(0);

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

  const addRipple = useCallback((x: number, y: number) => {
    const id = rippleId.current++;
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 800);
  }, []);

  function handleClick(e: React.MouseEvent, path: string) {
    const effect = clickEffects[Math.floor(Math.random() * clickEffects.length)];
    setClickAnim(effect);
    addRipple(e.clientX, e.clientY);
    setTimeout(() => setClickAnim(null), 300);
    router.push(path);
  }

  return (
    <div className="min-h-screen relative overflow-hidden select-none">
      {ripples.map((r) => (
        <div
          key={r.id}
          className="fixed pointer-events-none z-50"
          style={{ left: r.x, top: r.y, transform: "translate(-50%, -50%)" }}
        >
          <div className="w-20 h-20 rounded-full border border-blue-400/40 animate-ping" />
        </div>
      ))}

      <div className="absolute inset-0 pointer-events-none">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full opacity-[0.03] bg-blue-400"
            style={{
              width: `${80 + i * 60}px`,
              height: `${80 + i * 60}px`,
              left: `${10 + i * 15}%`,
              top: `${20 + (i % 3) * 25}%`,
              animation: `float${i % 3} ${8 + i * 2}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-6 pt-10 pb-20">
        <div className="text-center mb-16 animate-fade-up">
          <h1 className="text-6xl md:text-7xl font-bold mb-6">
            <span className="gradient-text">stockgame.uk</span>
          </h1>
          <p className="text-xl text-gray-400 max-w-xl mx-auto mb-4">
            Buy and sell virtual company shares in real-time.
            Watch prices move with every trade.
          </p>
          <p className="text-sm text-gray-500">No real money. Pure strategy.</p>
        </div>

        {stocks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20 max-w-4xl mx-auto">
            {stocks.map((stock, i) => {
              const isUp = (stock.dayChangePercent || 0) >= 0;
              const rotations = ["rotate-[-1.5deg]", "rotate-[1deg]", "rotate-[-0.5deg]"];
              return (
                <div
                  key={stock.id}
                  className={`glass-card cursor-pointer group ${rotations[i]} hover:!rotate-0 transition-all duration-500 animate-fade-up`}
                  style={{ animationDelay: `${100 + i * 200}ms`, animationFillMode: "both" }}
                  onClick={(e) => handleClick(e, `/dashboard/stocks/${stock.id}`)}
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

        <div className="flex flex-col items-center gap-4 max-w-md mx-auto">
          <button
            onClick={(e) => handleClick(e, "/register")}
            className="w-full px-8 py-5 rounded-2xl text-lg font-bold transition-all duration-300 border-2 border-green-500/40 bg-gradient-to-br from-green-600/15 to-green-900/10 text-green-400 hover:from-green-600/30 hover:to-green-900/20 hover:border-green-400/60 hover:scale-[1.03] hover:shadow-lg hover:shadow-green-500/10 active:scale-[0.97]"
            style={{ transform: "rotate(-1.5deg)" }}
          >
            Sign Up Free
            <span className="block text-xs text-green-500/50 mt-1 font-normal">Start with 1.00c bonus</span>
          </button>

          <div className="flex gap-4 w-full">
            <button
              onClick={(e) => handleClick(e, "/login")}
              className="flex-1 px-6 py-4 rounded-xl text-base font-semibold transition-all duration-300 border border-blue-500/30 bg-gradient-to-br from-blue-600/15 to-purple-900/10 text-blue-400 hover:from-blue-600/25 hover:to-purple-900/20 hover:border-blue-400/50 hover:scale-[1.03] hover:shadow-lg hover:shadow-blue-500/10 active:scale-[0.97]"
              style={{ transform: "rotate(1deg)" }}
            >
              Sign In
            </button>
            <button
              onClick={(e) => {
                document.cookie = "guest=1;path=/;max-age=86400";
                handleClick(e, "/dashboard");
              }}
              className="flex-1 px-6 py-4 rounded-xl text-base font-semibold transition-all duration-300 border border-purple-500/30 bg-gradient-to-br from-purple-600/15 to-indigo-900/10 text-purple-400 hover:from-purple-600/25 hover:to-indigo-900/20 hover:border-purple-400/50 hover:scale-[1.03] hover:shadow-lg hover:shadow-purple-500/10 active:scale-[0.97]"
              style={{ transform: "rotate(-0.5deg)" }}
            >
              Guest
            </button>
          </div>
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
