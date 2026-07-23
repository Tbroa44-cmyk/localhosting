import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const db = getDb();
    const users = db.prepare("SELECT id, username, email, balance, is_admin, created_at FROM users ORDER BY created_at DESC").all();
    const companies = db.prepare("SELECT * FROM companies ORDER BY ticker").all();
    const totalBalanceRows = db.prepare("SELECT SUM(balance) as total FROM users").all() as { total: number }[];
    const totalBalance = totalBalanceRows[0] || { total: 0 };
    const totalTransactionsRows = db.prepare("SELECT COUNT(*) as count FROM transactions").all() as { count: number }[];
    const totalTransactions = totalTransactionsRows[0] || { count: 0 };
    const bankFund = db.prepare("SELECT * FROM bank_fund WHERE id = 1").all() as { balance: number }[];
    const bankFundRow = bankFund[0] || { balance: 0 };

    return NextResponse.json({
      users,
      companies,
      stats: {
        totalUsers: users.length,
        totalBalance: totalBalance.total || 0,
        totalTransactions: totalTransactions.count,
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
    const existing = db.prepare("SELECT id FROM companies WHERE ticker = ?").get(ticker);
    if (existing) {
      return NextResponse.json({ error: "Ticker already exists" }, { status: 409 });
    }

    const result = db.prepare("INSERT INTO companies (name, ticker, description, share_price, total_shares, initial_price, initial_shares) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      name,
      ticker.toUpperCase(),
      description || "",
      share_price,
      total_shares,
      share_price,
      total_shares
    );

    const companyId = result.lastInsertRowid;
    db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(companyId, share_price, Date.now());

    return NextResponse.json({ message: "Company created successfully" });
  } catch (error) {
    console.error("Admin create error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
