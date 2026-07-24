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

    const holdings = await db.prepare(`
      SELECT h.id, h.shares_owned, h.company_id,
             c.name as company_name, c.ticker, c.share_price, c.total_shares
      FROM holdings h
      JOIN companies c ON h.company_id = c.id
      WHERE h.user_id = ?
      ORDER BY c.ticker
    `).all(userId);

    console.log("[Portfolio] userId:", userId, "holdings count:", (holdings as any[]).length, "holdings:", JSON.stringify(holdings));

    const totalValue = (holdings as any[]).reduce(
      (sum: number, h: any) => sum + Number(h.share_price) * Number(h.shares_owned),
      0
    );

    console.log("[Portfolio] totalValue:", totalValue);

    const transactions = await db.prepare(`
      SELECT t.*, c.name as company_name, c.ticker
      FROM transactions t
      JOIN companies c ON t.company_id = c.id
      WHERE t.user_id = ?
      ORDER BY t.id DESC
      LIMIT 25
    `).all(userId);

    const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    const priceHistories: Record<number, { price: number; timestamp: number }[]> = {};
    for (const h of holdings as any[]) {
      priceHistories[h.company_id] = await db.prepare(
        "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp ASC"
      ).all(h.company_id) as { price: number; timestamp: number }[];
    }

    return NextResponse.json({ holdings, totalValue, transactions, user, priceHistories });
  } catch (error) {
    console.error("Portfolio error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
