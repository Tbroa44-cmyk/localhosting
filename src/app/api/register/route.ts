export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import getDb from "@/lib/db";

export async function POST(request: Request) {
  try {
    const { username, email, password } = await request.json();

    if (!username || !email || !password) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
    }

    const db = getDb();

    const existingEmail = await db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existingEmail) return NextResponse.json({ error: "Email already taken" }, { status: 409 });

    const existingUsername = await db.prepare("SELECT id FROM users WHERE username = ?").get(username);
    if (existingUsername) return NextResponse.json({ error: "Username already taken" }, { status: 409 });

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = await db.prepare("INSERT INTO users (username, email, password, balance) VALUES (?, ?, ?, 0)").run(username, email, hashedPassword);
    const userId = result.lastInsertRowid;

    await db.prepare("UPDATE users SET balance = balance + 100 WHERE id = ?").run(userId);
    const welcomeBonus = " Welcome bonus: 1.00c added to your balance!";

    return NextResponse.json({
      message: `Account created successfully!${welcomeBonus}`,
      userId,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
