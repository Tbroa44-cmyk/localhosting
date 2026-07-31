export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";
import { getBankStatus } from "@/lib/bank-engine";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(session.user as any)?.isAdmin) {
      return NextResponse.json({ error: "This feature is not available yet" }, { status: 403 });
    }
    const userId = (session.user as any).id;

    const status = await getBankStatus(userId);
    return NextResponse.json(status);
  } catch (error: any) {
    console.error("Bank status error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
