import getDb from "@/lib/db";
import { isTradingOpen } from "@/lib/trading-hours";

const BOT_INITIAL_CASH = 2000;
const BOT_COOLDOWN_MS = 20000;
const MAX_BOTS = 25;

const BOT_ADJECTIVES = [
  "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel",
  "India", "Juliet", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa",
  "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "Xray", "Yankee",
];

interface BotConfig {
  riskLevel: "conservative" | "balanced" | "aggressive";
  tradesPerHour: number;
  maxSharesPerTrade: number;
  buyBias: number;
  sellBias: number;
  stopLossPct: number;
  takeProfitPct: number;
  limitOrderChance: number;
  priceOffsetRange: number;
}

const BOT_CONFIGS: BotConfig[] = [
  { riskLevel: "conservative", tradesPerHour: 1.5, maxSharesPerTrade: 3, buyBias: 0.4, sellBias: 0.3, stopLossPct: 0.15, takeProfitPct: 0.30, limitOrderChance: 0.7, priceOffsetRange: 0.05 },
  { riskLevel: "balanced", tradesPerHour: 2.5, maxSharesPerTrade: 4, buyBias: 0.5, sellBias: 0.4, stopLossPct: 0.10, takeProfitPct: 0.20, limitOrderChance: 0.5, priceOffsetRange: 0.03 },
  { riskLevel: "aggressive", tradesPerHour: 4, maxSharesPerTrade: 5, buyBias: 0.55, sellBias: 0.45, stopLossPct: 0.08, takeProfitPct: 0.15, limitOrderChance: 0.3, priceOffsetRange: 0.02 },
];

let lastBotTickTime: Record<number, number> = {};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function ensureBotUsers(db: any): Promise<{ id: number; name: string; config: BotConfig }[]> {
  const bots: { id: number; name: string; config: BotConfig }[] = [];

  for (let i = 0; i < MAX_BOTS; i++) {
    const name = `Bot${BOT_ADJECTIVES[i]}`;
    const email = `bot_${BOT_ADJECTIVES[i].toLowerCase()}@stockgame.uk`;

    let bot = await db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;

    if (!bot) {
      const bcryptHash = "$2a$10$LKjhN4bK5hGF5q6R8x9Z0uY7x3v2mK8nJ4pQ2wS6dF0gH1jL3kM5n";
      const result = await db.prepare(
        "INSERT INTO users (username, email, password, balance, is_admin, allowed, xp, level) VALUES (?, ?, ?, ?, 0, 0, 0, 1)"
      ).run(name, email, bcryptHash, BOT_INITIAL_CASH);
      bot = { id: result.lastInsertRowid as number };

      await seedBotShares(db, bot.id, i);
    }

    bots.push({ id: bot.id, name, config: BOT_CONFIGS[i % BOT_CONFIGS.length] });
  }

  return bots;
}

async function seedBotShares(db: any, botId: number, botIndex: number) {
  const companies = await db.prepare(
    "SELECT id, share_price FROM companies WHERE share_price <= 12000 ORDER BY share_price ASC"
  ).all() as { id: number; share_price: number }[];

  if (companies.length === 0) return;

  const seeded = new Set<number>();
  const numPositions = 1 + (botIndex % 3);

  for (let p = 0; p < numPositions; p++) {
    const idx = (botIndex + p * 3) % companies.length;
    if (seeded.has(idx)) continue;
    seeded.add(idx);

    const company = companies[idx];
    const shares = 2 + (botIndex % 5);
    const price = Number(company.share_price);
    const cost = price * shares;

    if (cost > BOT_INITIAL_CASH * 3) continue;

    const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number } | undefined;
    if (!user || Number(user.balance) < cost) continue;

    await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(cost, botId);

    const existing = await db.prepare(
      "SELECT id FROM holdings WHERE user_id = ? AND company_id = ?"
    ).get(botId, company.id) as { id: number } | undefined;

    if (existing) {
      await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(shares, existing.id);
    } else {
      await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(botId, company.id, shares);
    }

    await db.prepare(
      "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
    ).run(botId, company.id, shares, price, cost);

    await db.prepare(
      "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
    ).run(botId, company.id, shares, price, new Date(Date.now() - botIndex * 60000).toISOString());
  }
}

