export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const db = getDb();

    const payments = await db.prepare(
      "SELECT id, amount_cents, coins, status, created_at FROM kofi_payments WHERE user_id = ? ORDER BY created_at DESC LIMIT 10"
    ).all(userId);

    return NextResponse.json({ payments: payments || [] });
  } catch (error: any) {
    console.error("[Ko-fi Status] Error:", error?.message);
    return NextResponse.json({ payments: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as any).id;
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const db = getDb();

    const unclaimed = await db.prepare(
      "SELECT id, coins FROM kofi_payments WHERE LOWER(email) = ? AND status = 'unclaimed'"
    ).all(email.toLowerCase().trim()) as any[];

    if (!unclaimed || unclaimed.length === 0) {
      return NextResponse.json({ found: false, message: "No unclaimed payments found for this email" });
    }

    let totalCoins = 0;
    for (const payment of unclaimed) {
      await db.prepare("UPDATE kofi_payments SET status = 'completed', user_id = ? WHERE id = ?").run(userId, payment.id);
      totalCoins += payment.coins;
    }

    if (totalCoins > 0) {
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(totalCoins, userId);
    }

    return NextResponse.json({ found: true, coins: totalCoins, count: unclaimed.length });
  } catch (error: any) {
    console.error("[Ko-fi Claim] Error:", error?.message);
    return NextResponse.json({ error: "Claim failed" }, { status: 500 });
  }
}
