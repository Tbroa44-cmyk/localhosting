export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(_request: Request, { params }: { params: { companyId: string } }) {
  try {
    const db = getDb();
    const companyId = parseInt(params.companyId, 10);
    if (isNaN(companyId)) {
      return NextResponse.json({ error: "Invalid company ID" }, { status: 400 });
    }

    const releases = await db.prepare(
      "SELECT id, content, type, created_at FROM press_releases WHERE company_id = ? ORDER BY created_at DESC LIMIT 1"
    ).all(companyId) as any[];

    const latest = Array.isArray(releases) && releases.length > 0 ? releases[0] : null;
    return NextResponse.json({ press_release: latest });
  } catch (error) {
    console.error("Press release fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
