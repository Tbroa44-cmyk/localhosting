export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getTradingInfo } from "@/lib/trading-hours";

export async function GET(request: NextRequest) {
  try {
    const info = await getTradingInfo();
    return NextResponse.json(info);
  } catch (error) {
    return NextResponse.json({ isOpen: true, message: "Markets open", emergencyClose: false });
  }
}
