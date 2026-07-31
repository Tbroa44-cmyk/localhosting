export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import { placeLimitOrder } from "@/lib/stock-engine";
import getDb from "@/lib/db";
import { isMarketOrderRow } from "@/lib/stock-engine";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();

    const rawOrders = await db.prepare(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC"
    ).all(userId) as any[];

    const orders = [];
    for (const o of rawOrders) {
      const company = await db.prepare(
        "SELECT ticker, name, share_price FROM companies WHERE id = ?"
      ).get(o.company_id) as any;
      const normalizedShares = Math.max(0, Number(o.shares) || 0);
      orders.push({
        ...o,
        shares: normalizedShares,
        original_shares: Math.max(Number(o.original_shares || o.shares), 0),
        status: o.status === "pending" && normalizedShares <= 0 ? "filled" : o.status,
        is_market_order: isMarketOrderRow(o) ? 1 : 0,
        ticker: company?.ticker || "???",
        name: company?.name || "Unknown",
        current_price: company?.share_price || 0,
      });
    }

    return NextResponse.json(orders);
  } catch (error) {
    console.error("Get orders error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();
    try {
      const userInfo = await db.prepare("SELECT allowed FROM users WHERE id = ?").get(userId) as any;
      if (userInfo && Number(userInfo.allowed) === 0) {
        return NextResponse.json({ error: "Your account has been banned from trading" }, { status: 403 });
      }
    } catch {
      if ((session?.user as any)?.allowed === 0) {
        return NextResponse.json({ error: "Your account has been banned from trading" }, { status: 403 });
      }
    }

    const { companyId, type, shares, priceCents, requestId } = await request.json();

    if (!companyId || !type || !shares || !priceCents) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (type !== "buy" && type !== "sell") {
      return NextResponse.json({ error: "Type must be 'buy' or 'sell'" }, { status: 400 });
    }

    if (requestId && typeof requestId !== "string") {
      return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
    }

    const result = await placeLimitOrder(userId, companyId, type, shares, priceCents, requestId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Place order error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
