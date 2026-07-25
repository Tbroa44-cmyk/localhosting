export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import getDb from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const db = getDb();

    const allUserHoldings = await db.prepare(
      "SELECT company_id, shares_owned FROM holdings WHERE user_id = ?"
    ).all(userId) as any[];

    const rawHoldingsMap: Record<number, number> = {};
    for (const h of allUserHoldings) {
      const cid = Number(h.company_id);
      rawHoldingsMap[cid] = (rawHoldingsMap[cid] || 0) + Number(h.shares_owned || 0);
    }
    const rawHoldings = Object.entries(rawHoldingsMap).map(([company_id, shares_owned]) => ({
      company_id: Number(company_id),
      shares_owned,
    }));

    const holdings: any[] = [];
    const priceHistories: Record<number, { price: number; timestamp: number }[]> = {};
    const seenCompanies = new Set<number>();

    for (const h of rawHoldings) {
      if (seenCompanies.has(h.company_id)) continue;
      seenCompanies.add(h.company_id);

      const company = await db.prepare(
        "SELECT name as company_name, ticker, share_price, total_shares FROM companies WHERE id = ?"
      ).get(h.company_id) as any;

      const share_price = company ? Number(company.share_price) || 0 : 0;
      const shares_owned = Number(h.shares_owned) || 0;

      holdings.push({
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
