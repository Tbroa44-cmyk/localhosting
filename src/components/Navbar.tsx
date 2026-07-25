"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState, useEffect } from "react";
import { formatCoins } from "@/lib/format";

export default function Navbar() {
  const { data: session, status } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);
  const [tradingStatus, setTradingStatus] = useState<{ isOpen: boolean; openHour: number; closeHour: number; message: string } | null>(null);
  const [userTz, setUserTz] = useState<string>("");

  useEffect(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setUserTz(tz);
    } catch {}
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

  function getLocalTimeLabel(): string {
    if (!tradingStatus || !userTz) return "";
    try {
      const now = new Date();
      const aestOffset = 10;
      const aestDate = new Date(now.toLocaleString("en-US", { timeZone: "Australia/Brisbane" }));
      aestDate.setHours(tradingStatus.openHour, 0, 0, 0);
      const openLocal = new Date(aestDate.toLocaleString("en-US", { timeZone: userTz }));
      aestDate.setHours(tradingStatus.closeHour, 0, 0, 0);
      const closeLocal = new Date(aestDate.toLocaleString("en-US", { timeZone: userTz }));

      const fmt = (d: Date) => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: userTz });
      const tzAbbr = new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone: userTz }).formatToParts(now).find(p => p.type === "timeZoneName")?.value || userTz.split("/").pop();

      return `${fmt(openLocal)} - ${fmt(closeLocal)} ${tzAbbr}`;
    } catch {
      return `${tradingStatus.openHour}:00 - ${tradingStatus.closeHour}:00 AEST`;
    }
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
    <nav className="glass sticky top-0 z-50 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-2xl font-bold gradient-text">
            stockgame.uk
          </Link>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
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
                <span className="text-amber-400/60 ml-0.5">{getLocalTimeLabel() || getTimeUntilChange()}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                Closed
                <span className="text-indigo-400/60 ml-0.5">{getLocalTimeLabel() || getTimeUntilChange()}</span>
              </span>
            )}
          </div>
        </div>

        {session ? (
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
        ) : (
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-gray-300 hover:text-white transition-colors">
              Login
            </Link>
            <Link href="/register" className="btn-primary">
              Sign Up
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
