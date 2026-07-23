import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { placeLimitOrder } from "@/lib/stock-engine";
import getDb from "@/lib/db";

function isTradingOpen(): { open: boolean; message: string } {
  try {
    const db = getDb();
    const settings = db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
    if (!settings || (settings.trading_enabled === 1 && settings.trading_open_hour === 0 && settings.trading_close_hour === 24)) {
      return { open: true, message: "" };
    }
    if (settings.trading_enabled === 0) return { open: false, message: "Markets closed by admin" };
    const hour = new Date().getHours();
    if (hour >= settings.trading_open_hour && hour < settings.trading_close_hour) return { open: true, message: "" };
    return { open: false, message: `Markets closed. Opens at ${settings.trading_open_hour}:00` };
  } catch { return { open: true, message: "" }; }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const trading = isTradingOpen();
    if (!trading.open) {
      return NextResponse.json({ error: trading.message }, { status: 403 });
    }

    const { companyId, shares } = await request.json();
    const userId = (session.user as any).id;

    if (!companyId || !shares || shares <= 0 || !Number.isInteger(shares)) {
      return NextResponse.json({ error: "Invalid parameters. Shares must be a positive whole number." }, { status: 400 });
    }

    const db = getDb();
    const company = db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as any;
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const result = placeLimitOrder(userId, companyId, "sell", shares, company.share_price);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Sell error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
