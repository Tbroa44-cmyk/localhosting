export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { userId, companyId, correctShares } = await request.json();

    if (!userId || !companyId || correctShares === undefined) {
      return NextResponse.json({ error: "Missing userId, companyId, or correctShares" }, { status: 400 });
    }

    const db = getDb();

    const existing = await db.prepare(
      "SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?"
    ).get(userId, companyId) as any;

    if (existing) {
      await db.prepare("UPDATE holdings SET shares_owned = ? WHERE id = ?").run(correctShares, existing.id);
    } else if (correctShares > 0) {
      await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(userId, companyId, correctShares);
    }

    return NextResponse.json({ message: `Holdings fixed: user ${userId}, company ${companyId} → ${correctShares} shares` });
  } catch (error: any) {
    console.error("Fix holdings error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const db = getDb();
    const allHoldings = await db.prepare(
      "SELECT h.user_id, h.company_id, h.shares_owned, u.username, c.name as company_name, c.ticker FROM holdings h JOIN users u ON h.user_id = u.id JOIN companies c ON h.company_id = c.id ORDER BY h.user_id"
    ).all() as any[];

    return NextResponse.json(allHoldings);
  } catch (error: any) {
    console.error("List holdings error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
