"use client";

import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-2xl">
        <h1 className="text-6xl font-bold mb-6 gradient-text">StockSim</h1>
        <p className="text-xl text-gray-400 mb-8">
          Buy and sell virtual company shares. Watch prices move with every trade.
          Build your portfolio and become the top trader.
        </p>
        <div className="flex gap-4 justify-center">
          <Link href="/register" className="btn-primary text-lg px-8 py-3">
            Get Started
          </Link>
          <Link href="/login" className="text-lg px-8 py-3 border border-gray-600 rounded-lg text-gray-300 hover:text-white hover:border-gray-400 transition-colors">
            Sign In
          </Link>
        </div>
        <div className="mt-16 grid grid-cols-3 gap-8 text-center">
          <div className="glass-card">
            <div className="text-3xl mb-2">10+</div>
            <div className="text-sm text-gray-400">Companies to trade</div>
          </div>
          <div className="glass-card">
            <div className="text-3xl mb-2 gradient-text">Live</div>
            <div className="text-sm text-gray-400">Real-time prices</div>
          </div>
          <div className="glass-card">
            <div className="text-3xl mb-2">$1</div>
            <div className="text-sm text-gray-400">= 100c coins</div>
          </div>
        </div>
      </div>
    </div>
  );
}