async function analyzeCompany(db: any, companyId: number): Promise<{
  momentum: number;
  volatility: number;
  volume: number;
  trend: "up" | "down" | "flat";
  avgPrice: number;
}> {
  const priceHistory = await db.prepare(
    "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 24"
  ).all(companyId) as { price: number; timestamp: number }[];

  const recentTx = await db.prepare(
    "SELECT type, shares FROM transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT 30"
  ).all(companyId) as { type: string; shares: number }[];

  let momentum = 0;
  let volatility = 0;
  let volume = recentTx.length;
  let avgPrice = 0;

  if (priceHistory.length >= 2) {
    const prices = priceHistory.map((p) => Number(p.price));
    avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const recent = prices[0];
    const older = prices[prices.length - 1];
    momentum = older > 0 ? (recent - older) / older : 0;

    if (prices.length >= 4) {
      const mean = avgPrice;
      volatility = prices.reduce((a, p) => a + Math.pow(p - mean, 2), 0) / prices.length;
      volatility = Math.sqrt(volatility) / (mean || 1);
    }
  } else if (priceHistory.length === 1) {
    avgPrice = Number(priceHistory[0].price);
  }

  const trend = momentum > 0.03 ? "up" : momentum < -0.03 ? "down" : "flat";

  return { momentum, volatility, volume, trend, avgPrice };
}

async function pickBuyTarget(db: any, botId: number, balance: number, config: BotConfig, rand: () => number): Promise<{ companyId: number; shares: number; price: number } | null> {
  const companies = await db.prepare(
    "SELECT id, share_price, total_shares FROM companies WHERE total_shares > 0 AND share_price >= 5"
  ).all() as { id: number; share_price: number; total_shares: number }[];

  if (companies.length === 0) return null;

  const existingHoldings = await db.prepare(
    "SELECT company_id, shares_owned FROM holdings WHERE user_id = ? AND shares_owned > 0"
  ).all(botId) as { company_id: number; shares_owned: number }[];

  const holdingIds = new Set(existingHoldings.map((h) => h.company_id));
  const totalHeldValue = existingHoldings.reduce((sum, h) => {
    const c = companies.find((co) => co.id === h.company_id);
    return sum + (c ? Number(c.share_price) * h.shares_owned : 0);
  }, 0);

  const portfolioDiversification = existingHoldings.length;

  const scored = [];
  for (const company of companies) {
    const analysis = await analyzeCompany(db, company.id);
    let score = 40;

    if (config.riskLevel === "aggressive") {
      score += analysis.momentum * 300;
      score += analysis.volatility * 150;
      score += analysis.volume * 2;
    } else if (config.riskLevel === "balanced") {
      score += analysis.momentum * 150;
      score += (1 - analysis.volatility) * 40;
      score += analysis.volume * 1.5;
    } else {
      score += analysis.momentum * 80;
      score += (1 - analysis.volatility) * 60;
      score += analysis.volume * 0.8;
      if (analysis.trend === "up") score += 20;
    }

    if (holdingIds.has(company.id)) {
      score += 15;
    } else if (portfolioDiversification < 3) {
      score += 25;
    }

    score += rand() * 30 - 15;
    scored.push({ companyId: company.id, sharePrice: Number(company.share_price), score, analysis });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(5, scored.length));
  const pick = top[Math.floor(rand() * top.length)];

  const priceCents = pick.sharePrice;

  let maxAffordable = Math.floor(balance * 0.4 / priceCents);
  maxAffordable = Math.min(maxAffordable, config.maxSharesPerTrade);
  maxAffordable = Math.max(1, maxAffordable);

  const shares = Math.max(1, Math.floor(rand() * maxAffordable) + 1);
  const totalCost = shares * priceCents;

  if (totalCost > balance) return null;

  let price = priceCents;
  if (rand() < config.limitOrderChance) {
    const offset = 1 - rand() * config.priceOffsetRange;
    price = Math.max(5, Math.floor(priceCents * offset));
  }

  return { companyId: pick.companyId, shares, price };
}

