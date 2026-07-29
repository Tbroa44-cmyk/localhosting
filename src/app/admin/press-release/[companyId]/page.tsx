"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import LoadingSpinner from "@/components/LoadingSpinner";
import { showToast } from "@/components/Toast";

export default function PressReleasePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const companyId = params?.companyId as string;

  const [companyName, setCompanyName] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<"positive" | "negative">("positive");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
    if (status === "authenticated" && !(session?.user as any)?.isAdmin) router.push("/dashboard");
  }, [status, session, router]);

  useEffect(() => {
    if (!companyId) return;
    fetch(`/api/admin/companies?t=${Date.now()}`).then(r => r.json()).then(data => {
      if (Array.isArray(data.companies)) {
        const c = data.companies.find((c: any) => String(c.id) === companyId);
        if (c) setCompanyName(c.name);
      }
    }).catch(() => {});
  }, [companyId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) {
      showToast("Please write content for the press release", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/press-releases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: parseInt(companyId, 10), content, type }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.message || "Press release published!", "success");
      router.push("/admin");
    } catch (err: any) {
      showToast(err.message || "Failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <button onClick={() => router.push("/admin")} className="text-gray-400 hover:text-white text-sm transition-colors">&larr; Back to Admin Panel</button>
        </div>

        <div className="glass-card">
          <div className="border-b border-gray-800 pb-4 mb-4">
            <h1 className="text-xl font-bold text-white">Press Release</h1>
            {companyName && <p className="text-gray-400 text-sm mt-1">{companyName}</p>}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm block mb-2">Impact</label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setType("positive")}
                  className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-all ${
                    type === "positive"
                      ? "bg-green-600/20 border-green-500/50 text-green-400"
                      : "bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <span className="block text-lg mb-1">&#9650;</span>
                  Positive
                </button>
                <button
                  type="button"
                  onClick={() => setType("negative")}
                  className={`flex-1 py-3 px-4 rounded-lg border text-sm font-medium transition-all ${
                    type === "negative"
                      ? "bg-red-600/20 border-red-500/50 text-red-400"
                      : "bg-gray-800/50 border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  <span className="block text-lg mb-1">&#9660;</span>
                  Negative
                </button>
              </div>
            </div>

            <div>
              <label className="text-gray-400 text-sm block mb-2">Press Release Text</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="input-field w-full min-h-[200px] resize-y"
                placeholder="Write the press release content here..."
                required
              />
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.push("/admin")}
                className="flex-1 text-gray-400 hover:text-white border border-gray-700 py-2.5 rounded-lg transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                  type === "positive"
                    ? "bg-green-600 hover:bg-green-500 text-white"
                    : "bg-red-600 hover:bg-red-500 text-white"
                } disabled:opacity-50`}
              >
                {submitting ? "Publishing..." : `Publish ${type === "positive" ? "Positive" : "Negative"} Release`}
              </button>
            </div>

            <p className={`text-xs ${type === "positive" ? "text-green-500/70" : "text-red-500/70"} text-center`}>
              Price will {type === "positive" ? "increase" : "decrease"} by ~2% after publishing
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
