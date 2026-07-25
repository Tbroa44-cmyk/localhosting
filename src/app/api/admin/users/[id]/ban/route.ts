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
      await db.prepare("UPDATE users SET allowed = 0 WHERE id = ?").run(userId);
      return NextResponse.json({ success: true, banned: false, message: "User has been unbanned" });
    }

    await db.prepare("UPDATE users SET allowed = 1 WHERE id = ?").run(userId);
    return NextResponse.json({ success: true, banned: true, message: "User has been banned" });
  } catch (error: any) {
    console.error("Ban error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
