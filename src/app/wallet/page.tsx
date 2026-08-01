"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Navbar from "@/components/Navbar";
import { formatCoins } from "@/lib/format";
import PageBackground from "@/components/PageBackground";

const PACKAGES = [
  { coins: 100, receive: 100, price: 1.0, label: "Starter", color: "from-blue-500/20 to-cyan-500/20", border: "border-blue-500/30", text: "text-blue-400", icon: "1" },
  { coins: 500, receive: 550, price: 5.0, label: "Popular", color: "from-purple-500/20 to-pink-500/20", border: "border-purple-500/30", text: "text-purple-400", icon: "2", badge: "+10% bonus" },
  { coins: 1000, receive: 1200, price: 10.0, label: "Best Value", color: "from-green-500/20 to-emerald-500/20", border: "border-green-500/30", text: "text-green-400", icon: "3", badge: "+20% bonus" },
  { coins: 5000, receive: 6500, price: 50.0, label: "Whale", color: "from-amber-500/20 to-orange-500/20", border: "border-amber-500/30", text: "text-amber-400", icon: "4", badge: "+30% bonus" },
];

const KOFI_URLS: Record<number, string> = {
  100: "https://ko-fi.com/s/f1b66e7d8a",
  500: "",
  1000: "",
  5000: "",
};

interface PaymentRecord {
  id: number;
  amount_cents: number;
  coins: number;
  status: string;
  created_at: string;
}

