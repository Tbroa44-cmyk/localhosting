export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";
import { pickCompaniesForUser } from "@/lib/bank-engine";

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!(session.user as any)?.isAdmin) {
      return NextResponse.json({ error: "This feature is not available yet" }, { status: 403 });
    }
    const userId = (session.user as any).id;
    const db = getDb();
    const result = await pickCompaniesForUser(db, userId);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
