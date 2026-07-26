export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const db = getDb();
    const ranges = await db.prepare("SELECT * FROM custom_date_ranges ORDER BY id DESC").all();
    return NextResponse.json(ranges || []);
  } catch (error) {
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { start_date, end_date, label, enabled } = body;

    if (!start_date || !end_date) {
      return NextResponse.json({ error: "start_date and end_date required" }, { status: 400 });
    }

    if (start_date > end_date) {
      return NextResponse.json({ error: "Start date must be before end date" }, { status: 400 });
    }

    const db = getDb();
    const result = await db.prepare(
      "INSERT INTO custom_date_ranges (start_date, end_date, label, enabled) VALUES (?, ?, ?, ?)"
    ).run(start_date, end_date, label || null, enabled ?? 1);

    return NextResponse.json({ success: true, id: result?.lastInsertRowid });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, enabled } = body;

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const db = getDb();
    if (enabled !== undefined) {
      await db.prepare("UPDATE custom_date_ranges SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const db = getDb();
    await db.prepare("DELETE FROM custom_date_ranges WHERE id = ?").run(Number(id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
