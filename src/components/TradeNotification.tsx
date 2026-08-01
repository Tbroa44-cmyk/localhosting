"use client";

import { useEffect, useState, useCallback } from "react";
import { formatCoins } from "@/lib/format";
import { playOrderConfirmed } from "@/lib/sounds";

export interface TradeNotificationData {
  id: number;
  stockName: string;
  ticker: string;
  action: "buy" | "sell";
  shares: number;
  price: number;
  totalGained?: number;
  listed?: boolean;
}

let notifId = 0;
let notifListeners: ((msg: TradeNotificationData) => void)[] = [];

export function showTradeNotification(data: Omit<TradeNotificationData, "id">) {
  const msg = { ...data, id: ++notifId };
  notifListeners.forEach((l) => l(msg));
  playOrderConfirmed();
}

export default function TradeNotificationContainer() {
  const [notifications, setNotifications] = useState<TradeNotificationData[]>([]);

  useEffect(() => {
    const handler = (msg: TradeNotificationData) => {
      setNotifications((prev) => [...prev.slice(-4), msg]);
      setTimeout(() => {
        setNotifications((prev) => prev.filter((n) => n.id !== msg.id));
      }, 5000);
    };
    notifListeners.push(handler);
    return () => { notifListeners = notifListeners.filter((l) => l !== handler); };
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-[9998] flex flex-col gap-3 pointer-events-none w-72">
      {notifications.map((n, idx) => (
        <div
          key={n.id}
          className="pointer-events-auto"
          style={{ animation: `notifSlideIn 0.4s cubic-bezier(0.22,1,0.36,1) ${idx * 0.08}s both` }}
        >
          <div className={`relative overflow-hidden rounded-xl border backdrop-blur-md shadow-2xl ${
            n.action === "buy"
              ? "bg-green-950/80 border-green-500/30"
              : "bg-red-950/80 border-red-500/30"
          }`}>
            <div className={`absolute inset-0 opacity-10 ${
              n.action === "buy"
                ? "bg-gradient-to-br from-green-400 via-transparent to-transparent"
                : "bg-gradient-to-br from-red-400 via-transparent to-transparent"
            }`} />
            <div className="relative p-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    n.action === "buy" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                  }`}>
                    {n.action === "buy" ? "BUY" : "SELL"}
                  </span>
                  <span className="font-bold text-white text-sm">{n.ticker}</span>
                </div>
                <span className="text-[10px] text-gray-500">just now</span>
              </div>
              <div className="text-xs text-gray-300 mb-1.5">
                <span className="font-semibold text-white">{n.shares}</span>
                {n.shares === 1 ? " share" : " shares"}{" "}
                {n.listed
                  ? `listed on market for `
                  : n.action === "buy"
                  ? "bought at "
                  : "sold at "}
                <span className="font-semibold text-white">{formatCoins(n.price * n.shares)}</span>
              </div>
              {n.totalGained !== undefined && n.totalGained !== 0 && (
                <div className={`text-xs font-bold ${
                  n.totalGained >= 0 ? "text-green-400" : "text-red-400"
                }`}>
                  {n.totalGained >= 0 ? "+" : ""}{formatCoins(n.totalGained)}
                </div>
              )}
            </div>
            <div
              className={`absolute bottom-0 left-0 h-[2px] ${
                n.action === "buy" ? "bg-green-400" : "bg-red-400"
              }`}
              style={{ animation: "notifCountdown 5s linear forwards" }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
