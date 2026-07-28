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

    const [priceHistoryResult, pendingSellRowsResult, session] = await Promise.all([
      db.prepare("SELECT price, timestamp, holder_count FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 200").all(id),
      db.prepare("SELECT shares FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending'").all(id),
      getServerSession(authOptions),
    ]);

    const priceHistory = priceHistoryResult as any[];
    const pendingSellRows = pendingSellRowsResult as any[];

    priceHistory.reverse();

    const effectiveSellPrice = await getLowestPendingSell(id);
    const effectivePrice = (effectiveSellPrice !== null && effectiveSellPrice < basePrice) ? effectiveSellPrice : basePrice;
    (company as any).share_price = effectivePrice;

    const companyData = company as any;
    const availableShares = Array.isArray(pendingSellRows) ? pendingSellRows.reduce((s: number, r: any) => s + (Number(r.shares) || 0), 0) : 0;

    let shareEvent: any = null;
    const initialShares = Number(companyData.initial_shares) || Number(companyData.total_shares);
    const currentShares = Number(companyData.total_shares);
    const sharesReleased = currentShares > initialShares ? currentShares - initialShares : 0;
    if (sharesReleased > 0) {
      shareEvent = { shares_added: sharesReleased };
    }

    let myTrades: any[] = [];
    let recentTransactions: any[] = [];

    if (session?.user) {
      const userId = (session.user as any).id;

      const [transactions, myPendingOrders, myCancelledOrders, recentTx, pendingSells] = await Promise.all([
        db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 25").all(id, userId),
        db.prepare("SELECT id, type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC").all(id, userId),
        db.prepare("SELECT type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'cancelled' ORDER BY created_at DESC LIMIT 20").all(id, userId),
        db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC ").all(id),
        db.prepare("SELECT type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' ORDER BY created_at DESC LIMIT 25").all(id),
      ]);

      for (const tx of transactions as any[]) {
        myTrades.push({ ...tx, status: "confirmed" });
      }
      for (const o of myPendingOrders as any[]) {
        myTrades.push({ type: String(o.type), shares: o.shares, price_per_share: o.price_per_share, total_amount: o.shares * o.price_per_share, created_at: o.created_at, status: "pending", order_id: o.id });
      }
      for (const o of myCancelledOrders as any[]) {
        myTrades.push({ type: String(o.type), shares: o.shares, price_per_share: o.price_per_share, total_amount: o.shares * o.price_per_share, created_at: o.created_at, status: "cancelled" });
      }
      myTrades.sort((a, b) => (b.created_at || "") > (a.created_at || "") ? 1 : (b.created_at || "") < (a.created_at || "") ? -1 : 0);

      for (const tx of recentTx as any[]) { tx.status = "confirmed"; recentTransactions.push(tx); }
      for (const o of pendingSells as any[]) {
        recentTransactions.push({ type: o.type, shares: o.shares, price_per_share: o.price_per_share, total_amount: o.shares * o.price_per_share, created_at: o.created_at, status: "pending" });
      }
    } else {
      const [recentTx, pendingSells] = await Promise.all([
        db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC ").all(id),
        db.prepare("SELECT type, shares, price_per_share, created_at FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' ORDER BY created_at DESC LIMIT 25").all(id),
      ]);
      for (const tx of recentTx as any[]) { tx.status = "confirmed"; recentTransactions.push(tx); }
      for (const o of pendingSells as any[]) {
        recentTransactions.push({ type: o.type, shares: o.shares, price_per_share: o.price_per_share, total_amount: o.shares * o.price_per_share, created_at: o.created_at, status: "pending" });
      }
    }

    recentTransactions.sort((a: any, b: any) => (b.created_at || "") > (a.created_at || "") ? 1 : (b.created_at || "") < (a.created_at || "") ? -1 : 0);

    return NextResponse.json({
      ...company,
      price_history: priceHistory,
      available_shares: availableShares,
      my_trades: myTrades,
      recent_transactions: recentTransactions,
      shareEvent,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Error fetching stock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
