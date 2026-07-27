import getDb from "@/lib/db";
import { formatCoins } from "@/lib/format";
import { isTradingOpen } from "@/lib/trading-hours";

interface BotProfile {
  name: string;
  email: string;
  password: string;
  initialBalance: number;
  riskLevel: "conservative" | "balanced" | "aggressive";
  tradesPerHour: number;
  maxSharesPerTrade: number;
  buyChance: number;
  sellChance: number;
  stopLossPct: number;
  takeProfitPct: number;
}

const BOT_PROFILES: BotProfile[] = [
  {
    name: "BotAlpha",
    email: "bot_alpha@stockgame.uk",
    password: "$2a$10$abcdefghijklmnopqrstuuO8hGiMpCpGsQb0YZC3T5aZ1mLqLlLlLlLlLlLl",
    initialBalance: 50000,
    riskLevel: "conservative",
    tradesPerHour: 2,
    maxSharesPerTrade: 15,
    buyChance: 0.45,
    sellChance: 0.35,
    stopLossPct: 0.15,
    takeProfitPct: 0.25,
  },
  {
    name: "BotBeta",
    email: "bot_beta@stockgame.uk",
    password: "$2a$10$abcdefghijklmnopqrstuuO8hGiMpCpGsQb0YZC3T5aZ1mLqLlLlLlLlLlLl",
    initialBalance: 35000,
    riskLevel: "balanced",
    tradesPerHour: 4,
    maxSharesPerTrade: 25,
    buyChance: 0.5,
    sellChance: 0.4,
    stopLossPct: 0.10,
    takeProfitPct: 0.20,
  },
  {
    name: "BotCharlie",
    email: "bot_charlie@stockgame.uk",
    password: "$2a$10$abcdefghijklmnopqrstuuO8hGiMpCpGsQb0YZC3T5aZ1mLqLlLlLlLlLlLl",
    initialBalance: 25000,
    riskLevel: "aggressive",
    tradesPerHour: 6,
    maxSharesPerTrade: 40,
    buyChance: 0.55,
    sellChance: 0.45,
    stopLossPct: 0.08,
    takeProfitPct: 0.15,
  },
];

let lastBotTickTime: Record<number, number> = {};
const BOT_COOLDOWN_MS = 25000;

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

async function ensureBotUsers(db: any): Promise<number[]> {
  const botIds: number[] = [];

  for (const profile of BOT_PROFILES) {
    let bot = await db.prepare("SELECT id FROM users WHERE email = ?").get(profile.email) as { id: number } | undefined;

    if (!bot) {
      const bcryptHash = "$2a$10$LKjhN4bK5hGF5q6R8x9Z0uY7x3v2mK8nJ4pQ2wS6dF0gH1jL3kM5n";
      const result = await db.prepare(
        "INSERT INTO users (username, email, password, balance, is_admin, allowed, xp, level) VALUES (?, ?, ?, ?, 0, 0, 0, 1)"
      ).run(profile.name, profile.email, bcryptHash, profile.initialBalance);
      botIds.push(result.lastInsertRowid as number);
    } else {
      botIds.push(bot.id);
    }
  }

  return botIds;
}

function getLastTradeTime(botId: number): number {
  return lastBotTickTime[botId] || 0;
}

function setLastTradeTime(botId: number) {
  lastBotTickTime[botId] = Date.now();
}

