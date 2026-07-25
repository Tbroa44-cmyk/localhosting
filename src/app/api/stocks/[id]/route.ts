export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb, { getLowestPendingSell } from "@/lib/db";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid stock ID" }, { status: 400 });
    }

    const db = getDb();
    const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(id);

    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const basePrice = Number((company as any).share_price) || 0;
    const effectiveSellPrice = await getLowestPendingSell(id);
    const effectivePrice = (effectiveSellPrice !== null && effectiveSellPrice < basePrice) ? effectiveSellPrice : basePrice;
    (company as any).share_price = effectivePrice;

    const priceHistory = await db.prepare(
      "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp ASC"
    ).all(id);

    const totalOwned = await db.prepare(
      "SELECT SUM(shares_owned) as total FROM holdings WHERE company_id = ?"
    ).all(id) as { total: number }[];

    const ownedShares = totalOwned[0]?.total || 0;
    const companyData = company as any;
    const availableShares = Math.max(0, companyData.total_shares - ownedShares);

    let myTrades: any[] = [];
    const session = await getServerSession(authOptions);
    if (session?.user) {
      const userId = (session.user as any).id;

      const transactions = await db.prepare(
        "SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 25"
      ).all(id, userId);

      for (const tx of transactions as any[]) {
        myTrades.push({ ...tx, status: "confirmed" });
      }

      const myPendingOrders = await db.prepare(
        "SELECT id, type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC"
      ).all(id, userId);

      for (const o of myPendingOrders as any[]) {
        myTrades.push({
          type: String(o.type),
          shares: o.shares,
          price_per_share: o.price_per_share,
          total_amount: o.shares * o.price_per_share,
          created_at: o.created_at,
          status: "pending",
          order_id: o.id,
        });
      }

      const myCancelledOrders = await db.prepare(
        "SELECT type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'cancelled' ORDER BY created_at DESC LIMIT 20"
      ).all(id, userId);

      for (const o of myCancelledOrders as any[]) {
        myTrades.push({
          type: String(o.type),
          shares: o.shares,
          price_per_share: o.price_per_share,
          total_amount: o.shares * o.price_per_share,
          created_at: o.created_at,
          status: "cancelled",
        });
      }

      myTrades.sort((a, b) => {
        const aTime = a.created_at || "";
        const bTime = b.created_at || "";
        return bTime > aTime ? 1 : bTime < aTime ? -1 : 0;
      });
    }

    const recentTransactions = await db.prepare(
      "SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT 50"
    ).all(id);

    return NextResponse.json({
      ...company,
      price_history: priceHistory,
      available_shares: availableShares,
      my_trades: myTrades,
      recent_transactions: recentTransactions,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Error fetching stock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
