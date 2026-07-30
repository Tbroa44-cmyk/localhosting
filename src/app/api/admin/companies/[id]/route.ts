export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";
import { issueCertificates } from "@/lib/certificates";

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

    const body = await request.json();
    const db = getDb();

    let company: any;
    try {
      company = await db.prepare("SELECT total_shares, delisted FROM companies WHERE id = ?").get(id) as any;
    } catch {
      company = await db.prepare("SELECT total_shares FROM companies WHERE id = ?").get(id) as any;
    }
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const updates: string[] = [];
    const paramsList: any[] = [];

    if (body.description !== undefined) {
      updates.push("description = ?");
      paramsList.push(body.description);
    }

    if (body.delisted !== undefined) {
      try {
        await db.prepare("UPDATE companies SET delisted = ? WHERE id = ?").run(body.delisted ? 1 : 0, id);
      } catch (e: any) {
        console.error("Failed to update delisted (column may not exist):", e?.message);
      }
    }

    const newShares = Number(body.total_shares);
    const currentShares = Number(company.total_shares) || 0;
    let sharesAdded = 0;

    if (newShares && newShares > currentShares) {
      sharesAdded = newShares - currentShares;
      updates.push("total_shares = ?");
      paramsList.push(newShares);
    }

    if (updates.length > 0) {
      paramsList.push(id);
      await db.prepare(`UPDATE companies SET ${updates.join(", ")} WHERE id = ?`).run(...paramsList);
    }

    if (sharesAdded > 0) {
      const admin = await db.prepare("SELECT id FROM users WHERE email = ?").get("T-ADMIN@stocksim.com") as { id: number } | undefined;
      if (admin) {
        const existingHolding = await db.prepare("SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(admin.id, id) as { id: number; shares_owned: number } | undefined;
        if (existingHolding) {
          await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(sharesAdded, existingHolding.id);
        } else {
          await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(admin.id, id, sharesAdded);
        }
        await issueCertificates(db, id, sharesAdded, admin.id);
      }
    }

    return NextResponse.json({ message: "Company updated" });
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

    const tables = ["orders", "price_history", "share_certificates", "holdings", "transactions"];
    for (const table of tables) {
      try {
        await db.prepare(`DELETE FROM ${table} WHERE company_id = ?`).run(id);
      } catch (e: any) {
        console.error(`Failed to delete from ${table}:`, e?.message);
      }
    }
    await db.prepare("DELETE FROM companies WHERE id = ?").run(id);

    return NextResponse.json({ message: "Company deleted" });
  } catch (error) {
    console.error("Admin delete error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