async function pickSellTarget(db: any, botId: number, config: BotConfig, rand: () => number): Promise<{ companyId: number; shares: number; price: number } | null> {
  const holdings = await db.prepare(
    "SELECT company_id, shares_owned FROM holdings WHERE user_id = ? AND shares_owned > 0"
  ).all(botId) as { company_id: number; shares_owned: number }[];

  if (holdings.length === 0) return null;

  const pick = holdings[Math.floor(rand() * holdings.length)];
  const analysis = await analyzeCompany(db, pick.company_id);
  const company = await db.prepare("SELECT share_price, initial_price FROM companies WHERE id = ?").get(pick.company_id) as
    { share_price: number; initial_price?: number } | undefined;

  if (!company) return null;

  const currentPrice = Number(company.share_price);
  const entryApprox = Number(company.initial_price || company.share_price);
  const priceRatio = entryApprox > 0 ? currentPrice / entryApprox : 1;

  let sellProb = config.sellBias;

  if (analysis.trend === "down") sellProb += 0.20;
  if (analysis.trend === "up") sellProb -= 0.15;
  if (priceRatio > 1 + config.takeProfitPct) sellProb += 0.25;
  if (priceRatio < 1 - config.stopLossPct) sellProb += 0.30;
  if (holdings.length > 3) sellProb += 0.10;

  sellProb = Math.max(0.05, Math.min(0.85, sellProb));

  if (rand() > sellProb) return null;

  let sellFraction: number;
  if (priceRatio > 1 + config.takeProfitPct) {
    sellFraction = 0.3 + rand() * 0.6;
  } else if (priceRatio < 1 - config.stopLossPct) {
    sellFraction = 0.4 + rand() * 0.5;
  } else if (analysis.trend === "down") {
    sellFraction = 0.2 + rand() * 0.4;
  } else {
    sellFraction = 0.1 + rand() * 0.3;
  }

  const shares = Math.max(1, Math.floor(pick.shares_owned * sellFraction));

  let price = currentPrice;
  if (rand() < config.limitOrderChance) {
    const offset = 1 + rand() * config.priceOffsetRange;
    price = Math.floor(currentPrice * offset);
  }

  return { companyId: pick.company_id, shares: Math.min(shares, pick.shares_owned), price };
}

