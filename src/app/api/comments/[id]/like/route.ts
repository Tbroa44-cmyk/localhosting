export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import getDb from "@/lib/db";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const commentId = Number(params.id);
    if (isNaN(commentId)) return NextResponse.json({ error: "Invalid comment" }, { status: 400 });

    const db = getDb();

    try {
      const userInfo = await db.prepare("SELECT allowed FROM users WHERE id = ?").get(userId) as any;
      if (userInfo && Number(userInfo.allowed) === 1) {
        return NextResponse.json({ error: "Your account is banned" }, { status: 403 });
      }
    } catch {}

    const existing = await db.prepare(
      "SELECT id FROM comment_likes WHERE user_id = ? AND comment_id = ?"
    ).get(userId, commentId);

    if (existing) {
      await db.prepare("DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?").run(userId, commentId);
      await db.prepare("UPDATE comments SET likes = likes - 1 WHERE id = ? AND likes > 0").run(commentId);
      return NextResponse.json({ liked: false, message: "Like removed" });
    } else {
      await db.prepare("INSERT INTO comment_likes (user_id, comment_id, created_at) VALUES (?, ?, ?)").run(userId, commentId, new Date().toISOString());
      await db.prepare("UPDATE comments SET likes = likes + 1 WHERE id = ?").run(commentId);
      return NextResponse.json({ liked: true, message: "Liked!" });
    }
  } catch (error: any) {
    console.error("Like error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
