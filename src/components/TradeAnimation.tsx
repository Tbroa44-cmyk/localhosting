"use client";

import { useEffect, useRef, useState } from "react";

interface TradeAnimationProps {
  type: "buy" | "sell" | null;
  onComplete: () => void;
}

export default function TradeAnimation({ type, onComplete }: TradeAnimationProps) {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  const [animType, setAnimType] = useState<"buy" | "sell">("buy");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!type) return;
    setAnimType(type);
    setVisible(true);
    setPhase("enter");

    timers.current.forEach(clearTimeout);
    timers.current = [];

    timers.current.push(setTimeout(() => setPhase("show"), 50));
    timers.current.push(setTimeout(() => setPhase("exit"), 1600));
    timers.current.push(setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 2100));

    return () => { timers.current.forEach(clearTimeout); };
  }, [type]);

  if (!visible || !type) return null;

  const isBuy = animType === "buy";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center pointer-events-none"
    >
      <div
        className={`flex flex-col items-center gap-4 ${
          phase === "enter"
            ? "opacity-0 scale-75"
            : phase === "exit"
            ? "opacity-0 scale-110"
            : "opacity-100 scale-100"
        }`}
        style={{ transition: phase === "enter" ? "all 0.3s cubic-bezier(0.22,1,0.36,1)" : "all 0.4s cubic-bezier(0.22,1,0.36,1)" }}
      >
        <div className="relative">
          <div
            className={`absolute inset-0 rounded-full blur-3xl opacity-40 ${
              isBuy ? "bg-green-500" : "bg-red-500"
            }`}
            style={{ transform: "scale(2.5)" }}
          />
          <svg
            width="120"
            height="120"
            viewBox="0 0 24 24"
            fill="none"
            className={`relative ${
              isBuy
                ? "text-green-400 drop-shadow-[0_0_20px_rgba(34,197,94,0.6)]"
                : "text-red-400 drop-shadow-[0_0_20px_rgba(239,68,68,0.6)]"
            }`}
            style={{
              animation: phase === "show" ? (isBuy ? "lockBounce 0.6s ease-out forwards" : "unlockSwing 0.8s ease-out forwards") : "none",
            }}
          >
            {isBuy ? (
              <g>
                <path
                  d="M7 11V7a5 5 0 0110 0v4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  style={{
                    animation: phase === "show" ? "shackleLift 0.6s ease-out 0.2s both" : "none",
                    transformOrigin: "12px 11px",
                  }}
                />
                <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity="0.9" />
                <circle cx="12" cy="16" r="1.5" fill="rgba(0,0,0,0.6)" />
              </g>
            ) : (
              <g>
                <path
                  d="M7 11V7a5 5 0 0110 0v4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                  style={{
                    animation: phase === "show" ? "shackleSwing 0.8s ease-out 0.1s both" : "none",
                    transformOrigin: "12px 11px",
                  }}
                />
                <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6" />
                <circle cx="12" cy="16" r="1.5" fill="currentColor" opacity="0.8" />
              </g>
            )}
          </svg>
        </div>

        <div
          className={`text-xl font-bold tracking-wide ${
            isBuy ? "text-green-400" : "text-red-400"
          }`}
          style={{
            textShadow: isBuy
              ? "0 0 20px rgba(34,197,94,0.5)"
              : "0 0 20px rgba(239,68,68,0.5)",
            animation: phase === "show" ? "textPulse 0.5s ease-out 0.1s both" : "none",
          }}
        >
          {isBuy ? "ORDER LOCKED" : "SELL ORDER PLACED"}
        </div>
      </div>
    </div>
  );
}
