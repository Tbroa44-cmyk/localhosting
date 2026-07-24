import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const results: any[] = [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const logs: string[] = [];

  const log = (msg: string) => { logs.push(msg); console.log("[Diagnose]", msg); };

  log(`URL: ${url}`);
  log(`Key prefix: ${key?.substring(0, 20)}...`);

  // 1. Read companies via REST
  try {
    const readRes = await fetch(`${url}/rest/v1/companies?select=id,ticker,share_price&limit=3`, {
      headers: { apikey: key!, Authorization: `Bearer ${key!}` },
    });
    const readData = await readRes.json();
    log(`REST READ: status=${readRes.status} data=${JSON.stringify(readData).substring(0, 300)}`);
    results.push({ step: "rest_read", status: readRes.status, data: readData });
  } catch (e: any) {
    log(`REST READ ERROR: ${e.message}`);
    results.push({ step: "rest_read", error: e.message });
  }

  // 2. Write to companies via REST PATCH
  try {
    const writeRes = await fetch(`${url}/rest/v1/companies?id=eq.1`, {
      method: "PATCH",
      headers: {
        apikey: key!,
        Authorization: `Bearer ${key!}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ share_price: 99999 }),
    });
    const writeText = await writeRes.text();
    log(`REST WRITE: status=${writeRes.status} statusText=${writeRes.statusText} body=${writeText.substring(0, 500)}`);
    results.push({ step: "rest_write", status: writeRes.status, body: writeText.substring(0, 500) });

    // 3. Read back to verify
    const verifyRes = await fetch(`${url}/rest/v1/companies?id=eq.1&select=id,share_price`, {
      headers: { apikey: key!, Authorization: `Bearer ${key!}` },
    });
    const verifyData = await verifyRes.json();
    log(`REST VERIFY: status=${verifyRes.status} data=${JSON.stringify(verifyData).substring(0, 300)}`);
    results.push({ step: "rest_verify", status: verifyRes.status, data: verifyData });

    // 4. Restore original price
    await fetch(`${url}/rest/v1/companies?id=eq.1`, {
      method: "PATCH",
      headers: {
        apikey: key!,
        Authorization: `Bearer ${key!}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ share_price: 10 }),
    });
  } catch (e: any) {
    log(`REST WRITE ERROR: ${e.message}`);
    results.push({ step: "rest_write", error: e.message });
  }

  // 5. Try insert into price_history via REST
  try {
    const insertRes = await fetch(`${url}/rest/v1/price_history`, {
      method: "POST",
      headers: {
        apikey: key!,
        Authorization: `Bearer ${key!}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ company_id: 1, price: 99999, timestamp: Date.now() }),
    });
    const insertText = await insertRes.text();
    log(`REST INSERT price_history: status=${insertRes.status} body=${insertText.substring(0, 500)}`);
    results.push({ step: "rest_insert_history", status: insertRes.status, body: insertText.substring(0, 500) });
  } catch (e: any) {
    log(`REST INSERT ERROR: ${e.message}`);
    results.push({ step: "rest_insert_history", error: e.message });
  }

  // 6. Check RLS policies via introspection
  try {
    const rlsRes = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key!, Authorization: `Bearer ${key!}` },
    });
    log(`REST Root: status=${rlsRes.status}`);
    results.push({ step: "rest_root", status: rlsRes.status });
  } catch (e: any) {
    log(`REST Root ERROR: ${e.message}`);
    results.push({ step: "rest_root", error: e.message });
  }

  return NextResponse.json({ logs, results }, { headers: { "Cache-Control": "no-store" } });
}