export default function WalletPage() {
  const { data: session, update } = useSession();
  const [showCheckout, setShowCheckout] = useState<typeof PACKAGES[0] | null>(null);
  const [claimEmail, setClaimEmail] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState("");
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [polling, setPolling] = useState(false);
  const [pollTimer, setPollTimer] = useState(0);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);

  const isAdmin = (session?.user as any)?.isAdmin;
  const userEmail = (session?.user as any)?.email || "";

  const fetchPayments = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet/kofi-status");
      const data = await res.json();
      if (data.payments) setPayments(data.payments);
    } catch {}
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  useEffect(() => {
    function fetchBalance() {
      fetch(`/api/user/balance?t=${Date.now()}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => { if (typeof data.balance === "number") setLiveBalance(data.balance); })
        .catch(() => {});
    }
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    window.addEventListener("balance-changed", fetchBalance);
    return () => { clearInterval(interval); window.removeEventListener("balance-changed", fetchBalance); };
  }, []);

  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      await update();
      await fetchPayments();
      setPollTimer((prev) => {
        if (prev <= 1) {
          setPolling(false);
          return 0;
        }
        return prev - 1;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [polling, update, fetchPayments]);

  function handleBuyTier(pkg: typeof PACKAGES[0]) {
    if (isAdmin) return;
    setShowCheckout(pkg);
  }

  function openKoFi() {
    if (!showCheckout) return;
    const url = KOFI_URLS[showCheckout.coins];
    if (!url) {
      window.alert("This tier is not available yet. Please check back soon!");
      return;
    }
    window.open(url, "_blank");
    setPolling(true);
    setPollTimer(120);
  }

  async function handleClaim() {
    if (!claimEmail.trim()) return;
    setClaiming(true);
    setClaimResult("");
    try {
      const res = await fetch("/api/wallet/kofi-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: claimEmail.trim() }),
      });
      const data = await res.json();
      if (data.found) {
        setClaimResult(`Found and credited ${data.coins}c from ${data.count} payment(s)!`);
        await update();
        await fetchPayments();
      } else {
        setClaimResult(data.message || "No unclaimed payments found for this email");
      }
    } catch {
      setClaimResult("Failed to check payments");
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div className="min-h-screen">
      <PageBackground variant="wallet" />
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-white mb-2">Purchase Coins</h1>
        <p className="text-gray-400 mb-8">Buy coins to trade on the stock market</p>

        <div className="glass-card mb-8">
          <div className="text-center">
            <div className="text-sm text-gray-400 mb-1">Your Balance</div>
            {isAdmin ? (
              <>
                <div className="text-5xl font-bold gradient-text">Unlimited</div>
                <div className="text-sm text-yellow-400 mt-1">Admin: free trades, no purchase needed</div>
              </>
            ) : (
              <>
                <div className="text-5xl font-bold gradient-text">{liveBalance === null ? "Unknown" : formatCoins(liveBalance)}</div>
              </>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="glass-card text-center mb-8 border-yellow-500/30">
            <p className="text-yellow-400 font-semibold">Admin accounts have unlimited coins. No purchase needed.</p>
          </div>
        )}

        {!isAdmin && !showCheckout && (
          <>
            <h2 className="text-xl font-semibold text-white mb-4">Select a Package</h2>
            <div className="flex justify-center mb-8">
              <div className="grid grid-cols-1 gap-4 w-full max-w-xs">
              {PACKAGES.filter((pkg) => !!KOFI_URLS[pkg.coins]).map((pkg) => (
                  <button
                    key={pkg.coins}
                    onClick={() => handleBuyTier(pkg)}
                    className={`glass-card text-center transition-all hover:scale-[1.02] cursor-pointer ${pkg.border}`}
                  >
                    {pkg.badge && (
                      <div className={`text-xs font-bold ${pkg.text} mb-1`}>{pkg.badge}</div>
                    )}
                    <div className={`text-xs font-medium ${pkg.text} mb-1 opacity-70`}>{pkg.label}</div>
                    <div className="text-2xl font-bold text-white">{pkg.receive.toLocaleString()}c</div>
                    <div className="text-lg text-gray-300 font-semibold mt-1">${pkg.price.toFixed(2)}</div>
                    <div className="text-xs text-gray-500 mt-2">Pay on Ko-fi</div>
                  </button>
              ))}
              </div>
            </div>
          </>
        )}

        {!isAdmin && showCheckout && (
          <div className="glass-card mb-8 border-green-500/30">
            <button onClick={() => { setShowCheckout(null); setPolling(false); }} className="text-sm text-gray-400 hover:text-white mb-4 flex items-center gap-1">
              <span>&larr;</span> Back to packages
            </button>
            <div className="text-center">
              <div className={`text-4xl font-bold text-white mb-1`}>{showCheckout.receive.toLocaleString()}c</div>
              <div className="text-gray-400 mb-6">${showCheckout.price.toFixed(2)} via Ko-fi</div>

              <button
                onClick={openKoFi}
                className="bg-[#FF5E5B] hover:bg-[#FF4040] text-white font-bold py-3 px-8 rounded-lg text-lg transition-all hover:scale-105 flex items-center gap-2 mx-auto"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                Pay ${showCheckout.price.toFixed(2)} on Ko-fi
              </button>

              <div className="mt-6 space-y-3 text-left text-sm text-gray-400 max-w-md mx-auto">
                <div className="flex items-start gap-3">
                  <span className="text-green-400 font-bold shrink-0">1.</span>
                  <p>Click the button above to open Ko-fi</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-400 font-bold shrink-0">2.</span>
                  <p>Pay using the <strong className="text-white">same email</strong> you registered with on this site</p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="text-green-400 font-bold shrink-0">3.</span>
                  <p>Coins are credited automatically via webhook when payment completes</p>
                </div>
              </div>

              {polling && (
                <div className="mt-6 p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                  <div className="flex items-center justify-center gap-2 text-green-400 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-sm font-medium">Waiting for payment... (checking every 5s)</span>
                  </div>
                  <p className="text-xs text-gray-500">Page will auto-update when your payment is detected. You can safely close this tab and come back.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!isAdmin && (
          <div className="glass-card mb-8">
            <h3 className="text-lg font-semibold text-white mb-3">Payment didn&apos;t arrive?</h3>
            <p className="text-sm text-gray-400 mb-4">
              If you paid but coins haven&apos;t appeared, enter the email you used on Ko-fi to manually claim your payment.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="Email used on Ko-fi"
                value={claimEmail}
                onChange={(e) => setClaimEmail(e.target.value)}
                className="input-field flex-1"
              />
              <button
                onClick={handleClaim}
                disabled={claiming || !claimEmail.trim()}
                className="btn-primary px-4 py-2 text-sm shrink-0 disabled:opacity-50"
              >
                {claiming ? "Checking..." : "Claim"}
              </button>
            </div>
            {claimResult && (
              <p className={`text-sm mt-2 ${claimResult.includes("Found") ? "text-green-400" : "text-gray-400"}`}>
                {claimResult}
              </p>
            )}
          </div>
        )}

        {payments.length > 0 && (
          <div className="glass-card mb-8">
            <h3 className="text-lg font-semibold text-white mb-3">Recent Purchases</h3>
            <div className="space-y-2">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-700/30 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      p.status === "completed" ? "bg-green-500/20 text-green-400" :
                      p.status === "pending" ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-gray-500/20 text-gray-400"
                    }`}>
                      {p.status}
                    </span>
                    <span className="text-white">{p.coins}c</span>
                    <span className="text-gray-500">${(p.amount_cents / 100).toFixed(2)}</span>
                  </div>
                  <span className="text-gray-600 text-xs">
                    {new Date(p.created_at).toLocaleDateString()} {new Date(p.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="glass-card">
          <h3 className="text-lg font-semibold text-white mb-4">How It Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-400">
            <div>
              <div className="text-blue-400 font-semibold mb-1">1. Select Package</div>
              <p>Choose a coin tier above</p>
            </div>
            <div>
              <div className="text-green-400 font-semibold mb-1">2. Pay on Ko-fi</div>
              <p>You&apos;ll be redirected to Ko-fi to pay securely with card or PayPal</p>
            </div>
            <div>
              <div className="text-purple-400 font-semibold mb-1">3. Coins Credited</div>
              <p>Payment is verified automatically and coins appear in your wallet</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
