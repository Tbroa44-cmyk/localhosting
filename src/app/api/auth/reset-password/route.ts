export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import getDb from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { email, code, newPassword } = await request.json();

    if (!email || !code || !newPassword) {
      return NextResponse.json({ error: "Email, code, and new password are required" }, { status: 400 });
    }

    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    if (typeof code !== "string" || code.length !== 6 || !/^\d{6}$/.test(code)) {
      return NextResponse.json({ error: "Invalid code format" }, { status: 400 });
    }

    const db = getDb();

    const user = await db.prepare("SELECT id FROM users WHERE LOWER(email) = ?").get(email.toLowerCase().trim()) as any;
    if (!user) {
      return NextResponse.json({ error: "Invalid email or code" }, { status: 400 });
    }

    const reset = await db.prepare(
      "SELECT id FROM password_resets WHERE user_id = ? AND code = ? AND used = false ORDER BY id DESC LIMIT 1"
    ).get(user.id, code) as any;

    if (!reset) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 400 });
    }

    const resetRecord = await db.prepare("SELECT expires_at FROM password_resets WHERE id = ?").get(reset.id) as any;
    if (resetRecord && new Date(resetRecord.expires_at) < new Date()) {
      return NextResponse.json({ error: "Code has expired" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await db.prepare("UPDATE users SET password = ? WHERE id = ?").run(hashedPassword, user.id);
    await db.prepare("UPDATE password_resets SET used = true WHERE id = ?").run(reset.id);

    return NextResponse.json({ message: "Password updated successfully" });
  } catch (error: any) {
    console.error("[Reset Password] Error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
