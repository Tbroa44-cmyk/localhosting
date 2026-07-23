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

    const existing = db.prepare("SELECT id FROM users WHERE email = ? OR username = ?").get(email, username);
    if (existing) {
      return NextResponse.json({ error: "Email or username already taken" }, { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const result = db.prepare("INSERT INTO users (username, email, password, balance) VALUES (?, ?, ?, 0)").run(username, email, hashedPassword);
    const userId = result.lastInsertRowid;

    const cheapCompany = db.prepare(
      "SELECT id, share_price FROM companies WHERE share_price < 50 ORDER BY RANDOM() LIMIT 1"
    ).all() as { id: number; share_price: number }[];

    let welcomeBonus = "";
    if (cheapCompany.length > 0) {
      const company = cheapCompany[0];
      const existingHolding = db.prepare(
        "SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?"
      ).get(userId, company.id);

      if (existingHolding) {
        db.prepare("UPDATE holdings SET shares_owned = shares_owned + 1 WHERE id = ?").run((existingHolding as any).id);
      } else {
        db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, 1)").run(userId, company.id);
      }

      db.prepare(
        "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', 1, 0, 0)"
      ).run(userId, company.id);

      const companyInfo = db.prepare("SELECT name, ticker FROM companies WHERE id = ?").get(company.id) as any;
      welcomeBonus = ` Welcome bonus: 1 free share of ${companyInfo?.name || "a company"} (${companyInfo?.ticker || ""})!`;
    } else {
      db.prepare("UPDATE users SET balance = balance + 25 WHERE id = ?").run(userId);
      welcomeBonus = " Welcome bonus: 25c added to your balance!";
    }

    return NextResponse.json({
      message: `Account created successfully!${welcomeBonus}`,
      userId,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
