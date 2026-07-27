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
      users = await db.prepare("SELECT id, username, email, balance, is_admin, allowed, role, ban_count, banned_until, created_at FROM users ORDER BY created_at DESC").all() as any[];
    } catch {
      try {
        users = await db.prepare("SELECT id, username, email, balance, is_admin, allowed, role, created_at FROM users ORDER BY created_at DESC").all() as any[];
        for (const u of users) { u.ban_count = 0; u.banned_until = null; }
      } catch {
        users = await db.prepare("SELECT id, username, email, balance, is_admin, created_at FROM users ORDER BY created_at DESC").all() as any[];
        for (const u of users) { u.allowed = 0; u.ban_count = 0; u.banned_until = null; }
      }
    }
    const companies = await db.prepare("SELECT id, name, ticker, description, share_price, total_shares, initial_price, initial_shares FROM companies ORDER BY ticker").all() as any[];
    const totalBalanceRows = await db.prepare("SELECT balance FROM users").all() as { balance: number }[];
    const totalBalance = totalBalanceRows.reduce((s: number, r: any) => s + Number(r.balance || 0), 0);
    let totalTransactions = 0;
    try {
      const txCount = await db.prepare("SELECT COUNT(*) as cnt FROM transactions").get() as { cnt: number } | undefined;
      totalTransactions = txCount?.cnt || 0;
    } catch {
      try {
        const recentTx = await db.prepare("SELECT id FROM transactions ORDER BY created_at DESC LIMIT 1").all() as any[];
        totalTransactions = recentTx.length > 0 ? 99999 : 0;
      } catch {}
    }
    const bankFund = await db.prepare("SELECT * FROM bank_fund WHERE id = 1").all() as { balance: number }[];
    const bankFundRow = bankFund[0] || { balance: 0 };

    return NextResponse.json({
      users,
      companies,
      stats: {
        totalUsers: users.filter((u: any) => u.role !== "bot").length,
        totalBalance,
        totalTransactions,
        bankFund: bankFundRow.balance || 0,
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
