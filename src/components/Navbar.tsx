"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";
import { formatCoins } from "@/lib/format";

export default function Navbar() {
  const { data: session, status } = useSession();
  const [loggingOut, setLoggingOut] = useState(false);

  function handleLogout() {
    setLoggingOut(true);
    document.body.classList.add("animate-logout-slide");
    setTimeout(() => {
      signOut({ redirect: false }).then(() => {
        window.location.href = "/login";
      });
    }, 350);
  }

  return (
    <nav className="glass sticky top-0 z-50 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/dashboard" className="text-2xl font-bold gradient-text">
          StockSim
        </Link>

        {session ? (
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-gray-300 hover:text-white transition-colors">
              Markets
            </Link>
            <Link href="/portfolio" className="text-gray-300 hover:text-white transition-colors">
              Portfolio
            </Link>
            <Link href="/wallet" className="text-gray-300 hover:text-white transition-colors">
              Wallet
            </Link>
            {(session.user as any)?.isAdmin && (
              <Link href="/admin" className="text-yellow-400 hover:text-yellow-300 transition-colors font-medium">
                Admin Panel
              </Link>
            )}
            <div className="flex items-center gap-3 pl-3 border-l border-gray-700">
              <span className="text-sm text-gray-400">{(session.user as any)?.username}</span>
              <span className="text-green-400 font-semibold">
                {(session.user as any)?.isAdmin ? "Unlimited" : formatCoins((session.user as any)?.balance || 0)}
              </span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="text-gray-400 hover:text-red-400 transition-colors text-sm disabled:opacity-50"
              >
                Logout
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-gray-300 hover:text-white transition-colors">
              Login
            </Link>
            <Link href="/register" className="btn-primary">
              Sign Up
            </Link>
          </div>
        )}
      </div>
    </nav>
  );
}
