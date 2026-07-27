export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";
import { deposit } from "@/lib/bank-engine";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = (session.user as any).id;

    const db = getDb();
    try {
      const userInfo = await db.prepare("SELECT allowed FROM users WHERE id = ?").get(userId) as any;
      if (userInfo && Number(userInfo.allowed) === 1) {
        return NextResponse.json({ error: "Your account has been banned" }, { status: 403 });
      }
    } catch {}

    const { amount } = await request.json();
    if (!amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
    }

    const result = await deposit(userId, Math.round(amount));
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
