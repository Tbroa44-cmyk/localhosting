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

    const db = getDb();
    const user = await db.prepare("SELECT id, allowed FROM users WHERE id = ?").get(userId) as any;
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const newAllowed = user.allowed === 1 ? 0 : 1;
    await db.prepare("UPDATE users SET allowed = ? WHERE id = ?").run(newAllowed, userId);

    return NextResponse.json({
      success: true,
      banned: newAllowed === 1,
      message: newAllowed === 1 ? "User has been banned" : "User has been unbanned"
    });
  } catch (error: any) {
    console.error("Ban toggle error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
