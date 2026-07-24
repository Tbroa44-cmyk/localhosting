export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const db = getDb();

    const rawHoldings = await db.prepare(
      "SELECT id, shares_owned, company_id FROM holdings WHERE user_id = ?"
    ).all(userId) as any[];

    console.log("[Portfolio] userId:", userId, "holdings count:", rawHoldings.length, "raw:", JSON.stringify(rawHoldings));

    const holdings: any[] = [];
    const priceHistories: Record<number, { price: number; timestamp: number }[]> = {};

    for (const h of rawHoldings) {
      const company = await db.prepare(
        "SELECT name as company_name, ticker, share_price, total_shares FROM companies WHERE id = ?"
      ).get(h.company_id) as any;

      const share_price = company ? Number(company.share_price) || 0 : 0;
      const shares_owned = Number(h.shares_owned) || 0;

      holdings.push({
        id: h.id,
        shares_owned,
        company_id: h.company_id,
        company_name: company?.company_name || "Unknown",
        ticker: company?.ticker || "???",
        share_price,
        total_shares: company?.total_shares || 0,
      });

      priceHistories[h.company_id] = await db.prepare(
        "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp ASC"
      ).all(h.company_id) as { price: number; timestamp: number }[];
    }

    const totalValue = holdings.reduce(
      (sum: number, h: any) => sum + Number(h.share_price) * Number(h.shares_owned),
      0
    );

    console.log("[Portfolio] holdings:", JSON.stringify(holdings), "totalValue:", totalValue);

    const rawTransactions = await db.prepare(
      "SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 25"
    ).all(userId) as any[];

    const transactions = [];
    for (const t of rawTransactions) {
      const company = await db.prepare(
        "SELECT name as company_name, ticker FROM companies WHERE id = ?"
      ).get(t.company_id) as any;
      transactions.push({
        ...t,
        company_name: company?.company_name || "Unknown",
        ticker: company?.ticker || "???",
      });
    }

    const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    return NextResponse.json({ holdings, totalValue, transactions, user, priceHistories });
  } catch (error) {
    console.error("Portfolio error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