async function placeBotBuyOrder(db: any, botId: number, companyId: number, shares: number, price: number) {
  const totalCost = price * shares;
  const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number } | undefined;
  if (!user || Number(user.balance) < totalCost) return false;

  await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, botId);

  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
  const currentPrice = company ? Number(company.share_price) : price;

  if (price >= currentPrice) {
    const pendingSells = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' AND user_id != ? ORDER BY price_per_share ASC, created_at ASC"
    ).all(companyId, botId) as any[];

    let remaining = shares;
    let totalFilled = 0;
    let lastFillPrice = price;

    for (const sellOrder of pendingSells) {
      if (remaining <= 0) break;
      if (sellOrder.price_per_share > price) break;
      const fillQty = Math.min(remaining, sellOrder.shares);
      const fillPrice = sellOrder.price_per_share;
      const cost = fillPrice * fillQty;
      const taxAmount = Math.round(cost * 0.03);
      const sellerRevenue = cost - taxAmount;

      const seller = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(sellOrder.user_id) as { is_admin: any } | undefined;
      if (!seller?.is_admin) {
        await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
      }

      const sellerHolding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(sellOrder.user_id, companyId) as { id: number; shares_owned: number } | undefined;
      if (sellerHolding) {
        if (sellerHolding.shares_owned <= fillQty) {
          await db.prepare("DELETE FROM holdings WHERE id = ?").run(sellerHolding.id);
        } else {
          await db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(fillQty, sellerHolding.id);
        }
      }

      if (fillQty >= sellOrder.shares) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(sellOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, sellOrder.id);
      }

      await db.prepare(
        "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
      ).run(botId, companyId, fillQty, fillPrice, cost);
      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
      ).run(botId, companyId, fillQty, fillPrice, new Date().toISOString());

      remaining -= fillQty;
      totalFilled += fillQty;
      lastFillPrice = fillPrice;
    }

    if (remaining > 0) {
      const autoFillPrice = Number(company?.share_price || price);
      const availableShares = await db.prepare(
        "SELECT SUM(total_shares) as total FROM companies WHERE id = ?"
      ).get(companyId) as { total: number } | undefined;
      const totalHeld = await db.prepare(
        "SELECT SUM(shares_owned) as total FROM holdings WHERE company_id = ?"
      ).get(companyId) as { total: number } | undefined;
      const avail = Math.max(0, (availableShares?.total || 0) - (totalHeld?.total || 0));
      const autoQty = Math.min(remaining, avail);

      if (autoQty > 0) {
        const autoCost = autoFillPrice * autoQty;
        const existingH = await db.prepare("SELECT id FROM holdings WHERE user_id = ? AND company_id = ?").get(botId, companyId) as { id: number } | undefined;
        if (existingH) {
          await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(autoQty, existingH.id);
        } else {
          await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(botId, companyId, autoQty);
        }
        await db.prepare(
          "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
        ).run(botId, companyId, autoQty, autoFillPrice, autoCost);
        await db.prepare(
          "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
        ).run(botId, companyId, autoQty, autoFillPrice, new Date().toISOString());
        remaining -= autoQty;
        totalFilled += autoQty;
      }
    }

    if (remaining > 0 && remaining < shares) {
      const refund = remaining * price;
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(refund, botId);
      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)"
      ).run(botId, companyId, remaining, remaining, price, new Date().toISOString());
    } else if (remaining === shares) {
      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)"
      ).run(botId, companyId, shares, shares, price, new Date().toISOString());
    }

    const newAutoPrice = applyPriceCapToCompany(currentPrice, lastFillPrice);
    await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newAutoPrice, companyId);
    await db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(companyId, newAutoPrice, Date.now());
  } else {
    await db.prepare(
      "INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)"
    ).run(botId, companyId, shares, shares, price, new Date().toISOString());
  }

  return true;
}

async function placeBotSellOrder(db: any, botId: number, companyId: number, shares: number, price: number) {
  const holding = await db.prepare("SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(botId, companyId) as
    { id: number; shares_owned: number } | undefined;
  if (!holding || holding.shares_owned < shares) return false;

  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
  const currentPrice = company ? Number(company.share_price) : price;

  if (price <= currentPrice) {
    const pendingBuys = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'buy' AND status = 'pending' AND user_id != ? ORDER BY price_per_share DESC, created_at ASC"
    ).all(companyId, botId) as any[];

    let remaining = shares;
    let totalRevenue = 0;
    let lastFillPrice = price;

    for (const buyOrder of pendingBuys) {
      if (remaining <= 0) break;
      if (buyOrder.price_per_share < price) break;
      const fillQty = Math.min(remaining, buyOrder.shares);
      const fillPrice = buyOrder.price_per_share;
      const grossRevenue = fillPrice * fillQty;
      const taxAmount = Math.round(grossRevenue * 0.03);
      const netRevenue = grossRevenue - taxAmount;

      const buyer = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(buyOrder.user_id) as { is_admin: any } | undefined;
      if (!buyer?.is_admin) {
        await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(netRevenue, buyOrder.user_id);
      }

      if (fillQty >= buyOrder.shares) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(buyOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, buyOrder.id);
      }

      await db.prepare(
        "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)"
      ).run(botId, companyId, fillQty, fillPrice, grossRevenue);
      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, 'filled', ?)"
      ).run(botId, companyId, fillQty, fillPrice, new Date().toISOString());

      remaining -= fillQty;
      totalRevenue += netRevenue;
      lastFillPrice = fillPrice;
    }

    const grossRevenueBot = remaining * price;
    const taxBot = Math.round(grossRevenueBot * 0.03);
    const netBot = grossRevenueBot - taxBot;
    totalRevenue += netBot;

    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(totalRevenue, botId);

    if (remaining > 0) {
      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)"
      ).run(botId, companyId, remaining, remaining, price, new Date().toISOString());
    }

    if (holding.shares_owned <= shares) {
      await db.prepare("DELETE FROM holdings WHERE id = ?").run(holding.id);
    } else {
      await db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(shares, holding.id);
    }

    const newPrice = applyPriceCapToCompany(currentPrice, lastFillPrice);
    await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, companyId);
    await db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(companyId, newPrice, Date.now());
  } else {
    await db.prepare(
      "INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)"
    ).run(botId, companyId, shares, shares, price, new Date().toISOString());
  }

  return true;
}

