export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const settings = await db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;

    if (!settings || settings.trading_enabled === 1 && settings.trading_open_hour === 0 && settings.trading_close_hour === 24) {
      return NextResponse.json({ isOpen: true, message: "Markets open 24/7" });
    }

    if (settings.trading_enabled === 0) {
      return NextResponse.json({ isOpen: false, message: "Markets closed by admin" });
    }

    const now = new Date();
    // Queensland AEST is UTC+10 (no daylight saving)
    const currentHour = (now.getUTCHours() + 10) % 24;
    const isOpen = currentHour >= settings.trading_open_hour && currentHour < settings.trading_close_hour;

    return NextResponse.json({
      isOpen,
      message: isOpen
        ? `Markets open ${settings.trading_open_hour}:00 - ${settings.trading_close_hour}:00`
        : `Markets closed. Opens at ${settings.trading_open_hour}:00`,
      openHour: settings.trading_open_hour,
      closeHour: settings.trading_close_hour,
    });
  } catch (error) {
    return NextResponse.json({ isOpen: true, message: "Markets open" });
  }
}
