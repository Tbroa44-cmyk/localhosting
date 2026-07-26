"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect, useRef } from "react";
import { formatCoins } from "@/lib/format";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const { data: session, status } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);
  const [tradingStatus, setTradingStatus] = useState<{ isOpen: boolean; openHour: number; closeHour: number; message: string } | null>(null);
  const isMobile = useIsMobile();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const [navHidden, setNavHidden] = useState(false);
  const [navSolid, setNavSolid] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    if (!isMobile) {
      setNavHidden(false);
      setNavSolid(false);
      return;
    }

    function handleScroll() {
      const y = window.scrollY;
      const isStockPage = pathname.startsWith("/dashboard/stocks/");

      if (isStockPage) {
        if (y > lastScrollY.current && y > 60) {
          setNavHidden(true);
          setMenuOpen(false);
        } else {
          setNavHidden(false);
        }
      } else {
        setNavHidden(false);
        setNavSolid(y > 20);
      }
      lastScrollY.current = y;
    }

    lastScrollY.current = window.scrollY;
    setNavSolid(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isMobile, pathname]);

  useEffect(() => {
    fetchTradingStatus();
    const interval = setInterval(fetchTradingStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  function fetchTradingStatus() {
    fetch(`/api/trading-status?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache" } })
      .then(r => r.json())
      .then(setTradingStatus)
      .catch(() => {});
  }

  function getTimeUntilChange(): string {
    if (!tradingStatus) return "";
    const now = new Date();
    const currentHour = (now.getUTCHours() + 10) % 24;
    if (tradingStatus.isOpen) {
      const minsUntilClose = ((tradingStatus.closeHour - currentHour) * 60) - now.getMinutes();
      if (minsUntilClose <= 0) return "closing soon";
      const h = Math.floor(minsUntilClose / 60);
      const m = minsUntilClose % 60;
      return h > 0 ? `${h}h ${m}m until close` : `${m}m until close`;
    } else {
      const minsUntilOpen = ((tradingStatus.openHour - currentHour + 24) % 24) * 60 - now.getMinutes();
      if (minsUntilOpen <= 0) return "opening soon";
      const h = Math.floor(minsUntilOpen / 60);
      const m = minsUntilOpen % 60;
      return h > 0 ? `${h}h ${m}m until open` : `${m}m until open`;
    }
  }

  function handleLogout() {
    setLoggingOut(true);
    document.body.classList.add("animate-logout-slide");
    setTimeout(() => {
      signOut({ redirect: false }).then(() => {
        window.location.href = "/login";
      });
    }, 350);
  }

  const isOpen = tradingStatus?.isOpen ?? true;

  return (
    <nav
      className={`sticky top-0 z-50 px-4 md:px-6 py-3 transition-all duration-300 ${
        isMobile && navHidden ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
      } ${
        isMobile && navSolid
          ? "bg-gray-950/95 border-b border-gray-800/80 backdrop-blur-md"
          : "glass"
      }`}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-4">
          <Link href="/dashboard" className="text-xl md:text-2xl font-bold gradient-text">
            stockgame.uk
          </Link>
          <div className={`flex items-center gap-1.5 px-2 md:px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
            isOpen
              ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
              : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
          }`}>
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isOpen ? "bg-amber-400" : "bg-indigo-400"}`} />
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isOpen ? "bg-amber-500" : "bg-indigo-500"}`} />
            </span>
            {isOpen ? (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round"/></svg>
                Open
                <span className="text-amber-400/60 ml-0.5 hidden sm:inline">{getTimeUntilChange()}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                Closed
                <span className="text-indigo-400/60 ml-0.5 hidden sm:inline">{getTimeUntilChange()}</span>
              </span>
            )}
          </div>
        </div>

        {!isMobile && session ? (
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-gray-300 hover:text-white transition-colors">
              Markets
            </Link>
            <Link href="/portfolio" className="text-gray-300 hover:text-white transition-colors">
              Portfolio
            </Link>
            <Link href="/wallet" className="text-gray-300 hover:text-white transition-colors">
              Wallet
            </Link>
            {(session.user as any)?.isAdmin && (
              <Link href="/admin" className="text-yellow-400 hover:text-yellow-300 transition-colors font-medium">
                Admin Panel
              </Link>
            )}
            <div className="flex items-center gap-3 pl-3 border-l border-gray-700">
              <span className="text-sm text-gray-400">{(session.user as any)?.username}</span>
              {(session.user as any)?.level && (
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  (session.user as any).level >= 10 ? "bg-blue-500/20 text-blue-400" :
                  (session.user as any).level >= 5 ? "bg-green-500/20 text-green-400" :
                  "bg-gray-500/20 text-gray-400"
                }`}>
                  Lv.{(session.user as any).level}
                </span>
              )}
              <span className="text-green-400 font-semibold">
                {(session.user as any)?.isAdmin ? "Unlimited" : formatCoins((session.user as any)?.balance || 0)}
              </span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-gray-400 hover:text-red-400 transition-colors text-sm disabled:opacity-50"
              >
                Logout
              </button>
            </div>
          </div>
        ) : !isMobile ? (
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-gray-300 hover:text-white transition-colors">
              Login
            </Link>
            <Link href="/register" className="btn-primary">
              Sign Up
            </Link>
          </div>
        ) : null}

        {isMobile && (
          <button onClick={() => setMenuOpen(!menuOpen)} className="text-gray-300 hover:text-white p-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {menuOpen ? (
                <path d="M18 6L6 18M6 6l12 12" />
              ) : (
                <path d="M3 12h18M3 6h18M3 18h18" />
              )}
            </svg>
          </button>
        )}
      </div>

      {isMobile && menuOpen && (
        <div className="md:hidden mt-3 pb-3 border-t border-gray-700/50 pt-3 space-y-2">
          {session ? (
            <>
              <div className="flex items-center justify-between px-2 py-2">
                <span className="text-sm text-gray-400">{(session.user as any)?.username}</span>
                <span className="text-green-400 font-semibold text-sm">
                  {(session.user as any)?.isAdmin ? "Unlimited" : formatCoins((session.user as any)?.balance || 0)}
                </span>
              </div>
              <Link href="/dashboard" onClick={() => setMenuOpen(false)} className="block px-2 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Markets</Link>
              <Link href="/portfolio" onClick={() => setMenuOpen(false)} className="block px-2 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Portfolio</Link>
              <Link href="/wallet" onClick={() => setMenuOpen(false)} className="block px-2 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Wallet</Link>
              {(session.user as any)?.isAdmin && (
                <Link href="/admin" onClick={() => setMenuOpen(false)} className="block px-2 py-2 text-yellow-400 hover:text-yellow-300 hover:bg-white/5 rounded-lg transition-colors font-medium">Admin Panel</Link>
              )}
              <button onClick={() => { setMenuOpen(false); handleLogout(); }} className="block w-full text-left px-2 py-2 text-red-400 hover:text-red-300 hover:bg-white/5 rounded-lg transition-colors">Logout</button>
            </>
          ) : (
            <>
              <Link href="/login" onClick={() => setMenuOpen(false)} className="block px-2 py-2 text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors">Login</Link>
              <Link href="/register" onClick={() => setMenuOpen(false)} className="block px-2 py-2 text-blue-400 hover:text-blue-300 hover:bg-white/5 rounded-lg transition-colors font-medium">Sign Up</Link>
            </>
          )}
        </div>
      )}
    </nav>
  );
}
