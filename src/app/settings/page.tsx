"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import LoadingSpinner from "@/components/LoadingSpinner";
import PageBackground from "@/components/PageBackground";

export default function SettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [popupEnabled, setPopupEnabled] = useState(true);
  const [notifBought, setNotifBought] = useState(false);
  const [notifSold, setNotifSold] = useState(false);
  const [browserSupported, setBrowserSupported] = useState(false);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | "loading">("loading");

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");
  const [settingsError, setSettingsError] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login");
  }, [status, router]);

  useEffect(() => {
    const s = localStorage.getItem("soundEnabled");
    if (s !== null) setSoundEnabled(s === "true");
    const p = localStorage.getItem("popupEnabled");
    if (p !== null) setPopupEnabled(p === "true");
    const nb = localStorage.getItem("notifBought");
    if (nb !== null) setNotifBought(nb === "true");
    const ns = localStorage.getItem("notifSold");
    if (ns !== null) setNotifSold(ns === "true");

    const supported = "Notification" in window;
    setBrowserSupported(supported);
    if (supported) {
      setNotifPermission(Notification.permission);
    } else {
      setNotifPermission("denied");
    }
  }, []);

  function updateSetting(key: string, value: boolean) {
    localStorage.setItem(key, value.toString());
  }

  async function requestBrowserPermission() {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSettingsMsg("");
    setSettingsError("");
    if (!currentPassword) {
      setSettingsError("Current password is required");
      return;
    }
    if (!newEmail && !newPassword) {
      setSettingsError("No changes to save");
      return;
    }
    try {
      const res = await fetch("/api/user/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newEmail: newEmail || undefined, newPassword: newPassword || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSettingsMsg("Settings updated successfully");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err: any) {
      setSettingsError(err.message);
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <PageBackground />
        <Navbar />
        <LoadingSpinner size="lg" text="Loading settings..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <PageBackground variant="account" />
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8 md:py-12">
        <div className="mb-8 animate-fade-up">
          <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">Settings</h1>
          <p className="text-gray-400">Manage your notifications and account details</p>
        </div>

        {/* Sound & Popup */}
        <div className="glass-card mb-6 animate-fade-up" style={{ animationDelay: "50ms", animationFillMode: "both" }}>
          <div className="border-b border-gray-800 pb-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 010 14.14M15.54 8.46a5 5 0 010 7.07" /></svg>
              Website Notifications
            </h2>
          </div>
          <label className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
            <span className="text-white font-medium">Sound Effects</span>
            <button
              type="button"
              onClick={() => { setSoundEnabled(!soundEnabled); updateSetting("soundEnabled", !soundEnabled); }}
              className={`relative w-12 h-6 rounded-full transition-colors ${soundEnabled ? "bg-blue-600" : "bg-gray-700"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${soundEnabled ? "translate-x-6" : "translate-x-0"}`} />
            </button>
          </label>
          <label className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
            <span className="text-white font-medium">Notification Popups</span>
            <button
              type="button"
              onClick={() => { setPopupEnabled(!popupEnabled); updateSetting("popupEnabled", !popupEnabled); }}
              className={`relative w-12 h-6 rounded-full transition-colors ${popupEnabled ? "bg-blue-600" : "bg-gray-700"}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${popupEnabled ? "translate-x-6" : "translate-x-0"}`} />
            </button>
          </label>
        </div>

        {/* Browser Notifications */}
        <div className="glass-card mb-6 animate-fade-up" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
          <div className="border-b border-gray-800 pb-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" /></svg>
              Browser Notifications
            </h2>
          </div>
          {!browserSupported ? (
            <p className="text-gray-500 text-sm">Browser notifications are not supported on your device.</p>
          ) : notifPermission === "loading" ? (
            <p className="text-gray-500 text-sm">Checking permission...</p>
          ) : notifPermission === "denied" || notifPermission === "default" ? (
            <div className="flex items-center justify-between p-3 rounded-lg">
              <div>
                <p className="text-white font-medium">Enable Notifications</p>
                <p className="text-gray-500 text-sm">Allow browser notifications to receive trade alerts</p>
              </div>
              <button onClick={requestBrowserPermission} className="btn-primary text-sm">
                {notifPermission === "denied" ? "Blocked - Open Browser Settings" : "Enable"}
              </button>
            </div>
          ) : (
            <>
              <label className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
                <span className="text-white font-medium">When stock is bought</span>
                <button
                  type="button"
                  onClick={() => { setNotifBought(!notifBought); updateSetting("notifBought", !notifBought); }}
                  className={`relative w-12 h-6 rounded-full transition-colors ${notifBought ? "bg-blue-600" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notifBought ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </label>
              <label className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer">
                <span className="text-white font-medium">When stock is sold</span>
                <button
                  type="button"
                  onClick={() => { setNotifSold(!notifSold); updateSetting("notifSold", !notifSold); }}
                  className={`relative w-12 h-6 rounded-full transition-colors ${notifSold ? "bg-blue-600" : "bg-gray-700"}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${notifSold ? "translate-x-6" : "translate-x-0"}`} />
                </button>
              </label>
            </>
          )}
        </div>

        {/* Change Email & Password */}
        <div className="glass-card animate-fade-up" style={{ animationDelay: "150ms", animationFillMode: "both" }}>
          <div className="border-b border-gray-800 pb-4 mb-4">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-400"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></svg>
              Email & Password
            </h2>
          </div>
          <form onSubmit={handleSaveSettings} className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm block mb-1">Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="input-field w-full"
                required
              />
            </div>
            <div>
              <label className="text-gray-400 text-sm block mb-1">New Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder={(session?.user as any)?.email || "your@email.com"}
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="text-gray-400 text-sm block mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                className="input-field w-full"
                minLength={6}
              />
            </div>
            {settingsMsg && <p className="text-green-400 text-sm">{settingsMsg}</p>}
            {settingsError && <p className="text-red-400 text-sm">{settingsError}</p>}
            <button type="submit" className="btn-primary w-full">
              Save Changes
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
