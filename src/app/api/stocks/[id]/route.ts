import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function GET(request: Request, { params }: { params: { id: string } }) {
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

    const priceHistory = await db.prepare(
      "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp ASC"
    ).all(id);

    const pendingBuys = await db.prepare(
      "SELECT id, user_id, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND type = 'buy' AND status = 'pending' AND price_per_share > 0 ORDER BY price_per_share DESC, created_at ASC LIMIT 20"
    ).all(id);

    const pendingSells = await db.prepare(
      "SELECT id, user_id, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' AND price_per_share > 0 ORDER BY price_per_share ASC, created_at ASC LIMIT 20"
    ).all(id);

    const totalOwned = await db.prepare(
      "SELECT SUM(shares_owned) as total FROM holdings WHERE company_id = ?"
    ).all(id) as { total: number }[];

    const ownedShares = totalOwned[0]?.total || 0;
    const companyData = company as any;
    let sellOrderShares = 0;
    for (const s of pendingSells as any[]) sellOrderShares += s.shares;
    const availableShares = Math.max(0, companyData.total_shares - ownedShares) + sellOrderShares;

    let myTrades: any[] = [];
    let recentTransactions: any[] = [];
    const session = await getServerSession(authOptions);
    if (session?.user) {
      const userId = (session.user as any).id;

      const transactions = await db.prepare(
        "SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? AND user_id = ? AND price_per_share > 0 ORDER BY created_at DESC LIMIT 25"
      ).all(id, userId);

      const filledOrders = await db.prepare(
        "SELECT type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'filled' AND price_per_share > 0 ORDER BY created_at DESC LIMIT 50"
      ).all(id, userId);

      for (const tx of transactions as any[]) {
        myTrades.push({ ...tx, status: "confirmed" });
      }
      for (const fo of filledOrders as any[]) {
        const alreadyCounted = myTrades.some(
          (t) => t.type === fo.type && t.shares === fo.shares && t.price_per_share === fo.price_per_share && t.created_at === fo.created_at
        );
        if (!alreadyCounted) {
          myTrades.push({ ...fo, status: "confirmed" });
        }
      }

      const myPendingOrders = await db.prepare(
        "SELECT id, type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'pending' AND price_per_share > 0 ORDER BY created_at DESC"
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
        "SELECT type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'cancelled' AND price_per_share > 0 ORDER BY created_at DESC LIMIT 20"
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
    } else {
      recentTransactions = await db.prepare(
        "SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? AND price_per_share > 0 ORDER BY created_at DESC LIMIT 25"
      ).all(id);
    }

    return NextResponse.json({
      ...company,
      price_history: priceHistory,
      pending_buys: pendingBuys,
      pending_sells: pendingSells,
      available_shares: availableShares,
      my_trades: myTrades,
      recent_transactions: recentTransactions,
    });
  } catch (error) {
    console.error("Error fetching stock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
