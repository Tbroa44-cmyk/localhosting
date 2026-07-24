"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface TradeAnimationProps {
  type: "buy" | "sell" | "cancel" | null;
  onComplete: () => void;
}

export default function TradeAnimation({ type, onComplete }: TradeAnimationProps) {
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<"enter" | "show" | "exit">("enter");
  const [animType, setAnimType] = useState<"buy" | "sell" | "cancel">("buy");
  const [hasAnimated, setHasAnimated] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (!type) return;
    setAnimType(type);
    setVisible(true);
    setPhase("enter");
    setHasAnimated(false);

    timers.current.forEach(clearTimeout);
    timers.current = [];

    timers.current.push(setTimeout(() => {
      setPhase("show");
      setHasAnimated(true);
    }, 60));
    timers.current.push(setTimeout(() => setPhase("exit"), 1800));
    timers.current.push(setTimeout(() => {
      setVisible(false);
      setHasAnimated(false);
      onComplete();
    }, 2300));

    return () => { timers.current.forEach(clearTimeout); };
  }, [type]);

  if (!visible || !type) return null;

  const isBuy = animType === "buy";
  const isCancel = animType === "cancel";

  const content = (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 2147483647, pointerEvents: "none" }}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        style={{
          opacity: phase === "show" ? 1 : 0,
          transition: "opacity 0.3s ease-out",
        }}
      />

      <div
        className={`relative flex flex-col items-center gap-4 ${
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
            className={`absolute inset-0 rounded-full blur-3xl opacity-50 ${
              isCancel ? "bg-yellow-500" : isBuy ? "bg-green-500" : "bg-red-500"
            }`}
            style={{ transform: "scale(2.5)" }}
          />
          <svg
            width="120"
            height="120"
            viewBox="0 0 24 24"
            fill="none"
            className={`relative ${
              isCancel
                ? "text-yellow-400 drop-shadow-[0_0_20px_rgba(234,179,8,0.6)]"
                : isBuy
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
                    animation: hasAnimated ? "shackleLock 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards" : "none",
                    transformOrigin: "12px 11px",
                  }}
                />
                <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity="0.9"
                  style={{
                    animation: hasAnimated ? "bodyAppear 0.3s ease-out forwards" : "none",
                  }}
                />
                <circle cx="12" cy="16" r="1.5" fill="rgba(0,0,0,0.6)" />
              </g>
            ) : isCancel ? (
              <g style={{ animation: hasAnimated ? "shatter 0.6s ease-out forwards" : "none" }}>
                <path
                  d="M7 11V7a5 5 0 0110 0v4"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  fill="none"
                  style={{ animation: hasAnimated ? "shatterTop 0.5s ease-out 0.1s forwards" : "none" }}
                />
                <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6"
                  style={{ animation: hasAnimated ? "shatterBottom 0.5s ease-out 0.1s forwards" : "none" }}
                />
                <circle cx="12" cy="16" r="1.5" fill="currentColor" opacity="0.8" />
                <line x1="8" y1="14" x2="10" y2="17" stroke="currentColor" strokeWidth="1.5" opacity="0.5"
                  style={{ animation: hasAnimated ? "shatterShard1 0.5s ease-out 0.15s forwards" : "none" }}
                />
                <line x1="16" y1="14" x2="14" y2="17" stroke="currentColor" strokeWidth="1.5" opacity="0.5"
                  style={{ animation: hasAnimated ? "shatterShard2 0.5s ease-out 0.15s forwards" : "none" }}
                />
                <line x1="12" y1="13" x2="12" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.3"
                  style={{ animation: hasAnimated ? "shatterShard3 0.4s ease-out 0.2s forwards" : "none" }}
                />
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
                    animation: hasAnimated ? "shackleUnlock 0.6s cubic-bezier(0.22,1,0.36,1) 0.15s forwards" : "none",
                    transformOrigin: "7px 11px",
                  }}
                />
                <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.6"
                  style={{
                    animation: hasAnimated ? "bodyAppear 0.3s ease-out forwards" : "none",
                  }}
                />
                <circle cx="12" cy="16" r="1.5" fill="currentColor" opacity="0.8" />
              </g>
            )}
          </svg>
        </div>

        <div
          className={`text-xl font-bold tracking-wide ${
            isCancel ? "text-yellow-400" : isBuy ? "text-green-400" : "text-red-400"
          }`}
          style={{
            textShadow: isCancel
              ? "0 0 20px rgba(234,179,8,0.5)"
              : isBuy
              ? "0 0 20px rgba(34,197,94,0.5)"
              : "0 0 20px rgba(239,68,68,0.5)",
            animation: hasAnimated ? "textPulse 0.5s ease-out 0.1s both" : "none",
          }}
        >
          {isCancel ? "ORDER CANCELLED" : isBuy ? "ORDER LOCKED" : "SELL ORDER PLACED"}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(content, document.body);
}