async function analyzeCompanyTrend(db: any, companyId: number): Promise<{
  momentum: number;
  volatility: number;
  volume: number;
  trend: "up" | "down" | "flat";
}> {
  const priceHistory = await db.prepare(
    "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 24"
  ).all(companyId) as { price: number; timestamp: number }[];

  const recentTransactions = await db.prepare(
    "SELECT type, shares, created_at FROM transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT 50"
  ).all(companyId) as { type: string; shares: number; created_at: string }[];

  let momentum = 0;
  let volatility = 0;
  let volume = recentTransactions.length;

  if (priceHistory.length >= 2) {
    const recent = Number(priceHistory[0].price);
    const older = Number(priceHistory[priceHistory.length - 1].price);
    momentum = older > 0 ? (recent - older) / older : 0;

    if (priceHistory.length >= 6) {
      const prices = priceHistory.slice(0, 6).map((p) => Number(p.price));
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      volatility = prices.reduce((a, p) => a + Math.pow(p - avg, 2), 0) / prices.length;
      volatility = Math.sqrt(volatility) / (avg || 1);
    }
  }

  const trend = momentum > 0.02 ? "up" : momentum < -0.02 ? "down" : "flat";

  return { momentum, volatility, volume, trend };
}

async function pickCompanyToBuy(db: any, profile: BotProfile, rand: () => number): Promise<{ companyId: number; shares: number } | null> {
  const companies = await db.prepare(
    "SELECT id, share_price, total_shares FROM companies WHERE total_shares > 0 AND share_price >= 5"
  ).all() as { id: number; share_price: number; total_shares: number }[];

  if (companies.length === 0) return null;

  const scored = [];
  for (const company of companies) {
    const analysis = await analyzeCompanyTrend(db, company.id);
    let score = 50;

    if (profile.riskLevel === "aggressive") {
      score += analysis.momentum * 200;
      score += analysis.volatility * 100;
      score += analysis.volume * 3;
    } else if (profile.riskLevel === "balanced") {
      score += analysis.momentum * 100;
      score += (1 - analysis.volatility) * 30;
      score += analysis.volume * 2;
    } else {
      score += analysis.momentum * 50;
      score += (1 - analysis.volatility) * 50;
      score += analysis.volume * 1;
      if (analysis.trend === "up") score += 15;
    }

    score += rand() * 40 - 20;

    scored.push({ companyId: company.id, sharePrice: Number(company.share_price), score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);
  const pick = top[Math.floor(rand() * top.length)];

  const priceCents = pick.sharePrice;
  let maxAffordable = Math.floor(profile.initialBalance * 0.15 / priceCents);
  maxAffordable = Math.min(maxAffordable, profile.maxSharesPerTrade);
  maxAffordable = Math.max(1, maxAffordable);

  const shares = Math.max(1, Math.floor(rand() * maxAffordable) + 1);

  return { companyId: pick.companyId, shares };
}

async function pickCompanyToSell(db: any, botId: number, profile: BotProfile, rand: () => number): Promise<{ companyId: number; shares: number } | null> {
  const holdings = await db.prepare(
    "SELECT company_id, shares_owned FROM holdings WHERE user_id = ? AND shares_owned > 0"
  ).all(botId) as { company_id: number; shares_owned: number }[];

  if (holdings.length === 0) return null;

  const pick = holdings[Math.floor(rand() * holdings.length)];

  const analysis = await analyzeCompanyTrend(db, pick.company_id);
  const company = await db.prepare("SELECT share_price, initial_price FROM companies WHERE id = ?").get(pick.company_id) as
    { share_price: number; initial_price?: number } | undefined;

  if (!company) return null;

  const currentPrice = Number(company.share_price);
  const entryApprox = Number(company.initial_price || company.share_price);
  const priceRatio = entryApprox > 0 ? currentPrice / entryApprox : 1;

  let sellProbability = profile.sellChance;

  if (analysis.trend === "down") sellProbability += 0.15;
  if (analysis.trend === "up") sellProbability -= 0.1;
  if (priceRatio > 1 + profile.takeProfitPct) sellProbability += 0.2;
  if (priceRatio < 1 - profile.stopLossPct) sellProbability += 0.25;

  sellProbability = Math.max(0.05, Math.min(0.85, sellProbability));

  if (rand() > sellProbability) return null;

  let sellFraction: number;
  if (priceRatio > 1 + profile.takeProfitPct) {
    sellFraction = 0.4 + rand() * 0.5;
  } else if (priceRatio < 1 - profile.stopLossPct) {
    sellFraction = 0.3 + rand() * 0.6;
  } else if (analysis.trend === "down") {
    sellFraction = 0.2 + rand() * 0.3;
  } else {
    sellFraction = 0.1 + rand() * 0.3;
  }

  const shares = Math.max(1, Math.floor(pick.shares_owned * sellFraction));

  return { companyId: pick.company_id, shares: Math.min(shares, pick.shares_owned) };
}

async function executeBotBuy(db: any, botId: number, companyId: number, shares: number, profile: BotProfile) {
  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
  if (!company) return;

  const price = Number(company.share_price);
  const totalCost = price * shares;

  const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number };
  if (!user || Number(user.balance) < totalCost) return;

  await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, botId);

  const existing = await db.prepare(
    "SELECT id FROM holdings WHERE user_id = ? AND company_id = ?"
  ).get(botId, companyId) as { id: number } | undefined;

  if (existing) {
    await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(shares, existing.id);
  } else {
    await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(botId, companyId, shares);
  }

  await db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
  ).run(botId, companyId, shares, price, totalCost);

  await db.prepare(
    "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
  ).run(botId, companyId, shares, price, new Date().toISOString());
}

