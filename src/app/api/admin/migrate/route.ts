export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = getDb();
    try {
      await db.prepare(`CREATE TABLE IF NOT EXISTS share_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER NOT NULL,
        shares_added INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`).run();
    } catch {
      // table might already exist or create not supported
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
