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

    const [priceHistoryResult, pendingSellRowsResult, pendingBuyRowsResult, holderResult, session] = await Promise.all([
      db.prepare("SELECT price, timestamp, holder_count FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 200").all(id),
      db.prepare("SELECT shares, created_at FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending'").all(id),
      db.prepare("SELECT shares, created_at FROM orders WHERE company_id = ? AND type = 'buy' AND status = 'pending'").all(id),
      db.prepare("SELECT user_id FROM holdings WHERE company_id = ? AND shares_owned > 0").all(id),
      getServerSession(authOptions),
    ]);

    const priceHistory = priceHistoryResult as any[];
    const pendingSellRows = pendingSellRowsResult as any[];
    const pendingBuyRows = pendingBuyRowsResult as any[];
    const holderCount = Array.isArray(holderResult) ? new Set(holderResult.map((r: any) => r.user_id)).size : 0;

    priceHistory.reverse();

    const companyData = company as any;
    const availableShares = Array.isArray(pendingSellRows) ? pendingSellRows.reduce((s: number, r: any) => s + (Number(r.shares) || 0), 0) : 0;

    const effectiveSellPrice = await getLowestPendingSell(id);
    let effectivePrice = (effectiveSellPrice !== null && effectiveSellPrice < basePrice) ? effectiveSellPrice : basePrice;
    const totalShares = Number(companyData.total_shares) || 1;
    if (availableShares > 0) {
      const supplyRatio = availableShares / totalShares;
      const supplyImpact = Math.min(supplyRatio * 3, 0.15);
      const supplyAdjusted = Math.round(effectivePrice * (1 - supplyImpact));
      if (supplyAdjusted < effectivePrice) {
        effectivePrice = supplyAdjusted;
      }
    }
    (company as any).share_price = effectivePrice;

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

      const [transactions, myPendingOrders, myCancelledOrders, recentTx] = await Promise.all([
        db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 25").all(id, userId),
        db.prepare("SELECT id, type, shares, original_shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC").all(id, userId),
        db.prepare("SELECT type, shares, original_shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'cancelled' ORDER BY created_at DESC LIMIT 20").all(id, userId),
        db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC ").all(id),
      ]);

      for (const tx of transactions as any[]) {
        myTrades.push({ ...tx, status: "confirmed" });
      }
      for (const o of myPendingOrders as any[]) {
        myTrades.push({ type: String(o.type), shares: o.shares, original_shares: Number(o.original_shares) || o.shares, price_per_share: o.price_per_share, total_amount: o.shares * o.price_per_share, created_at: o.created_at, status: "pending", order_id: o.id });
      }
      for (const o of myCancelledOrders as any[]) {
        myTrades.push({ type: String(o.type), shares: o.shares, original_shares: Number(o.original_shares) || o.shares, price_per_share: o.price_per_share, total_amount: o.shares * o.price_per_share, created_at: o.created_at, status: "cancelled" });
      }
      myTrades.sort((a, b) => (b.created_at || "") > (a.created_at || "") ? 1 : (b.created_at || "") < (a.created_at || "") ? -1 : 0);

      recentTransactions = recentTx as any[];
      for (const tx of recentTransactions) { tx.status = "confirmed"; }
    } else {
      const recentTx = await db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC ").all(id);
      recentTransactions = recentTx as any[];
      for (const tx of recentTransactions) { tx.status = "confirmed"; }
    }

    const allBuys = Array.isArray(pendingBuyRows) ? pendingBuyRows as { shares: number; created_at: string }[] : [];
    const allSells = Array.isArray(pendingSellRows) ? pendingSellRows as { shares: number; created_at: string }[] : [];
    const pendingBuyShares = allBuys.reduce((s, r) => s + (Number(r.shares) || 0), 0);
    const pendingSellShares = availableShares;
    const pendingBuyCount = allBuys.length;
    const pendingSellCount = allSells.length;

    const historicalBuyShares = priceHistory.map((ph: any) => {
      const ts = new Date(ph.timestamp).getTime();
      return allBuys.filter(o => new Date(o.created_at).getTime() <= ts).reduce((s, o) => s + (Number(o.shares) || 0), 0);
    });
    const historicalSellShares = priceHistory.map((ph: any) => {
      const ts = new Date(ph.timestamp).getTime();
      return allSells.filter(o => new Date(o.created_at).getTime() <= ts).reduce((s, o) => s + (Number(o.shares) || 0), 0);
    });

    return NextResponse.json({
      ...company,
      price_history: priceHistory,
      available_shares: availableShares,
      holder_count: holderCount,
      my_trades: myTrades,
      recent_transactions: recentTransactions,
      shareEvent,
      pending_buy_count: pendingBuyCount,
      pending_sell_count: pendingSellCount,
      pending_buy_shares: pendingBuyShares,
      pending_sell_shares: pendingSellShares,
      historical_buy_shares: historicalBuyShares,
      historical_sell_shares: historicalSellShares,
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Error fetching stock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