async function executeBotSell(db: any, botId: number, companyId: number, shares: number) {
  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
  if (!company) return;

  const price = Number(company.share_price);
  const grossRevenue = price * shares;
  const taxAmount = Math.round(grossRevenue * 0.03);
  const netRevenue = grossRevenue - taxAmount;

  const holding = await db.prepare("SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(botId, companyId) as
    { id: number; shares_owned: number } | undefined;

  if (!holding || holding.shares_owned < shares) return;

  await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(netRevenue, botId);

  if (holding.shares_owned === shares) {
    await db.prepare("DELETE FROM holdings WHERE id = ?").run(holding.id);
  } else {
    await db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(shares, holding.id);
  }

  const rawNewPrice = price * (1 - 0.02 * shares);
  const newPrice = Math.max(5, Math.round(rawNewPrice));

  await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, companyId);

  await db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)"
  ).run(botId, companyId, shares, price, netRevenue);

  await db.prepare(
    "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, 'filled', ?)"
  ).run(botId, companyId, shares, price, new Date().toISOString());

  await db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(
    companyId, newPrice, Date.now()
  );
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

  const botIds = await ensureBotUsers(db);
  const now = Date.now();
  let totalTrades = 0;

  for (let i = 0; i < botIds.length; i++) {
    const botId = botIds[i];
    const profile = BOT_PROFILES[i];
    const lastTrade = getLastTradeTime(botId);

    if (now - lastTrade < BOT_COOLDOWN_MS) continue;

    const minuteSeed = Math.floor(now / 60000);
    const rand = seededRandom(hashStr(profile.name + minuteSeed));

    const tradeProbPerTick = profile.tradesPerHour / 120;
    if (rand() > tradeProbPerTick) continue;

    const shouldSell = rand() < 0.5;
    let tradeResult = false;

    if (shouldSell) {
      const target = await pickCompanyToSell(db, botId, profile, rand);
      if (target) {
        await executeBotSell(db, botId, target.companyId, target.shares);
        tradeResult = true;
        totalTrades++;
      }
    }

    if (!tradeResult) {
      const target = await pickCompanyToBuy(db, profile, rand);
      if (target) {
        const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number };
        if (user && Number(user.balance) >= target.shares * 5) {
          await executeBotBuy(db, botId, target.companyId, target.shares, profile);
          tradeResult = true;
          totalTrades++;
        }
      }
    }

    if (tradeResult) {
      setLastTradeTime(botId);
    }
  }

  return {
    botsEnabled: true,
    tradesExecuted: totalTrades,
    message: totalTrades > 0 ? `Bots executed ${totalTrades} trade${totalTrades > 1 ? "s" : ""}` : "No bot trades this tick",
  };
}
