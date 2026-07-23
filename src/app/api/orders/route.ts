import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { placeLimitOrder } from "@/lib/stock-engine";
import getDb from "@/lib/db";

async function isTradingOpen(): Promise<{ open: boolean; message: string }> {
  try {
    const db = getDb();
    const settings = await db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
    if (!settings || (settings.trading_enabled === 1 && settings.trading_open_hour === 0 && settings.trading_close_hour === 24)) {
      return { open: true, message: "" };
    }
    if (settings.trading_enabled === 0) return { open: false, message: "Markets closed by admin" };
    const hour = new Date().getHours();
    if (hour >= settings.trading_open_hour && hour < settings.trading_close_hour) return { open: true, message: "" };
    return { open: false, message: `Markets closed. Opens at ${settings.trading_open_hour}:00` };
  } catch { return { open: true, message: "" }; }
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const db = getDb();

    const orders = await db.prepare(
      "SELECT o.*, c.ticker, c.name, c.share_price as current_price FROM orders o JOIN companies c ON o.company_id = c.id WHERE o.user_id = ? ORDER BY o.created_at DESC"
    ).all(userId);

    return NextResponse.json(orders);
  } catch (error) {
    console.error("Get orders error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const trading = await isTradingOpen();
    if (!trading.open) {
      return NextResponse.json({ error: trading.message }, { status: 403 });
    }

    const userId = (session.user as any).id;
    const { companyId, type, shares, priceCents } = await request.json();

    if (!companyId || !type || !shares || !priceCents) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (type !== "buy" && type !== "sell") {
      return NextResponse.json({ error: "Type must be 'buy' or 'sell'" }, { status: 400 });
    }

    const result = await placeLimitOrder(userId, companyId, type, shares, priceCents);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Place order error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
