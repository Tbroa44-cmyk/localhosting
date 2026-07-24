"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { formatCoins } from "@/lib/format";
import Navbar from "@/components/Navbar";
import ConfirmModal from "@/components/ConfirmModal";
import { showToast } from "@/components/Toast";

interface User {
  id: number;
  username: string;
  email: string;
  balance: number;
  is_admin: number;
  created_at: string;
}

interface Company {
  id: number;
  name: string;
  ticker: string;
  description: string;
  share_price: number;
  total_shares: number;
  initial_price?: number;
  initial_shares?: number;
}

interface Stats {
  totalUsers: number;
  totalBalance: number;
  totalTransactions: number;
  bankFund: number;
}

interface TradingSettings {
  trading_enabled: number;
  trading_open_hour: number;
  trading_close_hour: number;
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalBalance: 0, totalTransactions: 0, bankFund: 0 });
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [newCompany, setNewCompany] = useState({ name: "", ticker: "", description: "", share_price: 10000, total_shares: 1000 });
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);

  const [tradingSettings, setTradingSettings] = useState<TradingSettings>({ trading_enabled: 1, trading_open_hour: 0, trading_close_hour: 24 });
  const [savingTrading, setSavingTrading] = useState(false);

  const [giveCoinsUserId, setGiveCoinsUserId] = useState<number | null>(null);
  const [giveCoinsAmount, setGiveCoinsAmount] = useState("");
  const [givingCoins, setGivingCoins] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMsg, setConfirmMsg] = useState("");
  const [confirmDanger, setConfirmDanger] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    fetchAdminData();
    fetchTradingSettings();
    const interval = setInterval(fetchAdminData, 10000);
    return () => clearInterval(interval);
  }, []);

  function fetchAdminData() {
    fetch("/api/admin/companies")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setUsers(data.users || []);
        setCompanies(data.companies || []);
        setStats(data.stats || { totalUsers: 0, totalBalance: 0, totalTransactions: 0, bankFund: 0 });
      })
      .catch(console.error);
  }

  function fetchTradingSettings() {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.trading_enabled !== undefined) {
          setTradingSettings(data);
        }
      })
      .catch(console.error);
  }

  function openConfirm(title: string, msg: string, danger: boolean, action: () => void) {
    setConfirmTitle(title);
    setConfirmMsg(msg);
    setConfirmDanger(danger);
    setConfirmAction(() => action);
    setConfirmOpen(true);
  }

  async function handleSaveTrading() {
    setSavingTrading(true);
    try {
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tradingSettings),
      });
      showToast("Trading settings saved!", "success");
    } catch {
      showToast("Failed to save settings", "error");
    } finally {
      setSavingTrading(false);
    }
  }

  async function handleGiveCoins(userId: number) {
    const amount = parseFloat(giveCoinsAmount);
    if (!amount || amount <= 0) return;
    setGivingCoins(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/give-coins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: Math.round(amount * 100) }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(`Gave ${amount}c to user`, "success");
        setGiveCoinsUserId(null);
        setGiveCoinsAmount("");
        fetchAdminData();
      } else {
        showToast(data.error || "Failed", "error");
      }
    } catch {
      showToast("Error giving coins", "error");
    } finally {
      setGivingCoins(false);
    }
  }

  async function handleCreateCompany(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/admin/companies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newCompany),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to create company", "error");
        return;
      }
      setShowNewForm(false);
      setNewCompany({ name: "", ticker: "", description: "", share_price: 10000, total_shares: 1000 });
      fetchAdminData();
    } catch {
      showToast("Error creating company", "error");
      fetchAdminData();
    }
  }

  async function handleUpdateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCompany) return;
    try {
      const res = await fetch(`/api/admin/companies/${editingCompany.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingCompany.name,
          description: editingCompany.description,
          share_price: editingCompany.share_price,
          total_shares: editingCompany.total_shares,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to update company", "error");
        return;
      }
      setEditingCompany(null);
      fetchAdminData();
    } catch {
      showToast("Error updating company", "error");
    }
  }

  async function handleDeleteCompany(id: number) {
    openConfirm("Delete Company", "Delete this company? This cannot be undone.", true, async () => {
      try {
        const res = await fetch(`/api/admin/companies/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || "Failed to delete company", "error");
          return;
        }
        fetchAdminData();
      } catch {
        showToast("Error deleting company", "error");
      }
    });
  }

  async function handleResetMarket() {
    openConfirm("Reset Market", "This will DELETE all user holdings and reset all company prices. This cannot be undone. Continue?", true, async () => {
      setResetting(true);
      try {
        const res = await fetch("/api/admin/reset", { method: "POST" });
        const data = await res.json();
        if (res.ok) {
          showToast("Market has been reset!", "success");
          fetchAdminData();
        } else {
          showToast(data.error || "Reset failed", "error");
        }
      } catch {
        showToast("Error resetting market", "error");
      } finally {
        setResetting(false);
      }
    });
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-400">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <Navbar />
      <ConfirmModal
        open={confirmOpen}
        title={confirmTitle}
        message={confirmMsg}
        danger={confirmDanger}
        confirmText={confirmDanger ? "Delete" : "Confirm"}
        onConfirm={() => { setConfirmOpen(false); confirmAction(); }}
        onCancel={() => setConfirmOpen(false)}
      />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-white mb-2">Admin Panel</h1>
        <p className="text-gray-400 mb-8">Manage companies, users, and the market</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="glass-card text-center">
            <div className="text-sm text-gray-400">Users</div>
            <div className="text-3xl font-bold text-white">{stats.totalUsers}</div>
          </div>
          <div className="glass-card text-center">
            <div className="text-sm text-gray-400">Coins in Circulation</div>
            <div className="text-3xl font-bold text-blue-400">{formatCoins(stats.totalBalance)}</div>
          </div>
          <div className="glass-card text-center">
            <div className="text-sm text-gray-400">Transactions</div>
            <div className="text-3xl font-bold text-green-400">{stats.totalTransactions}</div>
          </div>
          <div className="glass-card text-center border-yellow-500/30">
            <div className="text-sm text-gray-400">Bank Fund (3% Tax)</div>
            <div className="text-3xl font-bold text-yellow-400">{formatCoins(stats.bankFund)}</div>
          </div>
        </div>

        <div className="glass-card mb-8 border-purple-500/30">
          <h2 className="text-xl font-semibold text-white mb-4">Trading Hours</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Trading Status</label>
              <select
                value={tradingSettings.trading_enabled}
                onChange={(e) => setTradingSettings({ ...tradingSettings, trading_enabled: Number(e.target.value) })}
                className="input-field"
              >
                <option value={1}>Open</option>
                <option value={0}>Closed (Admin Lock)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Open Hour (0-23)</label>
              <input
                type="number"
                min="0"
                max="23"
                value={tradingSettings.trading_open_hour}
                onChange={(e) => setTradingSettings({ ...tradingSettings, trading_open_hour: Number(e.target.value) })}
                className="input-field"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Close Hour (1-24)</label>
              <input
                type="number"
                min="1"
                max="24"
                value={tradingSettings.trading_close_hour}
                onChange={(e) => setTradingSettings({ ...tradingSettings, trading_close_hour: Number(e.target.value) })}
                className="input-field"
              />
            </div>
          </div>
          <button onClick={handleSaveTrading} disabled={savingTrading} className="btn-primary mt-4">
            {savingTrading ? "Saving..." : "Save Trading Hours"}
          </button>
          <p className="text-xs text-gray-500 mt-2">Default: 0-24 (24/7). Set open/close hours to restrict trading times.</p>
        </div>

        <div className="glass-card mb-8 border-red-500/30">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Danger Zone</h2>
              <p className="text-sm text-gray-400">Reset the entire market to initial state</p>
            </div>
            <button
              onClick={handleResetMarket}
              disabled={resetting}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition-colors disabled:opacity-50"
            >
              {resetting ? "Resetting..." : "Reset All Holdings & Prices"}
            </button>
          </div>
          <p className="text-xs text-red-400">
            This will delete all user share holdings and reset every company back to its original price and share count.
          </p>
        </div>

        <div className="glass-card mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Companies ({companies.length})</h2>
            <button onClick={() => setShowNewForm(!showNewForm)} className="btn-primary">
              {showNewForm ? "Cancel" : "+ New Company"}
            </button>
          </div>

          {showNewForm && (
            <form onSubmit={handleCreateCompany} className="glass p-4 mb-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Company Name</label>
                  <input placeholder="e.g. Acme Corp" value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} className="input-field" required />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Ticker Symbol (max 6 chars)</label>
                  <input placeholder="e.g. ACME" value={newCompany.ticker} onChange={(e) => setNewCompany({ ...newCompany, ticker: e.target.value.toUpperCase() })} className="input-field" required maxLength={6} />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Initial Price (in cents)</label>
                  <input type="number" min="1" value={newCompany.share_price} onChange={(e) => setNewCompany({ ...newCompany, share_price: Number(e.target.value) })} className="input-field" required />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Total Shares to Create</label>
                  <input type="number" min="1" value={newCompany.total_shares} onChange={(e) => setNewCompany({ ...newCompany, total_shares: Number(e.target.value) })} className="input-field" required />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Description</label>
                <input placeholder="What does this company do?" value={newCompany.description} onChange={(e) => setNewCompany({ ...newCompany, description: e.target.value })} className="input-field" />
              </div>
              <button type="submit" className="btn-success">Create Company</button>
            </form>
          )}

          <div className="space-y-2">
            {companies.map((c) => (
              <div key={c.id} className="rounded-lg border border-gray-800 p-4 hover:border-gray-700 transition-colors">
                {editingCompany?.id === c.id ? (
                  <form onSubmit={handleUpdateCompany} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Name</label>
                        <input value={editingCompany.name} onChange={(e) => setEditingCompany({ ...editingCompany, name: e.target.value })} className="input-field" required />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Description</label>
                        <input value={editingCompany.description || ""} onChange={(e) => setEditingCompany({ ...editingCompany, description: e.target.value })} className="input-field" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Share Price (cents)</label>
                        <input type="number" min="1" value={editingCompany.share_price} onChange={(e) => setEditingCompany({ ...editingCompany, share_price: Number(e.target.value) })} className="input-field" required />
                      </div>
                      <div>
                        <label className="text-xs text-gray-400 mb-1 block">Total Shares</label>
                        <input type="number" min="0" value={editingCompany.total_shares} onChange={(e) => setEditingCompany({ ...editingCompany, total_shares: Number(e.target.value) })} className="input-field" required />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" className="btn-success text-sm px-4 py-2">Save Changes</button>
                      <button type="button" onClick={() => setEditingCompany(null)} className="text-gray-400 hover:text-white text-sm px-4 py-2">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-2 py-1 rounded">{c.ticker}</span>
                        <span className="text-white font-medium">{c.name}</span>
                      </div>
                      <p className="text-xs text-gray-500 ml-12">{c.description || "No description"}</p>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-right">
                        <div className="text-white font-semibold">{formatCoins(c.share_price)}</div>
                        <div className="text-xs text-gray-500">per share</div>
                      </div>
                      <div className="text-right">
                        <div className="text-white">{c.total_shares.toLocaleString()}</div>
                        <div className="text-xs text-gray-500">shares</div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingCompany(c)} className="bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 px-3 py-1.5 rounded text-xs font-medium transition-colors">
                          Edit
                        </button>
                        <button onClick={() => handleDeleteCompany(c.id)} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded text-xs font-medium transition-colors">
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card">
          <h2 className="text-xl font-semibold text-white mb-4">Users ({users.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="text-left py-2 text-gray-400">Username</th>
                  <th className="text-left py-2 text-gray-400">Email</th>
                  <th className="text-right py-2 text-gray-400">Balance</th>
                  <th className="text-center py-2 text-gray-400">Role</th>
                  <th className="text-center py-2 text-gray-400">Give Coins</th>
                  <th className="text-right py-2 text-gray-400">Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-gray-800/50">
                    <td className="py-2 text-white">{u.username}</td>
                    <td className="py-2 text-gray-400">{u.email}</td>
                    {u.is_admin ? (
                      <td className="py-2 text-right text-yellow-400 font-semibold">Unlimited</td>
                    ) : (
                      <td className="py-2 text-right text-blue-400">{formatCoins(u.balance)}</td>
                    )}
                    <td className="py-2 text-center">
                      {u.is_admin ? (
                        <span className="text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded text-xs font-bold">ADMIN</span>
                      ) : (
                        <span className="text-gray-500 text-xs">Player</span>
                      )}
                    </td>
                    <td className="py-2 text-center">
                      {!u.is_admin && (
                        giveCoinsUserId === u.id ? (
                          <div className="flex items-center gap-1 justify-center">
                            <input
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={giveCoinsAmount}
                              onChange={(e) => setGiveCoinsAmount(e.target.value)}
                              placeholder="Amount"
                              className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-xs"
                            />
                            <button onClick={() => handleGiveCoins(u.id)} disabled={givingCoins} className="text-green-400 hover:text-green-300 text-xs font-bold">
                              {givingCoins ? "..." : "Give"}
                            </button>
                            <button onClick={() => { setGiveCoinsUserId(null); setGiveCoinsAmount(""); }} className="text-gray-500 hover:text-white text-xs">
                              X
                            </button>
                          </div>
                        ) : (
                          <button onClick={() => setGiveCoinsUserId(u.id)} className="text-green-400 hover:text-green-300 text-xs font-medium">
                            + Give Coins
                          </button>
                        )
                      )}
                    </td>
                    <td className="py-2 text-right text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
