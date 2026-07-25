export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import getDb from "@/lib/db";
import { awardXP } from "@/lib/stock-engine";

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const companyId = Number(params.id);
    if (isNaN(companyId)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });

    const db = getDb();

    await db.prepare(
      "DELETE FROM comments WHERE company_id = ? AND id NOT IN (SELECT id FROM comments WHERE company_id = ? ORDER BY created_at DESC LIMIT 25)"
    ).run(companyId, companyId);

    const comments = await db.prepare(`
      SELECT c.id, c.user_id, c.company_id, c.comment, c.likes, c.created_at,
             u.username, u.level
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.company_id = ?
      ORDER BY c.created_at DESC
      LIMIT 25
    `).all(companyId) as any[];

    let userId: number | null = null;
    try {
      const session = await getServerSession(authOptions);
      userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);
    } catch {}

    let likedCommentIds: number[] = [];
    if (userId) {
      const likes = await db.prepare("SELECT comment_id FROM comment_likes WHERE user_id = ?").all(userId) as any[];
      likedCommentIds = likes.map((l: any) => l.comment_id);
    }

    const enriched = comments.map((c: any) => ({
      ...c,
      level: c.level || 1,
      liked: likedCommentIds.includes(c.id),
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Get comments error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const companyId = Number(params.id);
    if (isNaN(companyId)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });

    const { comment } = await request.json();
    if (!comment || typeof comment !== "string" || comment.trim().length === 0) {
      return NextResponse.json({ error: "Comment cannot be empty" }, { status: 400 });
    }

    const cleanComment = comment.trim().slice(0, 500);

    const db = getDb();

    try {
      const userInfo = await db.prepare("SELECT allowed FROM users WHERE id = ?").get(userId) as any;
      if (userInfo && Number(userInfo.allowed) === 1) {
        return NextResponse.json({ error: "Your account is banned" }, { status: 403 });
      }
    } catch {}

    const lastComment = await db.prepare(
      "SELECT created_at FROM comments WHERE user_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(userId, companyId) as any;

    if (lastComment) {
      const lastTime = new Date(lastComment.created_at).getTime();
      const now = Date.now();
      const hourMs = 60 * 60 * 1000;
      if (now - lastTime < hourMs) {
        const waitMins = Math.ceil((hourMs - (now - lastTime)) / 60000);
        return NextResponse.json({ error: `You can comment again in ${waitMins} minute${waitMins > 1 ? "s" : ""}` }, { status: 429 });
      }
    }

    await db.prepare(
      "INSERT INTO comments (user_id, company_id, comment, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, companyId, cleanComment, new Date().toISOString());

    await awardXP(db, userId, 3);

    const countResult = await db.prepare(
      "SELECT COUNT(*) as count FROM comments WHERE company_id = ?"
    ).get(companyId) as any;

    if (countResult && countResult.count > 25) {
      await db.prepare(
        "DELETE FROM comments WHERE company_id = ? AND id NOT IN (SELECT id FROM comments WHERE company_id = ? ORDER BY created_at DESC LIMIT 25)"
      ).run(companyId, companyId);
    }

    return NextResponse.json({ message: "Comment posted! +3 XP" });
  } catch (error: any) {
    console.error("Post comment error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
