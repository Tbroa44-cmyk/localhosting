"use client";

import { useMemo } from "react";

export default function MiniChart({ prices, height = 40 }: { prices: number[]; height?: number }) {
  const width = 300;

  const path = useMemo(() => {
    if (prices.length < 2) return "";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = height - ((p - min) / range) * height;
      return `${x},${y}`;
    });
    return `M ${points.join(" L ")}`;
  }, [prices, height]);

  const fillPath = useMemo(() => {
    if (prices.length < 2) return "";
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const points = prices.map((p, i) => {
      const x = (i / (prices.length - 1)) * width;
      const y = height - ((p - min) / range) * height;
      return `${x},${y}`;
    });
    return `M 0,${height} L ${points.join(" L ")} L ${width},${height} Z`;
  }, [prices, height]);

  const isUp = prices.length >= 2 && prices[prices.length - 1] >= prices[0];
  const color = isUp ? "#22c55e" : "#ef4444";
  const fillColor = isUp ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)";

  if (prices.length < 2) return null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none">
      <path d={fillPath} fill={fillColor} />
      <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
