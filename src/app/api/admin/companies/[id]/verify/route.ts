export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";
import { countTotalForCompany } from "@/lib/certificates";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const id = Number(params.id);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid company ID" }, { status: 400 });
    }

    const db = getDb();
    const company = await db.prepare("SELECT total_shares FROM companies WHERE id = ?").get(id) as { total_shares: number } | undefined;
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const total = await countTotalForCompany(db, id);
    const expected = Number(company.total_shares);
    const ok = total === expected;

    return NextResponse.json({ ok, total, expected });
  } catch (error: any) {
    console.error("Verify error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
