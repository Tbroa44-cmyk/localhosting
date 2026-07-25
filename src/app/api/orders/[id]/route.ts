export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions, getUserIdFromRequest } from "@/lib/auth";
import { cancelOrder } from "@/lib/stock-engine";

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user ? (session.user as any).id : await getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const orderId = Number(params.id);

    if (isNaN(orderId)) {
      return NextResponse.json({ error: "Invalid order ID" }, { status: 400 });
    }

    const result = await cancelOrder(userId, orderId);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Cancel order error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 400 });
  }
}
