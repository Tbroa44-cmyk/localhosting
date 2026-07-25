export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const id = Number(params.id);
    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid company ID" }, { status: 400 });
    }

    const { total_shares } = await request.json();
    const db = getDb();

    const company = await db.prepare("SELECT total_shares FROM companies WHERE id = ?").get(id) as any;
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const currentShares = Number(company.total_shares) || 0;
    const newShares = Number(total_shares);

    if (!newShares || newShares <= currentShares) {
      return NextResponse.json({ error: `New share count must be higher than current (${currentShares})` }, { status: 400 });
    }

    const sharesAdded = newShares - currentShares;

    await db.prepare("UPDATE companies SET total_shares = ? WHERE id = ?").run(newShares, id);

    await db.prepare(
      "INSERT INTO share_events (company_id, shares_added, created_at) VALUES (?, ?, ?)"
    ).run(id, sharesAdded, new Date().toISOString());

    return NextResponse.json({ message: `Added ${sharesAdded} shares. Total now: ${newShares}` });
  } catch (error: any) {
    console.error("Admin update error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
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

    await db.prepare("DELETE FROM orders WHERE company_id = ?").run(id);
    await db.prepare("DELETE FROM price_history WHERE company_id = ?").run(id);
    await db.prepare("DELETE FROM holdings WHERE company_id = ?").run(id);
    await db.prepare("DELETE FROM transactions WHERE company_id = ?").run(id);
    await db.prepare("DELETE FROM companies WHERE id = ?").run(id);

    return NextResponse.json({ message: "Company deleted" });
  } catch (error) {
    console.error("Admin delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
