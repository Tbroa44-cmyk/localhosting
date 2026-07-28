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

    const [allUserHoldings, allCompanies, rawTransactions, user] = await Promise.all([
      db.prepare("SELECT company_id, shares_owned FROM holdings WHERE user_id = ?").all(userId),
      db.prepare("SELECT id, name, ticker, share_price, total_shares FROM companies").all(),
      db.prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 25").all(userId),
      db.prepare("SELECT id, username, email, balance, xp, level, created_at FROM users WHERE id = ?").get(userId),
    ]) as any[];

    const companyMap: Record<number, any> = {};
    for (const c of allCompanies) {
      companyMap[Number(c.id)] = c;
    }

    const rawHoldingsMap: Record<number, number> = {};
    for (const h of allUserHoldings) {
      const cid = Number(h.company_id);
      rawHoldingsMap[cid] = (rawHoldingsMap[cid] || 0) + Number(h.shares_owned || 0);
    }

    const companyIds = Object.keys(rawHoldingsMap).map(Number);
    const priceHistoryResults = await Promise.all(
      companyIds.map(cid =>
        db.prepare("SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp ASC").all(cid)
      )
    ) as any[][];

    const priceHistories: Record<number, { price: number; timestamp: number }[]> = {};
    const holdings: any[] = [];

    for (let i = 0; i < companyIds.length; i++) {
      const cid = companyIds[i];
      const shares = rawHoldingsMap[cid];
      const company = companyMap[cid];
      const share_price = company ? Number(company.share_price) || 0 : 0;

      holdings.push({
        shares_owned: shares,
        company_id: cid,
        company_name: company?.name || "Unknown",
        ticker: company?.ticker || "???",
        share_price,
        total_shares: company?.total_shares || 0,
      });

      priceHistories[cid] = priceHistoryResults[i];
    }

    const totalValue = holdings.reduce(
      (sum: number, h: any) => sum + Number(h.share_price) * Number(h.shares_owned), 0
    );

    const transactions = rawTransactions.map((t: any) => {
      const company = companyMap[Number(t.company_id)];
      return {
        ...t,
        company_name: company?.name || "Unknown",
        ticker: company?.ticker || "???",
      };
    });

    return NextResponse.json({ holdings, totalValue, transactions, user, priceHistories });
  } catch (error) {
    console.error("Portfolio error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
