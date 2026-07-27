export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { runBotTick } from "@/lib/bot-engine";

export async function POST() {
  try {
    const result = await runBotTick();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Bot tick error:", error?.message || error);
    return NextResponse.json({ error: "Bot tick failed" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await runBotTick();
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Bot tick error:", error?.message || error);
    return NextResponse.json({ error: "Bot tick failed" }, { status: 500 });
  }
}
