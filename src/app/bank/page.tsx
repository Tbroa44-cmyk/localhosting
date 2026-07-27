"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import Navbar from "@/components/Navbar";
import PageBackground from "@/components/PageBackground";
import ButtonSpinner from "@/components/ButtonSpinner";
import { formatCoins } from "@/lib/format";
import { showToast } from "@/components/Toast";

interface BankInvestment {
  company_id: number;
  name: string;
  ticker: string;
  weight: number;
  entry_price: number;
  current_price: number;
  bank_share: number;
  profit: number;
  current_value: number;
  profit_pct: string;
}

interface BankStatus {
  balance: number;
  totalInvestmentValue: number;
  totalValue: number;
  investments: BankInvestment[];
  lastBalanceUpdate: string;
  lastCompanyPick: string;
  needsUpdate: boolean;
  needsRotation: boolean;
  canOperate: boolean;
}

export default function BankPage() {
  const { data: session, status } = useSession();
  const [bankData, setBankData] = useState<BankStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [depositing, setDepositing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [investing, setInvesting] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  const fetchBank = useCallback(async () => {
    try {
      const res = await fetch(`/api/bank/status?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setBankData(data);
      }
    } catch {}
  }, []);

  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch(`/api/portfolio?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setWalletBalance(data.user?.balance || 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    Promise.all([fetchBank(), fetchWallet()]).then(() => setLoading(false));
    const interval = setInterval(() => { fetchBank(); fetchWallet(); }, 15000);
    return () => clearInterval(interval);
  }, [status, fetchBank, fetchWallet]);

  async function handleDeposit() {
    const cents = Math.round(parseFloat(depositAmount) * 100);
    if (!cents || cents <= 0) return;
    setDepositing(true);
    try {
      const res = await fetch("/api/bank/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: cents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.message, "success");
      setDepositAmount("");
      if (data.walletBalance !== undefined) setWalletBalance(data.walletBalance);
      if (data.bankBalance !== undefined && bankData) setBankData({ ...bankData, balance: data.bankBalance });
      fetchBank();
      fetchWallet();
    } catch (err: any) {
      showToast(err.message || "Deposit failed", "error");
    } finally {
      setDepositing(false);
    }
  }

  async function handleWithdraw() {
    const cents = Math.round(parseFloat(withdrawAmount) * 100);
    if (!cents || cents <= 0) return;
    setWithdrawing(true);
    try {
      const res = await fetch("/api/bank/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: cents }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.message, "success");
      setWithdrawAmount("");
      if (data.walletBalance !== undefined) setWalletBalance(data.walletBalance);
      if (data.bankBalance !== undefined && bankData) setBankData({ ...bankData, balance: data.bankBalance });
      fetchBank();
      fetchWallet();
    } catch (err: any) {
      showToast(err.message || "Withdrawal failed", "error");
    } finally {
      setWithdrawing(false);
    }
  }

  async function handleInvest() {
    setInvesting(true);
    try {
      const res = await fetch("/api/bank/invest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.message || "Investments updated", "success");
      fetchBank();
    } catch (err: any) {
      showToast(err.message || "Investment failed", "error");
    } finally {
      setInvesting(false);
    }
  }

  const totalProfit = bankData ? bankData.totalValue - bankData.balance - bankData.totalInvestmentValue : 0;
  const totalProfitPct = bankData && bankData.balance > 0 ? ((bankData.totalValue - bankData.balance) / bankData.balance * 100).toFixed(2) : "0.00";

  return (
    <div className="min-h-screen">
      <PageBackground />
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-6 md:py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">Bank</h1>
        <p className="text-gray-400 text-sm mb-6">Deposit money into your bank and let it auto-invest in the best performing companies.</p>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="glass-card">
                <div className="h-20 bg-gray-800/50 rounded-lg animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="glass-card">
                <div className="text-xs text-gray-400 mb-1">Wallet Balance</div>
                <div className="text-xl font-bold text-green-400">{formatCoins(walletBalance)}</div>
              </div>
              <div className="glass-card">
                <div className="text-xs text-gray-400 mb-1">Bank Balance</div>
                <div className="text-xl font-bold text-blue-400">{formatCoins(bankData?.balance || 0)}</div>
                {bankData && !bankData.canOperate && bankData.balance > 0 && (
                  <div className="text-xs text-yellow-400 mt-1">Minimum 50c to invest</div>
                )}
              </div>
              <div className="glass-card">
                <div className="text-xs text-gray-400 mb-1">Total Value</div>
                <div className={`text-xl font-bold ${(bankData?.totalValue || 0) >= (bankData?.balance || 0) ? "text-green-400" : "text-red-400"}`}>
                  {formatCoins(bankData?.totalValue || 0)}
                </div>
                {bankData && bankData.balance > 0 && (
                  <div className={`text-xs mt-1 ${totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {totalProfit >= 0 ? "+" : ""}{formatCoins(totalProfit)} ({totalProfitPct}%)
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card">
              <h3 className="text-lg font-semibold text-white mb-4">Transfer Funds</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Deposit to Bank</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0.50"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      placeholder="Amount in c"
                      className="input-field flex-1"
                    />
                    <button
                      onClick={handleDeposit}
                      disabled={depositing || !depositAmount}
                      className="btn-success flex items-center gap-2"
                    >
                      {depositing ? <><ButtonSpinner size={14} /> ...</> : "Deposit"}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Withdraw from Bank</label>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      placeholder="Amount in c"
                      className="input-field flex-1"
                    />
                    <button
                      onClick={handleWithdraw}
                      disabled={withdrawing || !withdrawAmount}
                      className="btn-danger flex items-center gap-2"
                    >
                      {withdrawing ? <><ButtonSpinner size={14} /> ...</> : "Withdraw"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="glass-card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">
                  Investments
                  {bankData?.investments && bankData.investments.length > 0 && (
                    <span className="text-sm font-normal text-gray-400 ml-2">({bankData.investments.length} companies)</span>
                  )}
                </h3>
                {bankData?.canOperate && bankData.investments && bankData.investments.length > 0 && !bankData.needsRotation && (
                  <span className="text-sm text-green-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                    {bankData.investments.length} companies actively investing in
                  </span>
                )}
                {bankData?.canOperate && bankData.investments && bankData.investments.length > 0 && bankData.needsRotation && (
                  <button
                    onClick={handleInvest}
                    disabled={investing}
                    className="btn-primary text-sm flex items-center gap-2"
                  >
                    {investing ? <><ButtonSpinner size={14} /> Improving...</> : "Re-pick Companies"}
                  </button>
                )}
                {bankData?.canOperate && (!bankData.investments || bankData.investments.length === 0) && (
                  <button
                    onClick={handleInvest}
                    disabled={investing}
                    className="btn-primary text-sm flex items-center gap-2"
                  >
                    {investing ? <><ButtonSpinner size={14} /> Picking...</> : "Pick Companies"}
                  </button>
                )}
              </div>

              {!bankData?.canOperate && (
                <div className="text-center py-8">
                  <div className="text-4xl mb-3">🏦</div>
                  <p className="text-gray-400 mb-2">Your bank needs at least <strong className="text-white">50c</strong> to start investing</p>
                  <p className="text-gray-500 text-sm">Deposit funds from your wallet above to get started</p>
                </div>
              )}

              {bankData?.canOperate && bankData.investments && bankData.investments.length > 0 && (
                <div className="space-y-3">
                  {bankData?.investments?.map((inv) => (
                    <div key={inv.company_id} className="flex items-center justify-between py-3 px-4 bg-gray-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center text-blue-400 font-bold text-xs">
                          {inv.ticker.slice(0, 3)}
                        </div>
                        <div>
                          <div className="text-white font-medium">{inv.ticker}</div>
                          <div className="text-xs text-gray-400">{inv.name}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-400">
                          Weight: {(inv.weight * 100).toFixed(1)}%
                        </div>
                        <div className={`text-sm font-medium ${inv.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {inv.profit >= 0 ? "+" : ""}{formatCoins(inv.profit)} ({inv.profit_pct}%)
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(bankData?.investments?.length || 0) > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-700/50">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-xs text-gray-400">Invested</div>
                      <div className="text-sm font-bold text-blue-400">{formatCoins(bankData?.totalInvestmentValue || 0)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Profit/Loss</div>
                      <div className={`text-sm font-bold ${totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {totalProfit >= 0 ? "+" : ""}{formatCoins(totalProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Companies</div>
                      <div className="text-sm font-bold text-white">{bankData?.investments?.length || 0}</div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400">Next Update</div>
                      <div className="text-sm font-bold text-gray-300">~1h</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="glass-card">
              <h3 className="text-sm font-semibold text-gray-400 mb-3">How the Bank works</h3>
              <div className="space-y-2 text-xs text-gray-500">
                <p>• Deposit money from your wallet into your bank account (min 50c to invest)</p>
                <p>• The bank automatically picks the best performing companies to invest in</p>
                <p>• Every hour, your bank balance updates based on how your invested companies are performing</p>
                <p>• Every 24 hours, underperforming companies are swapped out for better ones</p>
                <p>• You can withdraw your funds back to your wallet at any time</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
