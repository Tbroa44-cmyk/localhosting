import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { paypalOrderId } = await request.json();
    const userId = (session.user as any).id;

    const db = getDb();

    const purchase = db.prepare("SELECT * FROM currency_purchases WHERE paypal_order_id = ? AND user_id = ?").get(paypalOrderId, userId) as any;

    if (!purchase) {
      return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
    }

    if (purchase.status === "completed") {
      return NextResponse.json({ message: "Already processed", balance: 0 });
    }

    db.prepare("UPDATE currency_purchases SET status = 'completed' WHERE id = ?").run(purchase.id);
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(purchase.amount_cents, userId);

    const user = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    return NextResponse.json({
      message: "Payment processed",
      balance: user.balance,
      added: purchase.amount_cents,
    });
  } catch (error) {
    console.error("Topup error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
