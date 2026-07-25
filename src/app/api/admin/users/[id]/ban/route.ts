export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = Number(params.id);
    if (isNaN(userId)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const db = getDb();

    if (body.unban) {
      try {
        await db.prepare("UPDATE users SET allowed = 0, banned_until = NULL WHERE id = ?").run(userId);
      } catch {
        await db.prepare("UPDATE users SET allowed = 0 WHERE id = ?").run(userId);
      }
      return NextResponse.json({ success: true, banned: false, message: "User has been unbanned" });
    }

    const days = typeof body.days === "number" ? body.days : 0;
    let bannedUntil: string | null = null;
    if (days > 0) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      bannedUntil = d.toISOString();
    }

    try {
      await db.prepare("UPDATE users SET allowed = 1, banned_until = ?, ban_count = COALESCE(ban_count, 0) + 1 WHERE id = ?").run(bannedUntil, userId);
    } catch {
      try {
        await db.prepare("UPDATE users SET allowed = 1 WHERE id = ?").run(userId);
      } catch {}
    }

    const msg = bannedUntil
      ? `User banned for ${days} day${days > 1 ? "s" : ""} (until ${new Date(bannedUntil).toLocaleDateString()})`
      : "User has been banned indefinitely";

    return NextResponse.json({ success: true, banned: true, message: msg });
  } catch (error: any) {
    console.error("Ban error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
