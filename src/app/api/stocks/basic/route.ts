export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const companies = await db.prepare("SELECT id, ticker, name, logo, share_price, initial_shares, total_shares FROM companies ORDER BY ticker").all() as any[];

    const enriched = companies.map((c) => ({
      id: c.id,
      ticker: c.ticker,
      name: c.name,
      logo: c.logo,
      share_price: Number(c.share_price) || 0,
      dayChangePercent: 0,
      monthChangePercent: 0,
      buyCount: 0,
      sellCount: 0,
      holderCount: 0,
      shares_available: 0,
      recentPrices: [],
      shareEvent: null,
    }));

    return NextResponse.json(enriched, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("Error fetching basic stocks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
