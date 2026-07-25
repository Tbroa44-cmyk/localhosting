export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log("[Diagnose]", msg); };

  log(`URL: ${url}`);

  // Test: db.prepare (the path that was failing)
  try {
    const getDb = (await import("@/lib/db")).default;
    const db = getDb();
    const companies = await db.prepare("SELECT * FROM companies ORDER BY ticker").all();
    log(`DB PREPARE: ${JSON.stringify(companies)}`);
  } catch (e: any) { log(`DB PREPARE ERROR: ${e.message}`); }

  return NextResponse.json({ logs }, { headers: { "Cache-Control": "no-store" } });
}
