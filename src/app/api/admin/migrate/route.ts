export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb, { runSql } from "@/lib/db";
import { issueCertificates, countTotalForCompany } from "@/lib/certificates";

const BATCH_SIZE = 1000;

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const db = getDb();

    try {
      await runSql(`CREATE TABLE IF NOT EXISTS share_certificates (
        id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        company_id INTEGER NOT NULL,
        owner_id INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'pending_order', 'cancelled')),
        order_id INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    } catch {}
    try {
      await runSql(`ALTER TABLE companies ADD COLUMN delisted INTEGER NOT NULL DEFAULT 0`);
    } catch {}  // column may already exist
    try {
      await runSql(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_market_order INTEGER DEFAULT 0`);
    } catch {}  // column may already exist

    const companies = await db.prepare("SELECT id, total_shares FROM companies").all() as { id: number; total_shares: number }[];
    const holdings = await db.prepare(
      "SELECT user_id, company_id, SUM(shares_owned) as total FROM holdings GROUP BY user_id, company_id"
    ).all() as { user_id: number; company_id: number; total: number }[];

    let totalCreated = 0;
    let totalSkipped = 0;

    for (const company of companies) {
      const existingCount = await countTotalForCompany(db, company.id);
      if (existingCount >= Number(company.total_shares)) {
        totalSkipped++;
        continue;
      }
      const companyHoldings = holdings.filter((h) => h.company_id === company.id);
      let expectedTotal = 0;
      for (const h of companyHoldings) {
        expectedTotal += Number(h.total);
      }
      if (Number(company.total_shares) > 0 && expectedTotal === 0) {
        expectedTotal = Number(company.total_shares);
      }
      if (expectedTotal === 0) continue;

      for (const h of companyHoldings) {
        const count = Number(h.total);
        if (count <= 0) continue;
        await issueCertificates(db, company.id, count, h.user_id);
        totalCreated += count;
      }
    }

    return NextResponse.json({
      success: true,
      certificatesCreated: totalCreated,
      companiesProcessed: companies.length - totalSkipped,
      message: `Created ${totalCreated} certificates across ${companies.length - totalSkipped} companies`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
