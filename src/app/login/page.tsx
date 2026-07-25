"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import ButtonSpinner from "@/components/ButtonSpinner";

const codeSnippets = [
  "fetch('/api/stocks/buy')",
  "await executeBuy(userId, 3, 50)",
  "share_price = 150.00",
  "INSERT INTO orders ...",
  "formatCoins(15000) → 150.00c",
  "SELECT * FROM companies",
  "balance -= totalCost",
  "price_history.push(price)",
  "const tax = cost * 0.03",
  "matchOrders(db, companyId)",
  "holdings.shares_owned++",
  "UPDATE users SET xp = xp + 1",
  "recalculateCompanyPrice()",
  "ws://localhost:3000/live",
  "GET /api/portfolio 200 OK",
  "order.status = 'filled'",
  "Math.min(remaining, shares)",
  "INSERT INTO transactions",
  "awardXP(db, userId, 3)",
  "cancelOrder(userId, orderId)",
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const banCheck = await fetch("/api/auth/check-ban", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const banData = await banCheck.json();
      if (banData.banned) {
        setError(banData.bannedUntil
          ? `Account banned until ${new Date(banData.bannedUntil).toLocaleDateString()}`
          : "Account banned until further notice"
        );
        setLoading(false);
        return;
      }
    } catch {}

    const result = await signIn("credentials", {
      redirect: false,
      username,
      password,
    });

    if (result?.error) {
      setError("Invalid username or password");
      setLoading(false);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden bg-[#0a0a0f]">
      {/* Particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(12)].map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${2 + (i % 3) * 2}px`,
              height: `${2 + (i % 3) * 2}px`,
              left: `${8 + i * 8}%`,
              bottom: "-10px",
              background: i % 3 === 0 ? "rgba(59,130,246,0.4)" : i % 3 === 1 ? "rgba(168,85,247,0.4)" : "rgba(34,197,94,0.3)",
              animation: `particleDrift ${6 + i * 1.5}s linear infinite`,
              animationDelay: `${i * 0.8}s`,
            }}
          />
        ))}
        {[...Array(8)].map((_, i) => (
          <div
            key={`d${i}`}
            className="absolute rounded-full"
            style={{
              width: `${1 + (i % 2)}px`,
              height: `${1 + (i % 2)}px`,
              left: `${5 + i * 12}%`,
              top: "-10px",
              background: i % 2 === 0 ? "rgba(59,130,246,0.3)" : "rgba(168,85,247,0.3)",
              animation: `particleDrift2 ${8 + i * 2}s linear infinite`,
              animationDelay: `${i * 1.2}s`,
            }}
          />
        ))}
      </div>

      {/* Floating code columns */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-[0.03]">
        {[0, 1, 2, 3, 4].map((col) => (
          <div
            key={col}
            className="absolute text-green-400 font-mono text-[10px] leading-5 whitespace-pre"
            style={{
              left: `${5 + col * 22}%`,
              top: 0,
              height: "200%",
              animation: `codeScroll ${20 + col * 5}s linear infinite`,
              animationDelay: `${col * -3}s`,
            }}
          >
            {[...codeSnippets, ...codeSnippets, ...codeSnippets].map((s, i) => (
              <div key={i}>{s}</div>
            ))}
          </div>
        ))}
      </div>

      {/* Gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

      {/* Floating geometric shapes */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute w-16 h-16 border border-blue-500/10 rounded-lg"
          style={{ top: "15%", left: "10%", animation: "float0 12s ease-in-out infinite", transform: "rotate(45deg)" }}
        />
        <div
          className="absolute w-10 h-10 border border-purple-500/10 rounded-full"
          style={{ top: "70%", right: "15%", animation: "float1 10s ease-in-out infinite" }}
        />
        <div
          className="absolute w-12 h-12 border border-green-500/8 rotate-12"
          style={{ bottom: "20%", left: "8%", animation: "float2 14s ease-in-out infinite" }}
        />
        <div
          className="absolute w-8 h-8 border border-blue-400/10"
          style={{ top: "40%", right: "8%", animation: "float0 9s ease-in-out infinite", transform: "rotate(30deg)" }}
        />
      </div>

      {/* Login card */}
      <div
        className={`relative z-10 glass-card max-w-md w-full transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"}`}
        style={{ animation: mounted ? "glowPulse 4s ease-in-out infinite" : undefined }}
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-1 gradient-text">Welcome Back</h1>
          <p className="text-gray-500 text-sm">Sign in to continue trading</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input-field"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pr-12"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-sm select-none"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-3 flex items-center justify-center gap-2">
            {loading ? <><ButtonSpinner size={16} /> Signing in...</> : "Sign In"}
          </button>
        </form>

        <div className="mt-6 text-center space-y-2">
          <p className="text-gray-400 text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="text-blue-400 hover:text-blue-300 transition-colors">
              Sign up
            </Link>
          </p>
          <p className="text-gray-500 text-xs">
            or{" "}
            <button
              onClick={() => { document.cookie = "guest=1;path=/;max-age=86400"; router.push("/dashboard"); }}
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              browse as guest
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