function applyPriceCapToCompany(currentPrice: number, tradePrice: number): number {
  if (currentPrice <= 0) return tradePrice;
  const change = tradePrice - currentPrice;
  const changePercent = Math.abs(change) / currentPrice;
  if (changePercent <= 0.25) return tradePrice;
  const direction = change > 0 ? 1 : -1;
  return Math.max(5, Math.round(currentPrice + direction * currentPrice * 0.25));
}

export async function runBotTick(): Promise<{ botsEnabled: boolean; tradesExecuted: number; message: string }> {
  const db = getDb();

  const settings = await db.prepare("SELECT bots_enabled FROM settings WHERE id = 1").get() as { bots_enabled: number } | undefined;
  if (!settings || settings.bots_enabled === 0) {
    return { botsEnabled: false, tradesExecuted: 0, message: "Bots disabled" };
  }

  if (!(await isTradingOpen(db))) {
    return { botsEnabled: true, tradesExecuted: 0, message: "Market closed" };
  }

  const bots = await ensureBotUsers(db);
  const now = Date.now();
  let totalTrades = 0;

  for (const bot of bots) {
    const lastTrade = lastBotTickTime[bot.id] || 0;
    if (now - lastTrade < BOT_COOLDOWN_MS) continue;

    const minuteSeed = Math.floor(now / 60000) + bot.id * 7;
    const rand = seededRandom(minuteSeed);

    const tradeProbPerTick = bot.config.tradesPerHour / 120;
    if (rand() > tradeProbPerTick) continue;

    const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(bot.id) as { balance: number } | undefined;
    if (!user) continue;

    const balance = Number(user.balance);

    const holdings = await db.prepare(
      "SELECT company_id, shares_owned FROM holdings WHERE user_id = ? AND shares_owned > 0"
    ).all(bot.id) as { company_id: number; shares_owned: number }[];

    const shouldSellFirst = holdings.length > 0 && (rand() < 0.5 || balance < 100);

    let traded = false;

    if (shouldSellFirst) {
      const target = await pickSellTarget(db, bot.id, bot.config, rand);
      if (target) {
        traded = await placeBotSellOrder(db, bot.id, target.companyId, target.shares, target.price);
        if (traded) totalTrades++;
      }
    }

    if (!traded && balance >= 5) {
      const target = await pickBuyTarget(db, bot.id, balance, bot.config, rand);
      if (target && target.shares * target.price <= balance) {
        traded = await placeBotBuyOrder(db, bot.id, target.companyId, target.shares, target.price);
        if (traded) totalTrades++;
      }
    }

    if (!traded && !shouldSellFirst && holdings.length > 0) {
      const target = await pickSellTarget(db, bot.id, bot.config, rand);
      if (target) {
        traded = await placeBotSellOrder(db, bot.id, target.companyId, target.shares, target.price);
        if (traded) totalTrades++;
      }
    }

    if (traded) {
      lastBotTickTime[bot.id] = now;
    }
  }

  return {
    botsEnabled: true,
    tradesExecuted: totalTrades,
    message: totalTrades > 0 ? `Bots executed ${totalTrades} trade${totalTrades > 1 ? "s" : ""}` : "No bot trades this tick",
  };
}
