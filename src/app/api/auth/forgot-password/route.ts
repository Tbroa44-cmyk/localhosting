export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import getDb from "@/lib/db";

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const db = getDb();
    const user = await db.prepare("SELECT id, username, email FROM users WHERE LOWER(email) = ?").get(email.toLowerCase().trim()) as any;

    if (!user) {
      return NextResponse.json({ message: "If an account with that email exists, a code has been sent." });
    }

    await db.prepare("UPDATE password_resets SET used = true WHERE user_id = ? AND used = false").run(user.id);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await db.prepare("INSERT INTO password_resets (user_id, code, expires_at, used) VALUES (?, ?, ?, false)").run(user.id, code, expiresAt);

    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      try {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: "StockGame <onboarding@resend.dev>",
          to: email.trim(),
          subject: "Your Password Reset Code",
          html: `
            <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #333;">Password Reset Code</h2>
              <p style="color: #555;">Hi ${user.username},</p>
              <p style="color: #555;">Your 6-digit verification code is:</p>
              <div style="background: #1a1a2e; color: #00d4ff; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0;">${code}</div>
              <p style="color: #999; font-size: 13px;">This code expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
            </div>
          `,
        });
      } catch (emailErr: any) {
        console.error("[Forgot Password] Email send failed:", emailErr?.message);
      }
    } else {
      console.log(`[Forgot Password] Code for ${user.username}: ${code}`);
    }

    return NextResponse.json({ message: "If an account with that email exists, a code has been sent.", dev: !resendKey ? code : undefined });
  } catch (error: any) {
    console.error("[Forgot Password] Error:", error?.message);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
