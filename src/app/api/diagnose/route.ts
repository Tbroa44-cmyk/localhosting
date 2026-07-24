export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log("[Diagnose]", msg); };

  log(`URL: ${url}`);
  log(`Key prefix: ${key?.substring(0, 20)}...`);

  // 1. Read all companies
  let companies: any[] = [];
  try {
    const res = await fetch(`${url}/rest/v1/companies?select=id,ticker,share_price`, {
      headers: { apikey: key!, Authorization: `Bearer ${key!}` },
    });
    companies = await res.json();
    log(`READ companies: ${JSON.stringify(companies)}`);
  } catch (e: any) { log(`READ ERROR: ${e.message}`); }

  for (const c of companies) {
    const testPrice = c.share_price + 1;
    log(`\n--- Testing company ${c.ticker} (id=${c.id}) current_price=${c.share_price} ---`);

    // 2. Write new price
    try {
      const res = await fetch(`${url}/rest/v1/companies?id=eq.${c.id}`, {
        method: "PATCH",
        headers: {
          apikey: key!, Authorization: `Bearer ${key!}`,
          "Content-Type": "application/json", Prefer: "return=representation",
        },
        body: JSON.stringify({ share_price: testPrice }),
      });
      const body = await res.json();
      log(`WRITE status=${res.status} body=${JSON.stringify(body)}`);
    } catch (e: any) { log(`WRITE ERROR: ${e.message}`); }

    // 3. Read back
    try {
      const res = await fetch(`${url}/rest/v1/companies?id=eq.${c.id}&select=id,share_price`, {
        headers: { apikey: key!, Authorization: `Bearer ${key!}` },
      });
      const data = await res.json();
      const newPrice = data?.[0]?.share_price;
      log(`VERIFY read back: ${JSON.stringify(data)} → changed: ${newPrice === testPrice ? "YES" : "NO (still " + newPrice + ")"}`);
    } catch (e: any) { log(`VERIFY ERROR: ${e.message}`); }

    // 4. Restore
    try {
      await fetch(`${url}/rest/v1/companies?id=eq.${c.id}`, {
        method: "PATCH",
        headers: { apikey: key!, Authorization: `Bearer ${key!}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ share_price: c.share_price }),
      });
      log(`RESTORED ${c.ticker} to ${c.share_price}`);
    } catch (e: any) { log(`RESTORE ERROR: ${e.message}`); }
  }

  // Test DELETE on a temp row
  try {
    const insRes = await fetch(`${url}/rest/v1/price_history`, {
      method: "POST",
      headers: {
        apikey: key!, Authorization: `Bearer ${key!}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      },
      body: JSON.stringify({ company_id: 99999, price: 1, timestamp: Date.now() }),
    });
    const insBody = await insRes.json();
    const insId = insBody?.[0]?.id;
    log(`\nINSERT temp price_history: status=${insRes.status} id=${insId}`);

    if (insId) {
      const delRes = await fetch(`${url}/rest/v1/price_history?id=eq.${insId}`, {
        method: "DELETE",
        headers: { apikey: key!, Authorization: `Bearer ${key!}`, Prefer: "return=minimal" },
      });
      log(`DELETE temp price_history id=${insId}: status=${delRes.status}`);
    }
  } catch (e: any) { log(`DELETE TEST ERROR: ${e.message}`); }

  // Test DELETE via db.prepare
  try {
    const db = (await import("@/lib/db")).default;
    const testDb = db();
    await testDb.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(99999, 1, Date.now());
    const row = await testDb.prepare("SELECT id FROM price_history WHERE company_id = 99999").get() as any;
    log(`\nDB INSERT temp row: id=${row?.id}`);
    if (row?.id) {
      await testDb.prepare("DELETE FROM price_history WHERE id = ?").run(row.id);
      const check = await testDb.prepare("SELECT id FROM price_history WHERE id = ?").get(row.id);
      log(`DB DELETE test: deleted=${!check ? "YES" : "NO"}`);
    }
  } catch (e: any) { log(`DB DELETE TEST ERROR: ${e.message}`); }

  return NextResponse.json({ logs }, { headers: { "Cache-Control": "no-store" } });
}
