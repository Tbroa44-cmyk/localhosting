export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();
    const settings = await db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
    return NextResponse.json(settings || {
      trading_enabled: 1, trading_open_hour: 0, trading_close_hour: 24,
      emergency_close: 0, emergency_message: "Markets under maintenance", trading_days: "1,2,3,4,5,6,7",
    });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const db = getDb();

    const current = await db.prepare("SELECT * FROM settings WHERE id = 1").get() as any;
    if (!current) {
      await db.prepare(
        "INSERT INTO settings (id, trading_enabled, trading_open_hour, trading_close_hour, emergency_close, emergency_message, trading_days) VALUES (1, ?, ?, ?, ?, ?, ?)"
      ).run(
        body.trading_enabled ?? 1,
        body.trading_open_hour ?? 0,
        body.trading_close_hour ?? 24,
        body.emergency_close ?? 0,
        body.emergency_message ?? "Markets under maintenance",
        body.trading_days ?? "1,2,3,4,5,6,7"
      );
    } else {
      const updates: string[] = [];
      const values: any[] = [];
      if (body.trading_enabled !== undefined) { updates.push("trading_enabled = ?"); values.push(body.trading_enabled); }
      if (body.trading_open_hour !== undefined) { updates.push("trading_open_hour = ?"); values.push(body.trading_open_hour); }
      if (body.trading_close_hour !== undefined) { updates.push("trading_close_hour = ?"); values.push(body.trading_close_hour); }
      if (body.emergency_close !== undefined) { updates.push("emergency_close = ?"); values.push(body.emergency_close); }
      if (body.emergency_message !== undefined) { updates.push("emergency_message = ?"); values.push(body.emergency_message); }
      if (body.trading_days !== undefined) { updates.push("trading_days = ?"); values.push(body.trading_days); }
      if (updates.length > 0) {
        values.push(1);
        await db.prepare(`UPDATE settings SET ${updates.join(", ")} WHERE id = ?`).run(...values);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
