export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb, { insertPriceHistory } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const db = getDb();

    let users: any[] = [];
    try {
      const rawUsers = await db.prepare("SELECT id, username, email, balance, is_admin, allowed, role, ban_count, banned_until, created_at FROM users ORDER BY created_at DESC").all() as any[];
      users = (Array.isArray(rawUsers) ? rawUsers : []).map((u: any) => ({
        id: u.id, username: u.username, email: u.email, balance: u.balance, is_admin: u.is_admin, created_at: u.created_at,
        allowed: u.allowed ?? 0,
        role: u.role ?? "user",
        ban_count: u.ban_count ?? 0,
        banned_until: u.banned_until ?? null,
      }));
    } catch (e: any) {
      console.error("Failed to fetch users:", e?.message);
      try {
        const rawUsers = await db.prepare("SELECT id, username, email, balance, is_admin, created_at FROM users ORDER BY created_at DESC").all() as any[];
        users = (Array.isArray(rawUsers) ? rawUsers : []).map((u: any) => ({
          ...u, allowed: 0, role: "user", ban_count: 0, banned_until: null,
        }));
      } catch {}
    }

    let companies: any[] = [];
    try {
      companies = await db.prepare("SELECT id, name, ticker, description, share_price, total_shares, initial_price, initial_shares FROM companies ORDER BY ticker").all() as any[];
    } catch (e: any) {
      console.error("Failed to fetch companies:", e?.message);
    }

    let totalBalance = 0;
    try {
      const rows = await db.prepare("SELECT balance FROM users").all() as { balance: number }[];
      totalBalance = (Array.isArray(rows) ? rows : []).reduce((s, r) => s + Number(r.balance || 0), 0);
    } catch {}

    let totalTransactions = 0;
    try {
      const rows = await db.prepare("SELECT id FROM transactions ORDER BY created_at DESC LIMIT 200").all() as any[];
      totalTransactions = Array.isArray(rows) ? rows.length : 0;
    } catch {}

    let bankFundBalance = 0;
    try {
      const rows = await db.prepare("SELECT * FROM bank_fund WHERE id = 1").all() as { balance: number }[];
      bankFundBalance = rows[0]?.balance || 0;
    } catch {}

    return NextResponse.json({
      users,
      companies,
      stats: {
        totalUsers: users.filter((u: any) => u.role !== "Bot").length,
        totalBalance,
        totalTransactions,
        bankFund: bankFundBalance,
      },
    });
  } catch (error) {
    console.error("Admin error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { name, ticker, description, share_price, total_shares } = await request.json();

    if (!name || !ticker || !share_price || !total_shares) {
      return NextResponse.json({ error: "Name, ticker, share price, and total shares are required" }, { status: 400 });
    }

    const db = getDb();
    const existing = await db.prepare("SELECT id FROM companies WHERE ticker = ?").get(ticker);
    if (existing) {
      return NextResponse.json({ error: "Ticker already exists" }, { status: 409 });
    }

    const result = await db.prepare("INSERT INTO companies (name, ticker, description, share_price, total_shares, initial_price, initial_shares) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      name,
      ticker.toUpperCase(),
      description || "",
      share_price,
      total_shares,
      share_price,
      total_shares
    );

    const companyId = result.lastInsertRowid;
    await insertPriceHistory(companyId, share_price, Date.now());

    return NextResponse.json({ message: "Company created successfully" });
  } catch (error) {
    console.error("Admin create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
