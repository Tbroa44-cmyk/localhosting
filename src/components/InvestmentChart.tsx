"use client";

import { useState, useMemo } from "react";
import { Line } from "react-chartjs-2";
import { formatCoins } from "@/lib/format";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface Trade {
  type: string;
  shares: number;
  price_per_share: number;
  created_at: string;
  status: string;
}

interface PricePoint {
  price: number;
  timestamp: number;
}

export default function InvestmentChart({ trades, priceHistory, currentPrice }: { trades: Trade[]; priceHistory: PricePoint[]; currentPrice: number }) {
  const confirmedTrades = useMemo(() =>
    trades.filter(t => t.status === "confirmed").sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [trades]
  );

  const investment = useMemo(() => {
    let shares = 0;
    let totalCost = 0;
    const points: { date: string; value: number; avgCost: number }[] = [];
    const markers: { date: string; type: string; shares: number; price: number; value: number }[] = [];

    for (const trade of confirmedTrades) {
      const date = new Date(trade.created_at);
      const dateStr = date.toLocaleDateString();

      if (String(trade.type).includes("buy")) {
        shares += trade.shares;
        totalCost += trade.shares * trade.price_per_share;
      } else {
        const avgCost = shares > 0 ? totalCost / shares : 0;
        const sellValue = trade.shares * trade.price_per_share;
        shares -= trade.shares;
        totalCost -= trade.shares * avgCost;
        if (totalCost < 0) totalCost = 0;
      }

      const avgCost = shares > 0 ? totalCost / shares : 0;
      const marketValue = shares * currentPrice;

      points.push({ date: dateStr, value: marketValue, avgCost });
      markers.push({ date: dateStr, type: String(trade.type), shares: trade.shares, price: trade.price_per_share, value: marketValue });
    }

    return { points, markers, finalShares: shares, totalCost, avgCost: shares > 0 ? totalCost / shares : 0 };
  }, [confirmedTrades, currentPrice]);

  if (confirmedTrades.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-50">
          <path d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
        <p className="text-sm">No trades yet for this stock</p>
      </div>
    );
  }

  const labels = investment.points.map((_, i) => {
    const trade = confirmedTrades[i];
    if (!trade) return "";
    const d = new Date(trade.created_at);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });

  const valueData = investment.points.map(p => p.value);
  const avgCostData = investment.points.map(p => p.avgCost * investment.finalShares);
  const buyPoints = investment.markers.map((m, i) => String(m.type).includes("buy") ? valueData[i] : null);
  const sellPoints = investment.markers.map((m, i) => !String(m.type).includes("buy") ? valueData[i] : null);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Portfolio Value",
        data: valueData,
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.1)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: "#3b82f6",
        borderWidth: 2,
      },
      {
        label: "Cost Basis",
        data: avgCostData,
        borderColor: "#6b7280",
        borderDash: [5, 5],
        pointRadius: 0,
        borderWidth: 1,
        fill: false,
      },
      {
        label: "Buys",
        data: buyPoints,
        borderColor: "#22c55e",
        backgroundColor: "#22c55e",
        pointRadius: 8,
        pointStyle: "triangle" as const,
        showLine: false,
      },
      {
        label: "Sells",
        data: sellPoints,
        borderColor: "#ef4444",
        backgroundColor: "#ef4444",
        pointRadius: 8,
        pointStyle: "rectRot" as const,
        showLine: false,
      },
    ],
  };

  const profit = investment.finalShares > 0 ? (currentPrice - investment.avgCost) * investment.finalShares : 0;
  const profitPercent = investment.avgCost > 0 ? ((currentPrice - investment.avgCost) / investment.avgCost) * 100 : 0;

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        <div>
          <span className="text-gray-400">Shares: </span>
          <span className="text-white font-medium">{investment.finalShares}</span>
        </div>
        <div>
          <span className="text-gray-400">Avg Cost: </span>
          <span className="text-white font-medium">{formatCoins(investment.avgCost)}</span>
        </div>
        <div>
          <span className="text-gray-400">Current: </span>
          <span className="text-white font-medium">{formatCoins(currentPrice)}</span>
        </div>
        <div>
          <span className="text-gray-400">P&L: </span>
          <span className={`font-medium ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
            {profit >= 0 ? "+" : ""}{formatCoins(profit)} ({profit >= 0 ? "+" : ""}{profitPercent.toFixed(1)}%)
          </span>
        </div>
      </div>

      <div className="h-48 sm:h-64">
        <Line
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: {
                display: true,
                labels: { color: "#9ca3af", font: { size: 11 }, boxWidth: 12 },
              },
              tooltip: {
                backgroundColor: "#1f2937",
                titleColor: "#f3f4f6",
                bodyColor: "#d1d5db",
                borderColor: "#374151",
                borderWidth: 1,
                callbacks: {
                  label: (ctx) => {
                    if (ctx.dataset.label === "Buys" && ctx.raw !== null) return `BUY @ ${formatCoins(confirmedTrades[ctx.dataIndex]?.price_per_share || 0)}`;
                    if (ctx.dataset.label === "Sells" && ctx.raw !== null) return `SELL @ ${formatCoins(confirmedTrades[ctx.dataIndex]?.price_per_share || 0)}`;
                    return `${ctx.dataset.label}: ${formatCoins(ctx.raw as number)}`;
                  },
                },
              },
            },
            scales: {
              x: { grid: { color: "rgba(75,85,99,0.3)" }, ticks: { color: "#6b7280", font: { size: 10 } } },
              y: { grid: { color: "rgba(75,85,99,0.3)" }, ticks: { color: "#6b7280", font: { size: 10 }, callback: (v) => formatCoins(v as number) } },
            },
          }}
        />
      </div>
    </div>
  );
}
