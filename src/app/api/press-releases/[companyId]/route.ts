export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import getDb from "@/lib/db";

export async function GET(request: Request, { params }: { params: { companyId: string } }) {
  try {
    const db = getDb();
    const companyId = parseInt(params.companyId, 10);
    if (isNaN(companyId)) {
      return NextResponse.json({ error: "Invalid company ID" }, { status: 400 });
    }

    const url = new URL(request.url);
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") || "3")));
    const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

    const releases = await db.prepare(
      "SELECT id, content, type, severity, created_at FROM press_releases WHERE company_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"
    ).all(companyId, limit, offset) as any[];

    const totalResult = await db.prepare("SELECT id FROM press_releases WHERE company_id = ?").all(companyId) as any[];
    const total = Array.isArray(totalResult) ? totalResult.length : 0;

    return NextResponse.json({ press_releases: Array.isArray(releases) ? releases : [], total });
  } catch (error) {
    console.error("Press release fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
