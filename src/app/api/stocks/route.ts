import { NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();
    const companies = await db.prepare("SELECT * FROM companies ORDER BY ticker").all() as any[];

    const enriched = await Promise.all(companies.map(async (company) => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

      const allHistory = await db.prepare(
        "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp ASC"
      ).all(company.id) as any[];

      const todayHistory = allHistory.filter((h: any) => h.timestamp >= oneDayAgo);
      const monthHistory = allHistory.filter((h: any) => h.timestamp >= oneMonthAgo);

      const currentPrice = company.share_price;

      const dayStart = todayHistory.length > 0 ? todayHistory[0].price : currentPrice;
      const dayChange = currentPrice - dayStart;
      const dayChangePercent = dayStart > 0 ? ((dayChange / dayStart) * 100) : 0;

      const monthStart = monthHistory.length > 0 ? monthHistory[0].price : currentPrice;
      const monthChange = currentPrice - monthStart;
      const monthChangePercent = monthStart > 0 ? ((monthChange / monthStart) * 100) : 0;

      const buyCount = (await db.prepare(
        "SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND type = 'buy'"
      ).all(company.id))[0] as { count: number };

      const sellCount = (await db.prepare(
        "SELECT COUNT(*) as count FROM transactions WHERE company_id = ? AND type = 'sell'"
      ).all(company.id))[0] as { count: number };

      const holderCount = (await db.prepare(
        "SELECT COUNT(*) as count FROM holdings WHERE company_id = ? AND shares_owned > 0"
      ).all(company.id))[0] as { count: number };

      const recentPrices = allHistory.slice(-20).map((h: any) => h.price);

      return {
        ...company,
        dayChangePercent: Math.round(dayChangePercent * 100) / 100,
        monthChangePercent: Math.round(monthChangePercent * 100) / 100,
        buyCount: buyCount?.count || 0,
        sellCount: sellCount?.count || 0,
        holderCount: holderCount?.count || 0,
        recentPrices,
      };
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Error fetching stocks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
