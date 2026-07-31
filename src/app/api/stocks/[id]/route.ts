export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb, { getLowestPendingSell, getAdminUserIds } from "@/lib/db";

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

    const adminIds = await getAdminUserIds(db);
    const adminIdSet = new Set(adminIds.map((a) => Number(a)));

    const basePrice = Number((company as any).share_price) || 0;

    const [priceHistoryResult, allOrdersResult, holderResult, session] = await Promise.all([
      db.prepare("SELECT price, timestamp, holder_count FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 200").all(id),
      db.prepare("SELECT type, shares, original_shares, created_at, status, is_market_order, user_id FROM orders WHERE company_id = ?").all(id),
      db.prepare("SELECT user_id FROM holdings WHERE company_id = ? AND shares_owned > 0").all(id),
      getServerSession(authOptions),
    ]);

    const priceHistory = priceHistoryResult as any[];
    const allOrderRows = (allOrdersResult as any[]) || [];
    const pendingSellRows = allOrderRows.filter((o: any) => o.type === "sell" && o.status === "pending");
    const pendingBuyRows = allOrderRows.filter((o: any) => o.type === "buy" && o.status === "pending");
    const marketSellRows = pendingSellRows.filter((o: any) => !adminIdSet.has(Number(o.user_id)));
    const marketBuyRows = pendingBuyRows.filter((o: any) => !adminIdSet.has(Number(o.user_id)));
    const graphSellRows = allOrderRows.filter((o: any) => o.type === "sell" && (o.status === "pending" || o.status === "filled"));
    const graphBuyRows = allOrderRows.filter((o: any) => o.type === "buy" && (o.status === "pending" || o.status === "filled"));
    const holderCount = Array.isArray(holderResult) ? new Set(holderResult.map((r: any) => r.user_id)).size : 0;

    priceHistory.reverse();

    const companyData = company as any;
    const availableShares = Math.max(0, marketSellRows.reduce((s: number, r: any) => s + (Number(r.shares) || 0), 0));

    const effectiveSellPrice = await getLowestPendingSell(id, undefined, adminIds);
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
        db.prepare("SELECT id, type, shares, original_shares, price_per_share, created_at, is_market_order FROM orders WHERE company_id = ? AND user_id = ? AND status = 'pending' ORDER BY created_at DESC").all(id, userId),
        db.prepare("SELECT type, shares, original_shares, price_per_share, created_at FROM orders WHERE company_id = ? AND user_id = ? AND status = 'cancelled' ORDER BY created_at DESC LIMIT 20").all(id, userId),
        db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC ").all(id),
      ]);

      for (const tx of transactions as any[]) {
        myTrades.push({ ...tx, status: "confirmed" });
      }
      for (const o of myPendingOrders as any[]) {
        const normalizedShares = Math.max(0, Number(o.shares) || 0);
        myTrades.push({ type: String(o.type), shares: normalizedShares, original_shares: Number(o.original_shares) || Math.max(0, normalizedShares), price_per_share: o.price_per_share, total_amount: normalizedShares * o.price_per_share, created_at: o.created_at, status: normalizedShares <= 0 ? "confirmed" : "pending", order_id: o.id, is_market_order: o.is_market_order });
      }
      for (const o of myCancelledOrders as any[]) {
        myTrades.push({ type: String(o.type), shares: Math.max(0, o.shares), original_shares: Number(o.original_shares) || Math.max(0, o.shares), price_per_share: o.price_per_share, total_amount: Math.max(0, o.shares) * o.price_per_share, created_at: o.created_at, status: "cancelled" });
      }
      myTrades.sort((a, b) => (b.created_at || "") > (a.created_at || "") ? 1 : (b.created_at || "") < (a.created_at || "") ? -1 : 0);

      recentTransactions = recentTx as any[];
      for (const tx of recentTransactions) { tx.status = "confirmed"; }
    } else {
      const recentTx = await db.prepare("SELECT type, shares, price_per_share, total_amount, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC ").all(id);
      recentTransactions = recentTx as any[];
      for (const tx of recentTransactions) { tx.status = "confirmed"; }
    }

    const allBuys = Array.isArray(marketBuyRows) ? marketBuyRows as { shares: number; created_at: string }[] : [];
    const allSells = Array.isArray(marketSellRows) ? marketSellRows as { shares: number; created_at: string }[] : [];
    const pendingBuyShares = allBuys.reduce((s, r) => s + (Number(r.shares) || 0), 0);
    const pendingSellShares = availableShares;
    const pendingBuyCount = allBuys.length;
    const pendingSellCount = allSells.length;

    const orderBookShares = (o: any) => Math.max(0, Number(o.original_shares) || Number(o.shares) || 0);

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
      pending_buy_orders: graphBuyRows.map((o) => ({ shares: orderBookShares(o), created_at: o.created_at, is_market_order: o.is_market_order })),
      pending_sell_orders: graphSellRows.map((o) => ({ shares: orderBookShares(o), created_at: o.created_at, is_market_order: o.is_market_order })),
    }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Error fetching stock:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
