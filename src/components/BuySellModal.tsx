"use client";

import { useState } from "react";
import { formatCoins, formatCoinsRaw } from "@/lib/format";
import ButtonSpinner from "./ButtonSpinner";

interface BuySellModalProps {
  company: {
    id: number;
    name: string;
    ticker: string;
    share_price: number;
  };
  mode: "buy" | "sell";
  userBalance: number;
  sharesOwned: number;
  isAdmin?: boolean;
  onExecute: (companyId: number, shares: number) => Promise<any>;
  onClose: () => void;
}

export default function BuySellModal({ company, mode, userBalance, sharesOwned, isAdmin, onExecute, onClose }: BuySellModalProps) {
  const [shares, setShares] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const totalCost = company.share_price * shares;
  const totalInC = formatCoins(totalCost);
  const taxAmount = mode === "sell" ? Math.round(totalCost * 0.03) : 0;
  const netRevenue = mode === "sell" ? totalCost - taxAmount : totalCost;
  const netRevenueC = formatCoins(netRevenue);
  const taxC = formatCoins(taxAmount);

  const canAfford = mode === "sell" || isAdmin || userBalance >= totalCost;
  const hasShares = mode === "buy" || sharesOwned >= shares;

  async function handleSubmit() {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const result = await onExecute(company.id, shares);
      if (result?.pendingShares > 0) {
        setSuccess(`Order placed! ${result.filledShares || 0} shares bought, ${result.pendingShares} shares pending (waiting for sellers).`);
      } else if (result?.message) {
        setSuccess(result.message);
      } else if (mode === "buy") {
        setSuccess(`Bought ${shares} share${shares > 1 ? "s" : ""} successfully!`);
      } else {
        setSuccess(`Listed ${shares} share${shares > 1 ? "s" : ""} for sale!`);
      }
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      setError(err.message || "Transaction failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card mt-3 overflow-hidden transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-lg font-bold ${mode === "buy" ? "text-green-400" : "text-red-400"}`}>
          {mode === "buy" ? "Buy" : "Sell"} {company.ticker}
        </h2>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">
          &times;
        </button>
      </div>

      <div className="mb-4">
        <p className="text-sm text-gray-400 mb-2">Number of shares (whole shares only):</p>
        <input
          type="number"
          min="1"
          value={shares}
          onChange={(e) => {
            const val = parseInt(e.target.value);
            if (val > 0) setShares(val);
          }}
          className="input-field text-center text-2xl font-bold"
        />
      </div>

      <div className="space-y-2 mb-4 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-400">Price per share:</span>
          <span className="text-white">{formatCoins(company.share_price)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold">
          <span className="text-gray-400">Gross {mode === "buy" ? "cost" : "revenue"}:</span>
          <span className="text-white">
            {isAdmin && mode === "buy" ? "FREE" : totalInC}
          </span>
        </div>
        {mode === "sell" && (
          <>
            <div className="flex justify-between text-xs">
              <span className="text-yellow-400">Sell tax (3%):</span>
              <span className="text-yellow-400">-{taxC}</span>
            </div>
            <div className="flex justify-between text-lg font-bold border-t border-gray-700 pt-2">
              <span className="text-gray-400">You receive:</span>
              <span className="text-green-400">{netRevenueC}</span>
            </div>
          </>
        )}
        {mode === "buy" && (
          <div className="flex justify-between text-lg font-bold">
            <span className="text-gray-400">Total cost:</span>
            <span className="text-red-400">
              {isAdmin ? "FREE" : totalInC}
            </span>
          </div>
        )}
        {mode === "buy" && !isAdmin && (
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Your balance:</span>
            <span className="text-gray-400">{formatCoins(userBalance)}</span>
          </div>
        )}
        {mode === "buy" && isAdmin && (
          <div className="flex justify-between text-xs">
            <span className="text-yellow-500">Admin mode:</span>
            <span className="text-yellow-400">Unlimited funds</span>
          </div>
        )}
        {mode === "sell" && (
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Shares you own:</span>
            <span className="text-gray-400">{sharesOwned}</span>
          </div>
        )}
      </div>

      {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
      {success && <p className="text-green-400 text-sm mb-4">{success}</p>}

      <button
        onClick={handleSubmit}
        disabled={loading || !canAfford || !hasShares}
        className={mode === "buy" ? "btn-success w-full flex items-center justify-center gap-2" : "btn-danger w-full flex items-center justify-center gap-2"}
      >
        {loading ? (
          <><ButtonSpinner size={16} /> Processing...</>
        ) : !hasShares
        ? "Not enough shares"
        : !canAfford
        ? "Insufficient balance"
        : `${mode === "buy" ? "Buy" : "Sell"} ${shares} share${shares > 1 ? "s" : ""}`}
      </button>
    </div>
  );
}
