export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import getDb from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();
    const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number } | undefined;

    return NextResponse.json({ balance: user?.balance || 0 });
  } catch (error) {
    console.error("Balance fetch error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
