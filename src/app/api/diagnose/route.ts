export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log("[Diagnose]", msg); };

  log(`URL: ${url}`);
  log(`Key prefix: ${key?.substring(0, 20)}...`);

  try {
    const res = await fetch(`${url}/rest/v1/companies?select=*`, {
      headers: { apikey: key!, Authorization: `Bearer ${key!}` },
    });
    const companies = await res.json();
    log(`RAW FETCH companies: ${JSON.stringify(companies)}`);
  } catch (e: any) { log(`RAW FETCH ERROR: ${e.message}`); }

  try {
    const getDb = (await import("@/lib/db")).default;
    const db = getDb();
    const companies = await db.prepare("SELECT * FROM companies ORDER BY ticker").all();
    log(`DB PREPARE companies: ${JSON.stringify(companies)}`);
  } catch (e: any) { log(`DB PREPARE ERROR: ${e.message}`); }

  return NextResponse.json({ logs }, { headers: { "Cache-Control": "no-store" } });
}
