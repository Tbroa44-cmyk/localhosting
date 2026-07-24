"use client";

import { useEffect, useRef } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ open, title, message, confirmText = "Confirm", cancelText = "Cancel", danger = false, onConfirm, onCancel }: ConfirmModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
        <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
        <p className="text-gray-400 text-sm mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              danger
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
