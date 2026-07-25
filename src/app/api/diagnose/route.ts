export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log("[Diagnose]", msg); };

  log(`URL: ${url}`);
  log(`Key prefix: ${key?.substring(0, 20)}...`);

  // Test 1: Raw fetch (no Content-Type header)
  try {
    const res = await fetch(`${url}/rest/v1/companies?select=*`, {
      headers: { apikey: key!, Authorization: `Bearer ${key!}` },
    });
    const companies = await res.json();
    log(`RAW FETCH (no Content-Type): ${JSON.stringify(companies)}`);
  } catch (e: any) { log(`RAW FETCH ERROR: ${e.message}`); }

  // Test 2: Raw fetch WITH Content-Type (like restHeaders)
  try {
    const res = await fetch(`${url}/rest/v1/companies?select=*&order=ticker.asc`, {
      headers: { apikey: key!, Authorization: `Bearer ${key!}`, "Content-Type": "application/json" },
    });
    const companies = await res.json();
    log(`RAW FETCH (with Content-Type): ${JSON.stringify(companies)}`);
  } catch (e: any) { log(`RAW FETCH CT ERROR: ${e.message}`); }

  // Test 3: restFetch via db.prepare
  try {
    const getDb = (await import("@/lib/db")).default;
    const db = getDb();
    const companies = await db.prepare("SELECT * FROM companies ORDER BY ticker").all();
    log(`DB PREPARE (via restFetch): ${JSON.stringify(companies)}`);
  } catch (e: any) { log(`DB PREPARE ERROR: ${e.message}`); }

  // Test 4: Check env vars used by restFetch
  try {
    const restUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
    const restKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    log(`restUrl() = ${restUrl}`);
    log(`restKey prefix = ${restKey?.substring(0, 20)}...`);
    log(`Same URL as raw? ${restUrl === url + '/rest/v1'}`);
    log(`Same key as raw? ${restKey === key}`);
  } catch (e: any) { log(`ENV CHECK ERROR: ${e.message}`); }

  return NextResponse.json({ logs }, { headers: { "Cache-Control": "no-store" } });
}
