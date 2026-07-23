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

    const { name, description, share_price, total_shares } = await request.json();

    const db = getDb();
    await db.prepare("UPDATE companies SET name = COALESCE(?, name), description = COALESCE(?, description), share_price = COALESCE(?, share_price), total_shares = COALESCE(?, total_shares) WHERE id = ?").run(
      name || null, description || null, share_price || null, total_shares || null, id
    );

    return NextResponse.json({ message: "Company updated" });
  } catch (error) {
    console.error("Admin update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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
