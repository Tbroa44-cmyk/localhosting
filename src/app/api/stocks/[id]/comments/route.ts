export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import getDb from "@/lib/db";
import { awardXP } from "@/lib/stock-engine";

async function cleanupOldComments(db: any, companyId: number) {
  try {
    const all = await db.prepare(
      "SELECT id FROM comments WHERE company_id = ? ORDER BY created_at DESC"
    ).all(companyId) as any[];
    if (all.length > 25) {
      const idsToKeep = all.slice(0, 25).map((c: any) => c.id);
      for (const row of all) {
        if (!idsToKeep.includes(row.id)) {
          await db.prepare("DELETE FROM comments WHERE id = ?").run(row.id);
          await db.prepare("DELETE FROM comment_likes WHERE comment_id = ?").run(row.id);
        }
      }
    }
  } catch (e: any) {
    console.error("Comment cleanup error:", e?.message || e);
  }
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const companyId = Number(params.id);
    if (isNaN(companyId)) return NextResponse.json({ error: "Invalid company" }, { status: 400 });

    const db = getDb();

    let comments: any[] = [];
    try {
      comments = await db.prepare(
        "SELECT * FROM comments WHERE company_id = ? ORDER BY created_at DESC LIMIT 25"
      ).all(companyId) as any[];
    } catch {
      return NextResponse.json([]);
    }

    const userIds = [...new Set(comments.map((c: any) => c.user_id).filter(Boolean))];
    const userMap: Record<number, { username: string; level: number }> = {};

    for (const uid of userIds) {
      try {
        const u = await db.prepare("SELECT username, level FROM users WHERE id = ?").get(uid) as any;
        if (u) userMap[uid] = { username: u.username || "Unknown", level: u.level || 1 };
      } catch {}
    }

    let currentUserId: number | null = null;
    try {
      const session = await getServerSession(authOptions);
      currentUserId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);
    } catch {}

    let likedCommentIds: number[] = [];
    if (currentUserId) {
      try {
        const likes = await db.prepare("SELECT comment_id FROM comment_likes WHERE user_id = ?").all(currentUserId) as any[];
        likedCommentIds = likes.map((l: any) => l.comment_id);
      } catch {}
    }

    const enriched = comments.map((c: any) => ({
      id: c.id,
      user_id: c.user_id,
      company_id: c.company_id,
      comment: c.comment,
      likes: c.likes || 0,
      created_at: c.created_at,
      username: userMap[c.user_id]?.username || "Unknown",
      level: userMap[c.user_id]?.level || 1,
      liked: likedCommentIds.includes(c.id),
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Get comments error:", error);
    return NextResponse.json([], { status: 200 });
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

    try {
      const lastComment = await db.prepare(
        "SELECT created_at FROM comments WHERE user_id = ? AND company_id = ? ORDER BY created_at DESC LIMIT 1"
      ).get(userId, companyId) as any;

      if (lastComment) {
        const lastTime = new Date(lastComment.created_at).getTime();
        const now = Date.now();
        const hourMs = 60 * 60 * 1000;
        if (now - lastTime < hourMs) {
          const waitMins = Math.ceil((hourMs - (now - lastTime)) / 60000);
          return NextResponse.json({ error: `You can only comment on each stock page once per hour. Try again in ${waitMins} minute${waitMins > 1 ? "s" : ""}.`, rateLimited: true }, { status: 429 });
        }
      }
    } catch {}

    await db.prepare(
      "INSERT INTO comments (user_id, company_id, comment, created_at) VALUES (?, ?, ?, ?)"
    ).run(userId, companyId, cleanComment, new Date().toISOString());

    await awardXP(db, userId, 3);
    await cleanupOldComments(db, companyId);

    return NextResponse.json({ message: "Comment posted!" });
  } catch (error: any) {
    console.error("Post comment error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
