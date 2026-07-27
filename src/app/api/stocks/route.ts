export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import getDb, { getLowestPendingSellsBulk } from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const companies = await db.prepare("SELECT * FROM companies ORDER BY ticker").all() as any[];

    const lowestSells = await getLowestPendingSellsBulk();

    const results = await Promise.allSettled(companies.map(async (company) => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

      const allHistory = await db.prepare(
        "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp ASC"
      ).all(company.id) as any[];

      const todayHistory = allHistory.filter((h: any) => Number(h.timestamp) >= oneDayAgo);
      const monthHistory = allHistory.filter((h: any) => Number(h.timestamp) >= oneMonthAgo);

      const basePrice = Number(company.share_price) || 0;
      const effectiveSellPrice = lowestSells.get(company.id);
      const currentPrice = (effectiveSellPrice !== undefined && effectiveSellPrice < basePrice) ? effectiveSellPrice : basePrice;

      const dayStart = todayHistory.length > 0 ? Number(todayHistory[0].price) : currentPrice;
      const dayChange = currentPrice - dayStart;
      const dayChangePercent = dayStart > 0 ? ((dayChange / dayStart) * 100) : 0;

      const monthStart = monthHistory.length > 0 ? Number(monthHistory[0].price) : currentPrice;
      const monthChange = currentPrice - monthStart;
      const monthChangePercent = monthStart > 0 ? ((monthChange / monthStart) * 100) : 0;

      let buyCount = 0;
      let sellCount = 0;
      try {
        const buyRows = await db.prepare("SELECT id FROM transactions WHERE company_id = ? AND type = 'buy' ORDER BY created_at DESC LIMIT 1000").all(company.id) as any[];
        buyCount = Array.isArray(buyRows) ? buyRows.length : 0;
      } catch {}

      try {
        const sellRows = await db.prepare("SELECT id FROM transactions WHERE company_id = ? AND type = 'sell' ORDER BY created_at DESC LIMIT 1000").all(company.id) as any[];
        sellCount = Array.isArray(sellRows) ? sellRows.length : 0;
      } catch {}

      let holderCount = 0;
      try {
        const holderRows = await db.prepare("SELECT id FROM holdings WHERE company_id = ? AND shares_owned > 0").all(company.id) as any[];
        holderCount = Array.isArray(holderRows) ? holderRows.length : 0;
      } catch {}

      const pendingSellRows = await db.prepare(
        "SELECT shares FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending'"
      ).all(company.id) as any[];
      const shares_available = Array.isArray(pendingSellRows) ? pendingSellRows.reduce((s: number, r: any) => s + (Number(r.shares) || 0), 0) : 0;

      const recentPrices = allHistory.slice(-20).map((h: any) => Number(h.price) || 0);

      const initialShares = Number(company.initial_shares) || Number(company.total_shares);
      const currentShares = Number(company.total_shares);
      const sharesReleased = currentShares > initialShares ? currentShares - initialShares : 0;

      return {
        ...company,
        share_price: currentPrice,
        dayChangePercent: Math.round(dayChangePercent * 100) / 100,
        monthChangePercent: Math.round(monthChangePercent * 100) / 100,
        buyCount,
        sellCount,
        holderCount,
        shares_available,
        recentPrices,
        shareEvent: sharesReleased > 0 ? { shares_added: sharesReleased } : null,
      };
    }));

    const enriched = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map((r) => r.value);

    return NextResponse.json(enriched, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Error fetching stocks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
