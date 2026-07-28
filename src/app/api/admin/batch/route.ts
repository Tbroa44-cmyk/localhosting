export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import getDb from "@/lib/db";

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!(session?.user as any)?.isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const db = getDb();
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    if (action === "migrate-bots") {
      const BOT_NAMES = ["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17","18","19","20","21","22","23","24","25"];
      const existingBots = await db.prepare("SELECT id, username, email, role FROM users WHERE email LIKE 'bot\\_%@stockgame.uk' OR role = 'bot' OR role = 'Bot'").all() as any[];
      let renamed = 0, roleUpdated = 0;

      for (const bot of existingBots) {
        const emailParts = bot.email.replace("@stockgame.uk", "").split("_");
        const rawName = emailParts.length > 1 ? emailParts[1] : emailParts[0].replace("bot", "");
        let numIdx = -1;
        const nato = ["alpha","bravo","charlie","delta","echo","foxtrot","golf","hotel","india","juliet","kilo","lima","mike","november","oscar","papa","quebec","romeo","sierra","tango","uniform","victor","whiskey","xray","yankee","beta"];
        numIdx = nato.indexOf(rawName.toLowerCase());
        if (numIdx === -1) {
          const match = rawName.match(/\d+/);
          numIdx = match ? parseInt(match[0]) - 1 : -1;
        }
        if (numIdx >= 0 && numIdx < 25) {
          const newName = `Bot${BOT_NAMES[numIdx]}`;
          const newEmail = `bot${BOT_NAMES[numIdx]}@stockgame.uk`;
          if (bot.username !== newName) {
            try { await db.prepare("UPDATE users SET username = ?, email = ? WHERE id = ?").run(newName, newEmail, bot.id); renamed++; } catch {}
          }
        }
        if (bot.role !== "Bot") {
          try { await db.prepare("UPDATE users SET role = 'Bot' WHERE id = ?").run(bot.id); roleUpdated++; } catch {}
        }
      }

      return NextResponse.json({ success: true, renamed, roleUpdated });
    }

    if (action === "reset-balances") {
      const bots = await db.prepare("SELECT id FROM users WHERE role = 'Bot'").all() as any[];
      const players = await db.prepare("SELECT id FROM users WHERE (role IS NULL OR role != 'Bot')").all() as any[];
      let botCount = 0, playerCount = 0;

      for (const bot of bots) {
        try { await db.prepare("UPDATE users SET balance = 5000 WHERE id = ?").run(bot.id); botCount++; } catch {}
      }
      for (const p of players) {
        try { await db.prepare("UPDATE users SET balance = 1000 WHERE id = ?").run(p.id); playerCount++; } catch {}
      }

      return NextResponse.json({ success: true, message: `Reset ${playerCount} players to 10c, ${botCount} bots to 50c` });
    }

    if (action === "liquidate-bots") {
      const bots = await db.prepare("SELECT id, username FROM users WHERE role = 'Bot'").all() as any[];

      for (const bot of bots) {
        const holdings = await db.prepare("SELECT id, company_id, shares_owned FROM holdings WHERE user_id = ?").all(bot.id) as any[];
        for (const h of holdings) {
          const company = await db.prepare("SELECT id, share_price FROM companies WHERE id = ?").get(h.company_id) as { share_price: number } | undefined;
          if (!company) continue;
          const price = Math.max(1, Math.round(Number(company.share_price) * 0.95));
          await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)").run(
            bot.id, h.company_id, h.shares_owned, h.shares_owned, price, new Date().toISOString()
          );
        }
        await db.prepare("DELETE FROM holdings WHERE user_id = ?").run(bot.id);
        await db.prepare("UPDATE orders SET status = 'cancelled' WHERE user_id = ? AND status = 'pending'").run(bot.id);
      }

      return NextResponse.json({ success: true, message: `Liquidated ${bots.length} bots` });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("Admin batch error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
