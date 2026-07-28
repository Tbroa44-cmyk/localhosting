export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import getDb, { getLowestPendingSellsBulk } from "@/lib/db";
import { getTradingInfo } from "@/lib/trading-hours";

function getAESTNow(): Date {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utcMs + 10 * 3600_000);
}

function computeSessionStart(openHour: number, tradingDays: number[]): number {
  const aest = getAESTNow();
  const todayDow = aest.getDay();
  const startOfToday = new Date(Date.UTC(aest.getFullYear(), aest.getMonth(), aest.getDate(), openHour, 0, 0));

  const isTradingDay = tradingDays.includes(todayDow);
  const isAfterOpen = aest.getHours() >= openHour;

  if (isTradingDay && isAfterOpen) {
    return startOfToday.getTime();
  }

  for (let i = 1; i <= 7; i++) {
    const d = new Date(aest);
    d.setDate(d.getDate() - i);
    if (tradingDays.includes(d.getDay())) {
      const sessionStart = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), openHour, 0, 0));
      return sessionStart.getTime();
    }
  }

  return startOfToday.getTime() - 24 * 3600_000;
}

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const [companiesRaw, tradingInfo] = await Promise.all([
      db.prepare("SELECT * FROM companies ORDER BY ticker").all(),
      getTradingInfo().catch(() => ({ isOpen: true, openHour: 0, closeHour: 24 })),
    ]);
    const companies = companiesRaw as any[];

    const lowestSells = await getLowestPendingSellsBulk();

    const settingsRaw = await db.prepare("SELECT trading_days FROM settings WHERE id = 1").get();
    const settings = settingsRaw as any;
    const tradingDays = settings?.trading_days ? String(settings.trading_days).split(",").map(Number) : [0, 1, 2, 3, 4, 5, 6];
    const sessionStart = computeSessionStart(tradingInfo.openHour || 0, tradingDays);

    const results = await Promise.allSettled(companies.map(async (company) => {
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

      const [allHistory, pendingSellRows, txCountRows] = await Promise.all([
        db.prepare("SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 200").all(company.id) as Promise<any[]>,
        db.prepare("SELECT shares FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending'").all(company.id) as Promise<any[]>,
        db.prepare("SELECT id, type FROM transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT 500").all(company.id) as Promise<any[]>,
      ]);

      allHistory.reverse();

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
      if (Array.isArray(txCountRows)) {
        for (const r of txCountRows) {
          if (String(r.type).includes("buy")) buyCount++;
          else sellCount++;
        }
      }

      let holderCount = 0;
      try {
        const holderRows = await db.prepare("SELECT id FROM holdings WHERE company_id = ? AND shares_owned > 0").all(company.id) as any[];
        holderCount = Array.isArray(holderRows) ? holderRows.length : 0;
      } catch {}

      const shares_available = Array.isArray(pendingSellRows) ? pendingSellRows.reduce((s: number, r: any) => s + (Number(r.shares) || 0), 0) : 0;

      const sessionHistory = allHistory.filter((h: any) => Number(h.timestamp) >= sessionStart);
      const recentPrices = sessionHistory.length >= 2
        ? sessionHistory.map((h: any) => Number(h.price) || 0)
        : allHistory.slice(-20).map((h: any) => Number(h.price) || 0);

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
