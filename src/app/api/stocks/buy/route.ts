export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import { executeBuy } from "@/lib/stock-engine";
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
    console.log("[Buy] userId:", userId, "companyId:", companyId, "shares:", shares, "companyId type:", typeof companyId);

    if (!companyId || !shares || shares <= 0 || !Number.isInteger(shares)) {
      console.log("[Buy] Invalid params rejected");
      return NextResponse.json({ error: "Invalid parameters. Shares must be a positive whole number." }, { status: 400 });
    }

    if (requestId && typeof requestId !== "string") {
      return NextResponse.json({ error: "Invalid request ID" }, { status: 400 });
    }

    const result = await executeBuy(userId, companyId, shares, requestId);
    console.log("[Buy] success:", JSON.stringify(result));

    const r = result as any;
    if (r && !r.duplicate && (r.filledShares || 0) > 0) {
      const holdingRows = await db.prepare("SELECT shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").all(userId, companyId) as any[];
      const actualShares = (Array.isArray(holdingRows) ? holdingRows : []).reduce((s: number, h: any) => s + Number(h.shares_owned || 0), 0);
      if (actualShares < (r.filledShares || 0)) {
        console.warn(`[Buy] holdings missing! Expected ${r.filledShares}, got ${actualShares}. Healing...`);
        if (holdingRows.length > 0) {
          const keepId = holdingRows[0].id;
          const newTotal = actualShares + (r.filledShares || 0) - actualShares;
          await db.prepare("UPDATE holdings SET shares_owned = ? WHERE id = ?").run(newTotal, keepId);
        } else {
          await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(userId, companyId, r.filledShares || 0);
        }
      }
      r.shares_actual = Math.max(actualShares, r.filledShares || 0);
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Buy] error:", error.message, error.stack?.substring(0, 300));
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
