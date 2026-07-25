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
      const user = await db.prepare("SELECT allowed FROM users WHERE id = ?").get(userId) as any;
      if (user && Number(user.allowed) === 1) {
        return NextResponse.json({ banned: true });
      }
    } catch {
      // column might not exist
    }

    return NextResponse.json({ banned: false });
  } catch {
    return NextResponse.json({ banned: false });
  }
}
