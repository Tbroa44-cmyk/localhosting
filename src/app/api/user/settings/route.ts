export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import bcrypt from "bcryptjs";
import getDb from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const userId = (session.user as any).id;
    const { currentPassword, newEmail, newPassword } = await request.json();
    const db = getDb();

    const user = await db.prepare("SELECT id, email, password FROM users WHERE id = ?").get(userId) as { id: number; email: string; password: string } | undefined;
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (!currentPassword) {
      return NextResponse.json({ error: "Current password is required" }, { status: 400 });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 });
    }

    if (newEmail) {
      const existing = await db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(newEmail, userId);
      if (existing) return NextResponse.json({ error: "Email already in use" }, { status: 409 });
      await db.prepare("UPDATE users SET email = ? WHERE id = ?").run(newEmail, userId);
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      await db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashed, userId);
    }

    return NextResponse.json({ message: "Settings updated successfully" });
  } catch (error) {
    console.error("Settings error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
