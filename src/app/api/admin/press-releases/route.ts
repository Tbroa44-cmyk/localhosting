export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb, { insertPriceHistory } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || !(session.user as any).isAdmin) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const { company_id, content, type, severity } = await request.json();
    if (!company_id || !content || !type) {
      return NextResponse.json({ error: "company_id, content, and type are required" }, { status: 400 });
    }
    if (type !== "positive" && type !== "negative") {
      return NextResponse.json({ error: "type must be 'positive' or 'negative'" }, { status: 400 });
    }

    const db = getDb();

    const company = await db.prepare("SELECT id, share_price FROM companies WHERE id = ?").get(company_id) as { id: number; share_price: number } | undefined;
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    const sev = Math.max(1, Math.min(10, parseInt(severity) || 1));
    const currentPrice = Number(company.share_price);

    // Exponential severity multiplier: each level compounds
    const pct = (sev * sev + sev) / 200; // 1%, 3%, 6%, 10%, 15%, 21%, 28%, 36%, 45%, 55%
    const adjustment = Math.max(1, Math.round(currentPrice * pct));
    const newPrice = type === "positive"
      ? currentPrice + adjustment
      : Math.max(5, currentPrice - adjustment);

    // Lingering effect: 0.3% per severity level, decays over duration
    const lingeringTotal = Math.round(currentPrice * sev * 0.003);

    await db.prepare("INSERT INTO press_releases (company_id, content, type, severity, created_at, price_at_creation, lingering_total, lingering_remaining) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(company_id, content, type, sev, new Date().toISOString(), currentPrice, lingeringTotal, lingeringTotal);

    await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, company_id);
    await insertPriceHistory(company_id, newPrice, Date.now());

    return NextResponse.json({ message: `Press release published. Price ${type === "positive" ? "increased" : "decreased"} by ${formatPrice(adjustment)} (severity ${sev}). Lingering effect: ${formatPrice(lingeringTotal)}.` });
  } catch (error) {
    console.error("Press release error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function formatPrice(cents: number) {
  if (cents >= 100) return `${(cents / 100).toFixed(2)}`;
  return `${cents}c`;
}
