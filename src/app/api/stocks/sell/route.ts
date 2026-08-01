export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import { executeSell } from "@/lib/stock-engine";
import getDb from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    let userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const db = getDb();
    try {
      const userInfo = await db.prepare("SELECT allowed FROM users WHERE id = ?").get(userId) as any;
      if (userInfo && Number(userInfo.allowed) === 1) {
        return NextResponse.json({ error: "Your account has been banned from trading" }, { status: 403 });
      }
    } catch {
      if ((session?.user as any)?.allowed === 1) {
        return NextResponse.json({ error: "Your account has been banned from trading" }, { status: 403 });
      }
    }

    const { companyId, shares, requestId } = await request.json();
    console.log("[Sell] userId:", userId, "companyId:", companyId, "shares:", shares, "companyId type:", typeof companyId);

    if (!companyId || !shares || shares <= 0 || !Number.isInteger(shares)) {
      console.log("[Sell] Invalid params rejected");
      return NextResponse.json({ error: "Invalid parameters. Shares must be a positive whole number." }, { status: 400 });
    }

    if (requestId && typeof requestId !== "string") {
      return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
    }

    const result = await executeSell(userId, companyId, shares, requestId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Sell] error:", error.message, error.stack?.substring(0, 300));
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
