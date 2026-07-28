"use client";

import { useEffect, useState, useRef } from "react";

interface BanModalProps {
  open: boolean;
  username: string;
  onConfirm: (days: number) => void;
  onCancel: () => void;
}

export default function BanModal({ open, username, onConfirm, onCancel }: BanModalProps) {
  const [days, setDays] = useState(0);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDays(0);
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      style={{ animation: "overlayFadeIn 0.2s ease-out" }}
      onClick={(e) => { if (e.target === backdropRef.current) onCancel(); }}
    >
      <div
        className="glass-card max-w-sm w-full mx-4"
        style={{ animation: "modalPop 0.25s cubic-bezier(0.22,1,0.36,1) both" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-white mb-2">Ban User</h3>
        <p className="text-gray-400 text-sm mb-4">
          Ban <span className="text-white font-medium">{username}</span> for how many days?
        </p>

        <div className="flex flex-wrap gap-2 mb-6">
          {[
            { label: "Indefinite", value: 0 },
            { label: "1 day", value: 1 },
            { label: "3 days", value: 3 },
            { label: "7 days", value: 7 },
            { label: "14 days", value: 14 },
            { label: "30 days", value: 30 },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                days === opt.value
                  ? "bg-red-600/30 border-red-500/50 text-red-300"
                  : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(days)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 hover:bg-red-500 text-white transition-colors"
          >
            {days === 0 ? "Ban Indefinitely" : `Ban for ${days} day${days > 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
