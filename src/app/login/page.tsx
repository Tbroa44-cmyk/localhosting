"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, useSession } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session) router.push("/dashboard");
  }, [session, router]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("guest");
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const result = await signIn("credentials", {
      redirect: false,
      email,
      password,
    });

    if (result?.error) {
      setError("Invalid email or password");
      setLoading(false);
    } else {
      localStorage.removeItem("guest");
      router.push("/dashboard");
    }
  }

  function handleGuest() {
    localStorage.setItem("guest", "true");
    window.location.href = "/dashboard";
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="glass-card max-w-md w-full animate-login-reveal">
        <h1 className="text-3xl font-bold text-center mb-2 gradient-text">Welcome Back</h1>
        <p className="text-gray-400 text-center mb-8">Sign in to trade</p>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              required
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pr-12"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-sm select-none"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full py-3">
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-gray-900 px-3 text-gray-500">or</span>
          </div>
        </div>

        <button
          onClick={handleGuest}
          className="w-full py-3 rounded-lg border border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 hover:bg-white/5 transition-all font-medium"
        >
          Continue as Guest
        </button>

        <p className="text-center text-gray-400 text-sm mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-blue-400 hover:text-blue-300">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
