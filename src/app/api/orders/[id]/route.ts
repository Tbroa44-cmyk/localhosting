import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { cancelOrder } from "@/lib/stock-engine";

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const userId = (session.user as any).id;
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
