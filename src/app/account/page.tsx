"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import LoadingSpinner from "@/components/LoadingSpinner";
import PageBackground from "@/components/PageBackground";
import { formatCoins } from "@/lib/format";
import { useIsMobile } from "@/hooks/useIsMobile";

interface AccountData {
  user: {
    id: number;
    username: string;
    email: string;
    balance: number;
    xp: number;
    level: number;
    created_at: string;
  };
}

function getLevelInfo(xp: number) {
  const LEVEL_THRESHOLDS = [0, 1000, 3000, 6000, 10000, 15000, 21000, 28000, 36000, 45000, 55000, 70000, 90000, 120000, 150000, 200000];
  let level = 1;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (xp >= LEVEL_THRESHOLDS[i]) level = i + 1;
  }
  const currentThreshold = LEVEL_THRESHOLDS[level - 1] || 0;
  const nextThreshold = LEVEL_THRESHOLDS[level] || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  const progress = xp - currentThreshold;
  const needed = nextThreshold - currentThreshold;
  const percent = Math.min(100, Math.max(0, (progress / needed) * 100));
  return { level, xp, currentThreshold, nextThreshold, progress, needed, percent };
}

const NAV_CARDS = [
  {
    key: "portfolio",
    title: "Portfolio",
    subtitle: "Your holdings & transaction history",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
    ),
    gradient: "from-blue-500/20 to-cyan-500/20",
    border: "border-blue-500/30",
    text: "text-blue-400",
    hover: "hover:border-blue-400/50 hover:shadow-lg hover:shadow-blue-500/10",
    href: "/dashboard",
  },
  {
    key: "wallet",
    title: "Wallet",
    subtitle: "Buy coins & manage payments",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M21 12V7H5V7M21 17H5M4 21h16a2 2 0 002-2V5a2 2 0 00-2-2H4a2 2 0 00-2 2v14a2 2 0 002 2z" />
      </svg>
    ),
    gradient: "from-purple-500/20 to-pink-500/20",
    border: "border-purple-500/30",
    text: "text-purple-400",
    hover: "hover:border-purple-400/50 hover:shadow-lg hover:shadow-purple-500/10",
    href: "/wallet",
  },
  {
    key: "bank",
    title: "Bank",
    subtitle: "Auto-invest & grow your savings",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14v8m-4-4h8" />
      </svg>
    ),
    gradient: "from-green-500/20 to-emerald-500/20",
    border: "border-green-500/30",
    text: "text-green-400",
    hover: "hover:border-green-400/50 hover:shadow-lg hover:shadow-green-500/10",
    href: "/bank",
  },
];

export default function AccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetchAccountData();
      const interval = setInterval(fetchAccountData, 30000);
      return () => clearInterval(interval);
    }
  }, [status]);

  async function fetchAccountData() {
    try {
      const res = await fetch(`/api/portfolio?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      if (data.user) {
        setAccountData({
          user: {
            id: data.user.id,
            username: data.user.username,
            email: data.user.email,
            balance: data.user.balance || 0,
            xp: data.user.xp || 0,
            level: data.user.level || 1,
            created_at: data.user.created_at,
          },
        });
      }
    } catch (e) {
      console.error("Failed to fetch account data:", e);
    } finally {
      setLoaded(true);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageBackground />
        <Navbar />
        <LoadingSpinner size="lg" text="Loading account..." />
      </div>
    );
  }

  if (!accountData) {
    return (
      <div className="min-h-screen">
        <PageBackground />
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 py-12 text-center">
          <LoadingSpinner size="lg" text="Loading..." />
        </div>
      </div>
    );
  }

  const { user } = accountData;
  const levelInfo = getLevelInfo(user.xp);

  return (
    <div className="min-h-screen">
      <PageBackground variant="account" />
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">My Account</h1>
          <p className="text-gray-400">Manage your profile, portfolio, and settings</p>
        </div>

        {/* Quick Access — top with wallet balance */}
        <div className="animate-fade-up" style={{ animationDelay: "50ms", animationFillMode: "both" }}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {NAV_CARDS.map((card) => (
              <Link
                key={card.key}
                href={card.href}
                className={`group glass-card relative overflow-hidden transition-all duration-300 ${card.border} ${card.hover}`}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: card.gradient }} />
                <div className="relative p-6 flex flex-col items-center text-center h-full">
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-all duration-300 ${card.text} ${card.gradient} ${card.border}`}>
                    {card.icon}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">{card.title}</h3>
                  <p className="text-gray-400 text-sm">{card.subtitle}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Profile card: name, email, XP/Level, creation date */}
        <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/60 to-gray-950/40 p-6 mb-8 animate-fade-up" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
          <div className="flex flex-col md:flex-row md:items-start gap-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-2xl font-bold text-white shrink-0">
              {(user.username || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-2xl font-bold text-white mb-0.5">{user.username}</div>
              <div className="text-gray-400 text-sm mb-4">{user.email}</div>

              {/* XP & Level — different design */}
              <div className="flex items-center gap-4 mb-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                  <svg className="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-indigo-300 font-bold text-lg">Lv.{levelInfo.level}</span>
                </div>
                <div className="flex-1 max-w-xs">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{levelInfo.xp.toLocaleString()} XP</span>
                    <span className="text-gray-400">{levelInfo.needed.toLocaleString()} XP to next level</span>
                  </div>
                  <div className="h-2.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
                      style={{ width: `${levelInfo.percent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-600">
                Member since {new Date(user.created_at).toLocaleDateString()}
              </div>
            </div>

            {/* Wallet balance peek */}
            <div className="shrink-0 text-right">
              <div className="text-xs text-gray-500 mb-1">Wallet Balance</div>
              <div className="text-2xl font-bold text-emerald-400">{formatCoins(user.balance)}</div>
            </div>
          </div>
        </div>

        {/* Account Actions */}
        <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/60 to-gray-950/40 animate-fade-up" style={{ animationDelay: "150ms", animationFillMode: "both" }}>
          <div className="px-6 py-4 border-b border-gray-800">
            <h2 className="text-lg font-semibold text-white">Account Actions</h2>
          </div>
          <div className="p-4 space-y-1">
            <Link href="/login" className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group">
              <div className="flex items-center gap-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 group-hover:text-white transition-colors">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span className="text-white font-medium">Sign Out</span>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500 group-hover:text-white transition-colors">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </Link>
          </div>
        </div>

        {/* Server Info — moved from wallet */}
        <div className="rounded-xl border border-gray-800 bg-gradient-to-br from-gray-900/60 to-gray-950/40 p-6 mt-6 animate-fade-up" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
            Server Info
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-gray-500 mb-1">Website</div>
              <div className="text-white font-medium">stockgame.uk</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Version</div>
              <div className="text-white font-medium">v1.4.0</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Platform</div>
              <div className="text-white font-medium">Next.js + Supabase</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Hosted on</div>
              <div className="text-white font-medium">Vercel</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
