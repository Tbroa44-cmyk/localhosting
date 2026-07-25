export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import getDb from "@/lib/db";

const COIN_TIERS: Record<number, number> = {
  100: 100,
  500: 550,
  1000: 1200,
  5000: 6500,
};

function coinsForAmount(amount: number): number {
  if (amount >= 4500) return COIN_TIERS[5000];
  if (amount >= 900) return COIN_TIERS[1000];
  if (amount >= 400) return COIN_TIERS[500];
  return COIN_TIERS[100];
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const verificationToken = body.verification_token;
    const webhookSecret = process.env.KO_FI_WEBHOOK_SECRET;
    if (webhookSecret && verificationToken !== webhookSecret) {
      console.error("[Ko-fi Webhook] Invalid verification token");
      return NextResponse.json({ error: "Invalid token" }, { status: 403 });
    }

    const email = body.email?.toLowerCase()?.trim();
    const fromName = body.from_name || "";
    const amount = parseFloat(body.amount) || 0;
    const kofiUrl = body.url || "";
    const message = body.message || "";

    if (!email || amount <= 0) {
      return NextResponse.json({ error: "Missing email or amount" }, { status: 400 });
    }

    if (kofiUrl) {
      const db = getDb();
      const existing = await db.prepare("SELECT id FROM kofi_payments WHERE kofi_url = ?").get(kofiUrl);
      if (existing) {
        return NextResponse.json({ message: "Already processed" });
      }
    }

    const coins = coinsForAmount(Math.round(amount * 100));
    const db = getDb();

    const user = await db.prepare("SELECT id, username FROM users WHERE LOWER(email) = ?").get(email) as any;

    const userId = user?.id || null;
    const username = user?.username || fromName;

    await db.prepare(
      "INSERT INTO kofi_payments (kofi_url, email, from_name, amount_cents, coins, user_id, status, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(kofiUrl, email, fromName, Math.round(amount * 100), coins, userId, userId ? "completed" : "unclaimed", JSON.stringify(body));

    if (userId) {
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(coins, userId);
      console.log(`[Ko-fi Webhook] Credited ${coins}c to user ${username} (${userId}) for $${amount}`);
    } else {
      console.log(`[Ko-fi Webhook] Unclaimed payment: ${email} paid $${amount} (${coins}c) - no matching user`);
    }

    return NextResponse.json({ message: "OK", credited: !!userId, coins });
  } catch (error: any) {
    console.error("[Ko-fi Webhook] Error:", error?.message);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
