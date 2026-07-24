"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

    timers.current.push(setTimeout(() => setPhase("show"), 60));
    timers.current.push(setTimeout(() => setPhase("exit"), 1800));
    timers.current.push(setTimeout(() => {
      setVisible(false);
      onComplete();
    }, 2300));

    return () => { timers.current.forEach(clearTimeout); };
  }, [type]);

  if (!visible || !type) return null;

  const isBuy = animType === "buy";

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-none"
      style={{ zIndex: 2147483647 }}
    >
      <div
        className={`flex flex-col items-center gap-4 ${
          phase === "enter"
            ? "opacity-0 scale-75"
            : phase === "exit"
            ? "opacity-0 scale-110"
            : "opacity-100 scale-100"
        }`}
        style={{ transition: phase === "enter" ? "all 0.35s cubic-bezier(0.22,1,0.36,1)" : "all 0.4s cubic-bezier(0.22,1,0.36,1)" }}
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
          >
            {isBuy ? (
              <g>
                <path
                  d="M7 11V7a5 5 0 0110 0v4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                  style={{
                    animation: phase === "show" ? "shackleLock 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards" : "none",
                    transformOrigin: "12px 11px",
                  }}
                />
                <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity="0.9"
                  style={{
                    animation: phase === "show" ? "bodyAppear 0.3s ease-out forwards" : "none",
                  }}
                />
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
                    animation: phase === "show" ? "shackleUnlock 0.6s cubic-bezier(0.22,1,0.36,1) 0.15s forwards" : "none",
                    transformOrigin: "7px 11px",
                  }}
                />
                <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6"
                  style={{
                    animation: phase === "show" ? "bodyAppear 0.3s ease-out forwards" : "none",
                  }}
                />
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

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
