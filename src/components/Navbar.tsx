"use client";

import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { formatCoins } from "@/lib/format";

export default function Navbar() {
  const { data: session, status } = useSession();
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    setIsGuest(localStorage.getItem("guest") === "true");
  }, []);

  const isLoggedIn = isGuest || !!session;

  return (
    <nav className="glass sticky top-0 z-50 px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/dashboard" className="text-2xl font-bold gradient-text">
          StockSim
        </Link>

        {isLoggedIn ? (
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-gray-300 hover:text-white transition-colors">
              Markets
            </Link>
            {session && (
              <>
                <Link href="/portfolio" className="text-gray-300 hover:text-white transition-colors">
                  Portfolio
                </Link>
                <Link href="/wallet" className="text-gray-300 hover:text-white transition-colors">
                  Wallet
                </Link>
              </>
            )}
            {session && (session.user as any)?.isAdmin && (
              <Link href="/admin" className="text-yellow-400 hover:text-yellow-300 transition-colors font-medium">
                Admin Panel
              </Link>
            )}
            <div className="flex items-center gap-3 pl-3 border-l border-gray-700">
              {isGuest && !session ? (
                <>
                  <span className="text-sm text-gray-400 bg-gray-800 px-3 py-1 rounded-full">Guest</span>
                  <Link href="/login" className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium">
                    Login
                  </Link>
                  <Link href="/register" className="btn-primary text-sm py-1 px-3">
                    Sign Up
                  </Link>
                </>
              ) : session ? (
                <>
                  <span className="text-sm text-gray-400">{(session.user as any)?.username}</span>
                  <span className="text-green-400 font-semibold">
                    {(session.user as any)?.isAdmin ? "Unlimited" : formatCoins((session.user as any)?.balance || 0)}
                  </span>
                  <button
                    onClick={() => {
                      localStorage.removeItem("guest");
                      signOut({ redirect: false }).then(() => {
                        window.location.href = "/login";
                      });
                    }}
                    className="text-gray-400 hover:text-red-400 transition-colors text-sm"
                  >
                    Logout
                  </button>
                </>
              ) : null}
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
