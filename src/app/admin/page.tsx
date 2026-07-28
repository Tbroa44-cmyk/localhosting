"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { formatCoins } from "@/lib/format";
import Navbar from "@/components/Navbar";
import LoadingSpinner from "@/components/LoadingSpinner";
import ConfirmModal from "@/components/ConfirmModal";
import BanModal from "@/components/BanModal";
import { showToast } from "@/components/Toast";

interface User {
  id: number;
  username: string;
  email: string;
  balance: number;
  is_admin: number;
  allowed: number;
  role?: string;
  ban_count: number;
  banned_until: string | null;
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
  emergency_close: number;
  emergency_message: string;
  trading_days: string;
  bots_enabled: number;
}

interface CustomDateRange {
  id: number;
  start_date: string;
  end_date: string;
  label: string | null;
  enabled: number;
  created_at: string;
}

type Tab = "overview" | "companies" | "users" | "settings";

const TabIcon = ({ tab, active }: { tab: Tab; active: boolean }) => {
  const cls = `w-4 h-4 ${active ? "text-white" : "text-gray-400"}`;
  switch (tab) {
    case "overview": return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
    case "companies": return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>;
    case "users": return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>;
    case "settings": return <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>;
  }
};

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [users, setUsers] = useState<User[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalBalance: 0, totalTransactions: 0, bankFund: 0 });
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editShares, setEditShares] = useState(0);
  const [newCompany, setNewCompany] = useState({ name: "", ticker: "", description: "", share_price: 10000, total_shares: 1000 });
  const [showNewForm, setShowNewForm] = useState(false);
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);

  const [tradingSettings, setTradingSettings] = useState<TradingSettings>({ trading_enabled: 1, trading_open_hour: 0, trading_close_hour: 24, emergency_close: 0, emergency_message: "Markets under maintenance", trading_days: "1,2,3,4,5,6,7", bots_enabled: 1 });
  const [savingTrading, setSavingTrading] = useState(false);

  const [customDates, setCustomDates] = useState<CustomDateRange[]>([]);
  const [newDateRange, setNewDateRange] = useState({ start_date: "", end_date: "", label: "" });
  const [savingDate, setSavingDate] = useState(false);

  const [giveCoinsUserId, setGiveCoinsUserId] = useState<number | null>(null);
  const [giveCoinsAmount, setGiveCoinsAmount] = useState("");
  const [givingCoins, setGivingCoins] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMsg, setConfirmMsg] = useState("");
  const [confirmDanger, setConfirmDanger] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});

  const [userSearch, setUserSearch] = useState("");
  const [userBanFilter, setUserBanFilter] = useState<"all" | "players" | "banned" | "bots">("all");
  const [banModalUser, setBanModalUser] = useState<User | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    fetchAdminData();
    fetchTradingSettings();
    fetchCustomDates();
    const interval = setInterval(fetchAdminData, 10000);
    const onVisible = () => { if (document.visibilityState === "visible") fetchAdminData(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  function fetchAdminData() {
    fetch(`/api/admin/companies?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" } })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setUsers(data.users || []);
        setCompanies(data.companies || []);
        setStats(data.stats || { totalUsers: 0, totalBalance: 0, totalTransactions: 0, bankFund: 0 });
      })
      .catch(console.error);
  }

  function fetchTradingSettings() {
    fetch(`/api/admin/settings?t=${Date.now()}`, { headers: { "Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache" } })
      .then((r) => r.json())
      .then((data) => {
        if (data.trading_enabled !== undefined) setTradingSettings({
          trading_enabled: data.trading_enabled,
          trading_open_hour: data.trading_open_hour,
          trading_close_hour: data.trading_close_hour,
          emergency_close: data.emergency_close ?? 0,
          emergency_message: data.emergency_message ?? "Markets under maintenance",
          trading_days: data.trading_days ?? "1,2,3,4,5,6,7",
          bots_enabled: data.bots_enabled ?? 1,
        });
      })
      .catch(console.error);
  }

  function fetchCustomDates() {
    fetch(`/api/admin/custom-dates?t=${Date.now()}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCustomDates(data); })
      .catch(console.error);
  }

  async function handleAddDateRange() {
    if (!newDateRange.start_date || !newDateRange.end_date) return;
    setSavingDate(true);
    try {
      const res = await fetch("/api/admin/custom-dates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newDateRange),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast("Date range added", "success");
      setNewDateRange({ start_date: "", end_date: "", label: "" });
      fetchCustomDates();
    } catch (err: any) {
      showToast(err.message || "Failed", "error");
    } finally {
      setSavingDate(false);
    }
  }

  async function handleToggleDateRange(id: number, enabled: number) {
    try {
      await fetch("/api/admin/custom-dates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, enabled: enabled ? 0 : 1 }),
      });
      fetchCustomDates();
    } catch {}
  }

  async function handleDeleteDateRange(id: number) {
    openConfirm("Delete Date Range", "Remove this date range?", true, async () => {
      try {
        await fetch(`/api/admin/custom-dates?id=${id}`, { method: "DELETE" });
        showToast("Date range deleted", "success");
        fetchCustomDates();
      } catch {}
    });
  }

  async function handleEmergencyClose(toggle: boolean) {
    const msg = toggle ? "Enable emergency close? The market will show as under maintenance." : "Disable emergency close? The market will reopen according to normal schedule.";
    openConfirm(toggle ? "Emergency Close" : "Reopen Market", msg, toggle, async () => {
      const newSettings = { ...tradingSettings, emergency_close: toggle ? 1 : 0 };
      setTradingSettings(newSettings);
      await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      showToast(toggle ? "Market emergency closed" : "Market reopened", "success");
    });
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

  async function handleBanUser(userId: number, days: number) {
    try {
      const res = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(data.message || "User banned", "success");
        fetchAdminData();
      } else {
        showToast(data.error || "Failed", "error");
      }
    } catch {
      showToast("Error banning user", "error");
    }
  }

  async function handleUnbanUser(userId: number) {
    openConfirm("Unban User", "Are you sure you want to unban this user? They will be able to trade again.", false, async () => {
      try {
        const res = await fetch(`/api/admin/users/${userId}/ban`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unban: true }),
        });
        const data = await res.json();
        if (res.ok) {
          showToast(data.message || "User unbanned", "success");
          fetchAdminData();
        } else {
          showToast(data.error || "Failed", "error");
        }
      } catch {
        showToast("Error unbanning user", "error");
      }
    });
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
      if (!res.ok) { showToast(data.error || "Failed", "error"); return; }
      showToast("Company created!", "success");
      setShowNewForm(false);
      setNewCompany({ name: "", ticker: "", description: "", share_price: 10000, total_shares: 1000 });
      fetchAdminData();
    } catch {
      showToast("Error creating company", "error");
    }
  }

  function startEditCompany(c: Company) {
    setEditingCompany(c);
    setEditDescription(c.description || "");
    setEditShares(c.total_shares);
  }

  async function handleUpdateCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCompany) return;
    const hasShareChange = editShares > editingCompany.total_shares;
    const hasDescChange = editDescription !== (editingCompany.description || "");
    if (!hasShareChange && !hasDescChange) {
      showToast("No changes to save", "error");
      return;
    }
    try {
      const body: any = {};
      if (hasShareChange) body.total_shares = editShares;
      if (hasDescChange) body.description = editDescription;
      const res = await fetch(`/api/admin/companies/${editingCompany.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || "Failed", "error"); return; }
      showToast(data.message || "Updated!", "success");
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
        if (!res.ok) { showToast(data.error || "Failed", "error"); return; }
        showToast("Company deleted", "success");
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

  const isBot = (u: User) => u.role === "Bot";

  const filteredUsers = users.filter((u) => {
    if (userBanFilter === "bots") return isBot(u);
    if (isBot(u)) return false;
    if (userSearch) {
      const q = userSearch.toLowerCase();
      if (!u.username.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false;
    }
    if (userBanFilter === "banned" && u.allowed !== 1) return false;
    if (userBanFilter === "players" && u.allowed === 1) return false;
    return true;
  });

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" text="Loading..." />
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

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "companies", label: "Companies" },
    { key: "users", label: "Users" },
    { key: "settings", label: "Settings" },
  ];

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
      <BanModal
        open={banModalUser !== null}
        username={banModalUser?.username || ""}
        onConfirm={(days) => {
          if (banModalUser) {
            handleBanUser(banModalUser.id, days);
            setBanModalUser(null);
          }
        }}
        onCancel={() => setBanModalUser(null)}
      />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <svg className="w-7 h-7 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Admin Panel
            </h1>
            <p className="text-gray-400 text-sm mt-1 ml-10">Manage companies, users, and the market</p>
          </div>
          <div className="flex items-center gap-2 bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2">
            <div className={`w-2 h-2 rounded-full ${users.length > 0 || companies.length > 0 ? "bg-green-400" : "bg-yellow-400 animate-pulse"}`} />
            <span className="text-xs text-gray-400">{users.length > 0 || companies.length > 0 ? "Connected" : "Connecting..."}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 bg-gray-900/50 border border-gray-800 rounded-xl p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center justify-center gap-2 flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.key
                  ? "bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/20"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              <TabIcon tab={tab.key} active={activeTab === tab.key} />
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "overview" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="glass-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Users</div>
                <div className="text-3xl font-bold text-white">{stats.totalUsers}</div>
              </div>
              <div className="glass-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Coins in Circulation</div>
                <div className="text-3xl font-bold text-emerald-400">{formatCoins(stats.totalBalance)}</div>
              </div>
              <div className="glass-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Transactions</div>
                <div className="text-3xl font-bold text-violet-400">{stats.totalTransactions}</div>
              </div>
              <div className="glass-card">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">Bank Fund (3% Tax)</div>
                <div className="text-3xl font-bold text-amber-400">{formatCoins(stats.bankFund)}</div>
              </div>
            </div>

            <div className="glass-card border-red-500/20">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                    <h3 className="text-red-300 font-semibold">Danger Zone</h3>
                  </div>
                  <p className="text-gray-400 text-sm mt-1">Reset the entire market — deletes all holdings and resets all prices</p>
                </div>
                <button
                  onClick={handleResetMarket}
                  disabled={resetting}
                  className="bg-red-600/80 hover:bg-red-600 text-white font-medium py-2 px-5 rounded-lg transition-colors disabled:opacity-50 text-sm shrink-0"
                >
                  {resetting ? "Resetting..." : "Reset Holdings & Prices"}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "companies" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Companies ({companies.length})</h2>
              <button onClick={() => setShowNewForm(!showNewForm)} className="bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm">
                {showNewForm ? "Cancel" : "+ New Company"}
              </button>
            </div>

            {showNewForm && (
              <form onSubmit={handleCreateCompany} className="glass-card border-emerald-500/20 space-y-4">
                <h3 className="text-white font-medium">New Company</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Company Name</label>
                    <input placeholder="e.g. Acme Corp" value={newCompany.name} onChange={(e) => setNewCompany({ ...newCompany, name: e.target.value })} className="input-field" required />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Ticker Symbol (max 6)</label>
                    <input placeholder="e.g. ACME" value={newCompany.ticker} onChange={(e) => setNewCompany({ ...newCompany, ticker: e.target.value.toUpperCase() })} className="input-field" required maxLength={6} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Initial Price (cents)</label>
                    <input type="number" min="1" value={newCompany.share_price} onChange={(e) => setNewCompany({ ...newCompany, share_price: Number(e.target.value) })} className="input-field" required />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">Total Shares</label>
                    <input type="number" min="1" value={newCompany.total_shares} onChange={(e) => setNewCompany({ ...newCompany, total_shares: Number(e.target.value) })} className="input-field" required />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Description</label>
                  <input placeholder="What does this company do?" value={newCompany.description} onChange={(e) => setNewCompany({ ...newCompany, description: e.target.value })} className="input-field" />
                </div>
                <button type="submit" className="bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium py-2 px-5 rounded-lg transition-colors text-sm">Create Company</button>
              </form>
            )}

            <div className="space-y-3">
              {companies.map((c) => {
                const sharesIncreased = c.initial_shares && c.total_shares > c.initial_shares;
                return (
                  <div key={c.id} className="glass-card">
                    {editingCompany?.id === c.id ? (
                      <form onSubmit={handleUpdateCompany} className="space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-2 py-1 rounded">{c.ticker}</span>
                          <span className="text-white font-medium">{c.name}</span>
                          <span className="text-xs text-yellow-500 ml-2">Editing</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800">
                            <label className="text-xs text-gray-500 block mb-1">Company Name</label>
                            <div className="text-white text-sm">{c.name}</div>
                            <span className="text-[10px] text-gray-600 mt-1 inline-block">Locked — create new instead</span>
                          </div>
                          <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800">
                            <label className="text-xs text-gray-500 block mb-1">Share Price</label>
                            <div className="text-white text-sm">{formatCoins(c.share_price)}</div>
                            <span className="text-[10px] text-gray-600 mt-1 inline-block">Locked — market-driven</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 mb-1 block">Description</label>
                          <input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="input-field" placeholder="Company description" />
                        </div>
                        <div>
                          <label className="text-xs text-gray-400 mb-1 block">Total Shares — can only increase</label>
                          <input type="number" min={c.total_shares + 1} value={editShares} onChange={(e) => { const val = Number(e.target.value); setEditShares(val); }} className="input-field" required />
                          <p className="text-xs text-gray-500 mt-1">
                            Current: {c.total_shares.toLocaleString()}
                            {editShares > c.total_shares && (
                              <span className="text-emerald-400 ml-2">(+{(editShares - c.total_shares).toLocaleString()} new)</span>
                            )}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button type="submit" disabled={editShares <= c.total_shares && editDescription === (c.description || "")} className="bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium px-4 py-2 rounded-lg transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed">Save Changes</button>
                          <button type="button" onClick={() => setEditingCompany(null)} className="text-gray-400 hover:text-white text-sm px-4 py-2">Cancel</button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-mono text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">#{c.id}</span>
                            <span className="text-xs font-mono text-blue-400 bg-blue-400/10 px-2 py-0.5 rounded">{c.ticker}</span>
                            <span className="text-white font-medium truncate">{c.name}</span>
                            {sharesIncreased && (
                              <span className="text-[10px] text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">+{(c.total_shares - (c.initial_shares || 0)).toLocaleString()} released</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 truncate">{c.description || "No description"}</p>
                        </div>
                        <div className="flex items-center gap-5 text-sm shrink-0">
                          <div className="text-right">
                            <div className="text-white font-semibold">{formatCoins(c.share_price)}</div>
                            <div className="text-[10px] text-gray-500">per share</div>
                          </div>
                          <div className="text-right">
                            <div className="text-white">{c.total_shares.toLocaleString()}</div>
                            <div className="text-[10px] text-gray-500">shares</div>
                          </div>
                          <div className="flex gap-1.5">
                            <button onClick={() => startEditCompany(c)} className="bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 px-3 py-1.5 rounded text-xs font-medium transition-colors">Edit</button>
                            <button onClick={() => handleDeleteCompany(c.id)} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded text-xs font-medium transition-colors">Delete</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {companies.length === 0 && (
                <div className="text-center text-gray-500 py-8">No companies yet</div>
              )}
            </div>
          </div>
        )}

        {activeTab === "users" && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                <input type="text" placeholder="Search..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="input-field pl-10" />
              </div>
              <select value={userBanFilter} onChange={(e) => setUserBanFilter(e.target.value as any)} className="input-field w-auto sm:w-44">
                <option value="all">All Players ({users.filter((u) => !isBot(u)).length})</option>
                <option value="players">Active Players</option>
                <option value="banned">Banned Only</option>
                <option value="bots">Bots ({users.filter((u) => isBot(u)).length})</option>
              </select>
            </div>

            <div className="glass-card overflow-hidden !p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">User</th>
                      <th className="text-left py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider hidden sm:table-cell">Email</th>
                      <th className="text-right py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">Balance</th>
                      <th className="text-center py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">Role</th>
                      <th className="text-center py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">Status</th>
                      <th className="text-center py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">Bans</th>
                      <th className="text-center py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider">Actions</th>
                      <th className="text-right py-3.5 px-4 text-gray-400 font-medium text-xs uppercase tracking-wider hidden md:table-cell">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="border-b border-gray-800/40 hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-4">
                          <div className="text-white font-medium">{u.username}</div>
                          <div className="text-gray-500 text-xs sm:hidden">{u.email}</div>
                        </td>
                        <td className="py-3 px-4 text-gray-400 hidden sm:table-cell">{u.email}</td>
                        <td className="py-3 px-4 text-right">
                          <span className="text-emerald-400 font-medium">{formatCoins(u.balance)}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          {u.is_admin ? (
                            <span className="inline-flex items-center gap-1 text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded text-xs font-bold">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                              ADMIN
                            </span>
                          ) : isBot(u) ? (
                            <span className="inline-flex items-center gap-1 text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded text-xs font-medium">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                              BOT
                            </span>
                          ) : (
                            <span className="text-gray-500 text-xs">Player</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center">
                          {u.is_admin ? null : isBot(u) ? (
                            <span className="text-cyan-400/60 text-xs">—</span>
                          ) : u.allowed === 1 ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-red-400 bg-red-400/10 px-2 py-0.5 rounded text-xs font-medium">Banned</span>
                              {u.banned_until ? <span className="text-[10px] text-gray-500">until {new Date(u.banned_until).toLocaleDateString()}</span> : <span className="text-[10px] text-gray-500">indefinite</span>}
                            </div>
                          ) : (
                            <span className="text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded text-xs font-medium">Active</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-center text-gray-400 text-sm">{u.is_admin || isBot(u) ? null : (u.ban_count || 0)}</td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {!u.is_admin && !isBot(u) && (
                              u.allowed === 1 ? (
                                <button onClick={() => handleUnbanUser(u.id)} className="text-emerald-400 hover:text-emerald-300 text-xs font-medium transition-colors">Unban</button>
                              ) : (
                                <button onClick={() => setBanModalUser(u)} className="text-red-400 hover:text-red-300 text-xs font-medium transition-colors">Ban</button>
                              )
                            )}
                            {!isBot(u) && (giveCoinsUserId === u.id ? (
                              <div className="flex items-center gap-1">
                                <input type="number" step="0.01" min="0.01" value={giveCoinsAmount} onChange={(e) => setGiveCoinsAmount(e.target.value)} placeholder="c" className="w-16 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white text-xs" />
                                <button onClick={() => handleGiveCoins(u.id)} disabled={givingCoins} className="text-emerald-400 hover:text-emerald-300 text-xs font-bold transition-colors">{givingCoins ? "..." : "Give"}</button>
                                <button onClick={() => { setGiveCoinsUserId(null); setGiveCoinsAmount(""); }} className="text-gray-500 hover:text-white text-xs transition-colors">X</button>
                              </div>
                            ) : (
                              <button onClick={() => { setGiveCoinsUserId(u.id); setGiveCoinsAmount(""); }} className="text-gray-400 hover:text-emerald-400 text-xs font-medium transition-colors">+ Coins</button>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right text-gray-500 text-xs hidden md:table-cell">{new Date(u.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {filteredUsers.length === 0 && (
                <div className="text-center text-gray-500 py-8">
                  {userSearch || userBanFilter !== "all" ? (
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                      <span>No users match your filters</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-8 h-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      <span>No users yet</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="space-y-6">
            <div className={`glass-card ${tradingSettings.emergency_close ? "border-red-500/30" : "border-orange-500/20"}`}>
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <svg className={`w-5 h-5 ${tradingSettings.emergency_close ? "text-red-400" : "text-orange-400"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
                    <h3 className={`font-semibold ${tradingSettings.emergency_close ? "text-red-300" : "text-white"}`}>
                      {tradingSettings.emergency_close ? "Emergency Close Active" : "Emergency Session Close"}
                    </h3>
                  </div>
                  <p className="text-gray-400 text-sm">Immediately closes the market and shows a maintenance message to all users</p>
                  {tradingSettings.emergency_close === 1 && <p className="text-red-400 text-xs mt-1">Market is currently in emergency maintenance mode</p>}
                </div>
                <button
                  onClick={() => handleEmergencyClose(tradingSettings.emergency_close !== 1)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 ${
                    tradingSettings.emergency_close ? "bg-emerald-600/80 hover:bg-emerald-600 text-white" : "bg-red-600/80 hover:bg-red-600 text-white"
                  }`}
                >
                  {tradingSettings.emergency_close ? "Reopen Market" : "Emergency Close"}
                </button>
              </div>
              {tradingSettings.emergency_close === 1 && (
                <div className="mt-4 pt-4 border-t border-red-500/20">
                  <label className="text-xs text-gray-400 mb-1 block">Maintenance Message</label>
                  <div className="flex gap-2">
                    <input value={tradingSettings.emergency_message} onChange={(e) => setTradingSettings({ ...tradingSettings, emergency_message: e.target.value })} className="input-field flex-1" placeholder="Markets under maintenance" />
                    <button onClick={handleSaveTrading} disabled={savingTrading} className="bg-purple-600/80 hover:bg-purple-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors">{savingTrading ? "Saving..." : "Save"}</button>
                  </div>
                </div>
              )}
            </div>

            <div className="glass-card border-cyan-500/20">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    <h3 className="text-white font-semibold">Bot Activity</h3>
                  </div>
                  <p className="text-gray-400 text-sm">25 AI bots (Bot1–Bot25) simulate trading activity</p>
                  <p className="text-gray-500 text-xs mt-1">5000c starting cash each</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={async () => {
                      const newEnabled = tradingSettings.bots_enabled ? 0 : 1;
                      const newSettings = { ...tradingSettings, bots_enabled: newEnabled };
                      setTradingSettings(newSettings);
                      await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newSettings) });
                      showToast(newEnabled ? "Bots enabled" : "Bots disabled", "success");
                    }}
                    className={`relative w-14 h-7 rounded-full transition-colors duration-300 ${tradingSettings.bots_enabled ? "bg-cyan-600" : "bg-gray-700"}`}
                  >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform duration-300 ${tradingSettings.bots_enabled ? "translate-x-7" : "translate-x-0.5"}`} />
                  </button>
                  <span className={`text-sm font-medium ${tradingSettings.bots_enabled ? "text-cyan-400" : "text-gray-500"}`}>{tradingSettings.bots_enabled ? "ON" : "OFF"}</span>
                </div>
              </div>
            </div>

            <div className="glass-card border-purple-500/20">
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <h3 className="text-white font-semibold">Trading Hours</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Trading Status</label>
                  <select value={tradingSettings.trading_enabled} onChange={(e) => setTradingSettings({ ...tradingSettings, trading_enabled: Number(e.target.value) })} className="input-field">
                    <option value={1}>Open</option>
                    <option value={0}>Closed (Admin Lock)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Open Hour (0-23)</label>
                  <input type="number" min="0" max="23" value={tradingSettings.trading_open_hour} onChange={(e) => setTradingSettings({ ...tradingSettings, trading_open_hour: Number(e.target.value) })} className="input-field" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Close Hour (1-24)</label>
                  <input type="number" min="1" max="24" value={tradingSettings.trading_close_hour} onChange={(e) => setTradingSettings({ ...tradingSettings, trading_close_hour: Number(e.target.value) })} className="input-field" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mb-4">Hours in Australian Queensland time (AEST, UTC+10). Default: 0-24 (24/7).</p>
              <button onClick={handleSaveTrading} disabled={savingTrading} className="bg-purple-600/80 hover:bg-purple-600 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors">{savingTrading ? "Saving..." : "Save Trading Hours"}</button>
            </div>

            <div className="glass-card border-blue-500/20">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <h3 className="text-white font-semibold">Trading Days</h3>
              </div>
              <p className="text-gray-400 text-xs mb-4">Select which days the market can be open.</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {[
                  { label: "Mon", value: 1 },
                  { label: "Tue", value: 2 },
                  { label: "Wed", value: 3 },
                  { label: "Thu", value: 4 },
                  { label: "Fri", value: 5 },
                  { label: "Sat", value: 6 },
                  { label: "Sun", value: 0 },
                ].map((day) => {
                  const enabled = (tradingSettings.trading_days || "1,2,3,4,5,6,7").split(",").map(Number).includes(day.value);
                  return (
                    <button
                      key={day.value}
                      onClick={() => {
                        const current = (tradingSettings.trading_days || "1,2,3,4,5,6,7").split(",").map(Number);
                        const updated = enabled ? current.filter(d => d !== day.value) : [...current, day.value];
                        setTradingSettings({ ...tradingSettings, trading_days: updated.join(",") });
                      }}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                        enabled ? "bg-blue-600/20 border-blue-500/50 text-blue-400" : "bg-gray-800/50 border-gray-700/50 text-gray-500"
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <button onClick={handleSaveTrading} disabled={savingTrading} className="bg-purple-600/80 hover:bg-purple-600 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors">{savingTrading ? "Saving..." : "Save Trading Days"}</button>
            </div>

            <div className="glass-card border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10v4M8 10v4M12 10v4M10 2v4M14 2v4" /></svg>
                <h3 className="text-white font-semibold">Custom Date Ranges</h3>
              </div>
              <p className="text-gray-400 text-xs mb-4">Set specific date ranges when the market should be closed.</p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Start Date</label>
                  <input type="date" value={newDateRange.start_date} onChange={(e) => setNewDateRange({ ...newDateRange, start_date: e.target.value })} className="input-field" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">End Date</label>
                  <input type="date" value={newDateRange.end_date} onChange={(e) => setNewDateRange({ ...newDateRange, end_date: e.target.value })} className="input-field" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Label (optional)</label>
                  <input value={newDateRange.label} onChange={(e) => setNewDateRange({ ...newDateRange, label: e.target.value })} className="input-field" placeholder="e.g. Holiday break" />
                </div>
              </div>
              <button onClick={handleAddDateRange} disabled={savingDate || !newDateRange.start_date || !newDateRange.end_date} className="bg-emerald-600/80 hover:bg-emerald-600 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors disabled:opacity-50">{savingDate ? "Adding..." : "Add Date Range"}</button>

              {customDates.length > 0 && (
                <div className="mt-4 space-y-2">
                  {customDates.map((range) => (
                    <div key={range.id} className="flex items-center justify-between py-3 px-4 bg-gray-800/40 rounded-lg border border-gray-800/60 hover:border-gray-700 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full ${range.enabled ? "bg-red-400" : "bg-gray-600"}`} />
                        <div>
                          <div className="text-white text-sm">{range.start_date} → {range.end_date}</div>
                          {range.label && <div className="text-xs text-gray-400">{range.label}</div>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleToggleDateRange(range.id, range.enabled)} className={`text-xs font-medium px-2 py-1 rounded transition-colors ${range.enabled ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30" : "bg-gray-700 text-gray-400 hover:bg-gray-600"}`}>
                          {range.enabled ? "Enabled" : "Disabled"}
                        </button>
                        <button onClick={() => handleDeleteDateRange(range.id)} className="text-red-400 hover:text-red-300 text-xs font-medium px-2 py-1 rounded bg-red-500/10 hover:bg-red-500/20 transition-colors">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
