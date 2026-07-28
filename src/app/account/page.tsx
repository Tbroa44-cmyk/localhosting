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
  stats: {
    totalTrades: number;
    totalVolume: number;
    portfolioValue: number;
    netProfit: number;
  };
}

const LEVEL_THRESHOLDS = [0, 1000, 3000, 6000, 10000, 15000, 21000, 28000, 36000, 45000, 55000, 70000, 90000, 120000, 150000, 200000];

function getLevelInfo(xp: number) {
  const level = Math.floor(xp / 1000) + 1;
  const currentLevelXp = (level - 1) * 1000;
  const nextLevelXp = level * 1000;
  const progress = xp - currentLevelXp;
  const needed = nextLevelXp - currentLevelXp;
  const percent = Math.min(100, (progress / needed) * 100);
  return { level, currentLevelXp, nextLevelXp, progress, needed, percent };
}

function getLevelColor(level: number) {
  if (level >= 20) return "bg-purple-500/20 text-purple-400 border-purple-500/30";
  if (level >= 15) return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (level >= 10) return "bg-blue-500/20 text-blue-400 border-blue-500/30";
  if (level >= 5) return "bg-green-500/20 text-green-400 border-green-500/30";
  return "bg-gray-500/20 text-gray-400 border-gray-500/30";
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
    stats: ["holdings", "trades"],
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
    stats: ["balance", "deposits"],
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
    stats: ["investments", "returns"],
  },
];

export default function AccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const isMobile = useIsMobile();
  const [accountData, setAccountData] = useState<AccountData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

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
      const portfolioRes = await fetch(`/api/portfolio?t=${Date.now()}`, { cache: "no-store" });
      const portfolioData = await portfolioRes.json();

      if (portfolioData.user) {
        const user = portfolioData.user;
        const holdings = portfolioData.holdings || [];
        const transactions = portfolioData.transactions || [];

        const totalTrades = transactions.length;
        const totalVolume = transactions.reduce((sum: number, t: any) => sum + Number(t.total_amount || 0), 0);
        const portfolioValue = holdings.reduce((sum: number, h: any) => sum + Number(h.share_price || 0) * Number(h.shares_owned || 0), 0);
        const netProfit = transactions
          .filter((t: any) => t.type === "sell" || t.type === "buy")
          .reduce((sum: number, t: any) => {
            if (String(t.type) === "sell") return sum + Number(t.total_amount || 0);
            if (String(t.type) === "buy") return sum - Number(t.total_amount || 0);
            return sum;
          }, 0);

        setAccountData({
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            balance: user.balance || 0,
            xp: user.xp || 0,
            level: user.level || 1,
            created_at: user.created_at,
          },
          stats: {
            totalTrades,
            totalVolume,
            portfolioValue,
            netProfit,
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

  const { user, stats } = accountData;
  const levelInfo = getLevelInfo(user.xp);
  const levelColor = getLevelColor(user.level);

  return (
    <div className="min-h-screen">
      <PageBackground variant="account" />
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">My Account</h1>
          <p className="text-gray-400">Manage your profile, portfolio, and settings</p>
        </div>

        <div className="glass-card mb-8 animate-fade-up" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 p-6">
            <div className="flex items-center gap-6">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/30 to-purple-500/30 flex items-center justify-center text-3xl font-bold text-white shrink-0">
                {(user.username || "?").charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-2xl md:text-3xl font-bold text-white">{user.username}</span>
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold border ${levelColor}`}>
                    Lv. {levelInfo.level}
                  </span>
                </div>
                <div className="text-gray-400 text-sm mb-3">{user.email}</div>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex-1 max-w-xs">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>XP Progress</span>
                      <span className="text-white">{user.xp.toLocaleString()} / {levelInfo.nextLevelXp.toLocaleString()}</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                        style={{ width: `${levelInfo.percent}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold gradient-text">{user.xp.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">Total XP</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-400">{formatCoins(user.balance)}</div>
                    <div className="text-xs text-gray-500">Wallet Balance</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4 text-right md:text-left border-l border-gray-700/50 pl-6 md:pl-0">
              <div>
                <div className="text-xs text-gray-500">Member Since</div>
                <div className="text-white font-medium">{new Date(user.created_at).toLocaleDateString()}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card mb-8 animate-fade-up" style={{ animationDelay: "200ms", animationFillMode: "both" }}>
          <h2 className="text-lg font-semibold text-white mb-4 px-6 py-4 border-b border-gray-700/50">Trading Statistics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6">
            <StatCard label="Total Trades" value={stats.totalTrades.toLocaleString()} icon="📊" color="text-blue-400" />
            <StatCard label="Total Volume" value={formatCoins(stats.totalVolume)} icon="💰" color="text-purple-400" />
            <StatCard label="Portfolio Value" value={formatCoins(stats.portfolioValue)} icon="📈" color="text-green-400" />
            <StatCard label="Net P&L" value={`${stats.netProfit >= 0 ? "+" : ""}${formatCoins(stats.netProfit)}`} icon={stats.netProfit >= 0 ? "📈" : "📉"} color={stats.netProfit >= 0 ? "text-green-400" : "text-red-400"} />
          </div>
        </div>

        <div className="animate-fade-up" style={{ animationDelay: "300ms", animationFillMode: "both" }}>
          <h2 className="text-xl font-bold text-white mb-4">Quick Access</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {NAV_CARDS.map((card) => (
              <Link
                key={card.key}
                href={`/${card.key}`}
                className={`group glass-card relative overflow-hidden transition-all duration-300 ${card.border} ${card.hover}`}
                onMouseEnter={() => setHoveredCard(card.key)}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ background: card.gradient }} />
                <div className="relative p-6 flex flex-col items-center text-center h-full">
                  <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-4 transition-all duration-300 ${card.text} ${card.gradient} ${card.border}`}>
                    {card.icon}
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">{card.title}</h3>
                  <p className="text-gray-400 text-sm mb-4">{card.subtitle}</p>
                  <div className="flex flex-wrap justify-center gap-2 mt-auto">
                    {card.stats.map((stat, i) => (
                      <span key={i} className={`text-xs px-2 py-1 rounded ${card.text} bg-white/5 border ${card.border}`}>
                        {stat.charAt(0).toUpperCase() + stat.slice(1)}
                      </span>
                    ))}
                  </div>
                </div>
                {hoveredCard === card.key && (
                  <div className="absolute inset-0 bg-gradient-to-t from-white/10 to-transparent pointer-events-none" />
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="glass-card mt-8 animate-fade-up" style={{ animationDelay: "400ms", animationFillMode: "both" }}>
          <h2 className="text-lg font-semibold text-white mb-4 p-6 border-b border-gray-700/50">Account Actions</h2>
          <div className="p-6 space-y-3">
            <Link href="/settings" className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group">
              <div className="flex items-center gap-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 group-hover:text-white transition-colors">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                </svg>
                <span className="text-white font-medium">Settings</span>
              </div>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-500 group-hover:text-white transition-colors">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </Link>
            <Link href="/login" className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group">
              <div className="flex items-center gap-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400 group-hover:text-white transition-colors">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                <span className="text-white font-medium">Sign Out</span>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color: string }) {
  return (
    <div className="glass-card text-center group">
      <div className="text-3xl mb-2 filter drop-shadow-[0_0_8px_rgba(99,102,241,0.3)] group-hover:scale-110 transition-transform">{icon}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}