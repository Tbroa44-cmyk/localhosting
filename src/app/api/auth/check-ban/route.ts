export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ banned: false });
    }

    const userId = (session.user as any).id;
    const db = getDb();

    try {
      const user = await db.prepare("SELECT allowed, banned_until FROM users WHERE id = ?").get(userId) as any;
      if (user && Number(user.allowed) === 1) {
        if (user.banned_until && new Date(user.banned_until) < new Date()) {
          await db.prepare("UPDATE users SET allowed = 0, banned_until = NULL WHERE id = ?").run(userId);
          return NextResponse.json({ banned: false });
        }
        return NextResponse.json({ banned: true, bannedUntil: user.banned_until || null });
      }
    } catch {
      // columns might not exist
    }

    return NextResponse.json({ banned: false });
  } catch {
    return NextResponse.json({ banned: false });
  }
}
