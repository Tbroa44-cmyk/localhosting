"use client";

import { useEffect, useState } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

let toastId = 0;
let listeners: ((msg: ToastMessage) => void)[] = [];

export function showToast(text: string, type: "success" | "error" | "info" = "info") {
  const msg = { id: ++toastId, text, type };
  listeners.forEach((l) => l(msg));
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    const handler = (msg: ToastMessage) => {
      setToasts((prev) => [...prev.slice(-4), msg]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== msg.id));
      }, 3000);
    };
    listeners.push(handler);
    return () => { listeners = listeners.filter((l) => l !== handler); };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9997] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-lg text-sm font-medium shadow-lg backdrop-blur-sm animate-fade-up pointer-events-auto ${
            t.type === "success" ? "bg-green-600/90 text-white" :
            t.type === "error" ? "bg-red-600/90 text-white" :
            "bg-gray-700/90 text-white"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
