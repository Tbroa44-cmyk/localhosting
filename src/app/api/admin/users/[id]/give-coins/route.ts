import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const userId = parseInt(params.id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const { amountCents } = await request.json();
    if (!amountCents || amountCents <= 0 || !Number.isInteger(amountCents)) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.is_admin) {
      return NextResponse.json({ error: "Cannot give coins to admin" }, { status: 400 });
    }

    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(amountCents, userId);

    return NextResponse.json({ success: true, newBalance: user.balance + amountCents });
  } catch (error) {
    console.error("Give coins error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
