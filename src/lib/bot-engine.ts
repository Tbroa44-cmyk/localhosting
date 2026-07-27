import getDb from "@/lib/db";
import { isTradingOpen } from "@/lib/trading-hours";

const BOT_INITIAL_CASH = 2000;
const BOT_COOLDOWN_MS = 15000;
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
}

const BOT_CONFIGS: BotConfig[] = [
  { riskLevel: "conservative", tradesPerHour: 12, maxSharesPerTrade: 3, buyBias: 0.45, sellBias: 0.35, stopLossPct: 0.12, takeProfitPct: 0.25 },
  { riskLevel: "balanced", tradesPerHour: 18, maxSharesPerTrade: 4, buyBias: 0.50, sellBias: 0.40, stopLossPct: 0.08, takeProfitPct: 0.18 },
  { riskLevel: "aggressive", tradesPerHour: 24, maxSharesPerTrade: 5, buyBias: 0.55, sellBias: 0.45, stopLossPct: 0.06, takeProfitPct: 0.12 },
];

let lastBotTickTime: Record<number, number> = {};
let tickCounter = 0;

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

function getBotIds(): number[] {
  try {
    const fs = require("fs");
    const path = require("path");
    const dataPath = path.join(process.cwd(), ".bot-state.json");
    if (fs.existsSync(dataPath)) {
      return JSON.parse(fs.readFileSync(dataPath, "utf-8"));
    }
  } catch {}
  return [];
}

function saveBotIds(ids: number[]) {
  try {
    const fs = require("fs");
    const path = require("path");
    const dataPath = path.join(process.cwd(), ".bot-state.json");
    fs.writeFileSync(dataPath, JSON.stringify(ids));
  } catch {}
}

async function ensureBotUsers(db: any): Promise<{ id: number; name: string; config: BotConfig }[]> {
  const cached = getBotIds();
  if (cached.length >= MAX_BOTS) {
    const bots = [];
    for (let i = 0; i < MAX_BOTS; i++) {
      bots.push({ id: cached[i], name: `Bot${BOT_ADJECTIVES[i]}`, config: BOT_CONFIGS[i % BOT_CONFIGS.length] });
    }
    return bots;
  }

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

  saveBotIds(bots.map((b) => b.id));
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

    const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number } | undefined;
    if (!user || Number(user.balance) < cost) continue;

    await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(cost, botId);

    const existing = await db.prepare("SELECT id FROM holdings WHERE user_id = ? AND company_id = ?").get(botId, company.id) as { id: number } | undefined;
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

async function getRealUserActivity(db: any): Promise<Record<number, number>> {
  const recent = await db.prepare(
    "SELECT company_id, COUNT(*) as cnt FROM transactions WHERE created_at > datetime('now', '-24 hours') AND user_id NOT IN (SELECT id FROM users WHERE email LIKE 'bot_%@stockgame.uk') GROUP BY company_id"
  ).all() as { company_id: number; cnt: number }[];

  const activity: Record<number, number> = {};
  for (const r of recent) {
    activity[r.company_id] = r.cnt;
  }
  return activity;
}

async function getOrderBookState(db: any, companyId: number): Promise<{
  lowestSell: number;
  highestBuy: number;
  pendingBuyShares: number;
  pendingSellShares: number;
  pendingBuys: any[];
  pendingSells: any[];
}> {
  const pendingBuys = await db.prepare(
    "SELECT id, user_id, shares, price_per_share FROM orders WHERE company_id = ? AND type = 'buy' AND status = 'pending' ORDER BY price_per_share DESC"
  ).all(companyId) as any[];

  const pendingSells = await db.prepare(
    "SELECT id, user_id, shares, price_per_share FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' ORDER BY price_per_share ASC"
  ).all(companyId) as any[];

  return {
    lowestSell: pendingSells.length > 0 ? Number(pendingSells[0].price_per_share) : 0,
    highestBuy: pendingBuys.length > 0 ? Number(pendingBuys[0].price_per_share) : 0,
    pendingBuyShares: pendingBuys.reduce((s: number, o: any) => s + Number(o.shares), 0),
    pendingSellShares: pendingSells.reduce((s: number, o: any) => s + Number(o.shares), 0),
    pendingBuys,
    pendingSells,
  };
}

async function analyzeCompany(db: any, companyId: number, realUserActivity: Record<number, number>): Promise<{
  momentum: number;
  volatility: number;
  volume: number;
  trend: "up" | "down" | "flat";
  avgPrice: number;
  realActivity: number;
}> {
  const priceHistory = await db.prepare(
    "SELECT price, timestamp FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 24"
  ).all(companyId) as { price: number; timestamp: number }[];

  const recentTx = await db.prepare(
    "SELECT type FROM transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT 30"
  ).all(companyId) as { type: string }[];

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

  return {
    momentum,
    volatility,
    volume,
    trend,
    avgPrice,
    realActivity: realUserActivity[companyId] || 0,
  };
}

async function findCounterOpportunity(db: any, botId: number, companyId: number, rand: () => number): Promise<{
  action: "buy" | "sell";
  shares: number;
  price: number;
} | null> {
  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
  if (!company) return null;
  const currentPrice = Number(company.share_price);

  const orderBook = await getOrderBookState(db, companyId);
  const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number } | undefined;
  const balance = user ? Number(user.balance) : 0;

  const holding = await db.prepare("SELECT shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(botId, companyId) as { shares_owned: number } | undefined;
  const sharesHeld = holding?.shares_owned || 0;

  if (orderBook.pendingBuys.length > 0 && sharesHeld > 0 && rand() < 0.4) {
    const topBuy = orderBook.pendingBuys[0];
    const counterPrice = Number(topBuy.price_per_share) + 1;
    if (counterPrice <= currentPrice * 1.05) {
      const maxSell = Math.min(sharesHeld, Number(topBuy.shares));
      const shares = Math.max(1, Math.floor(rand() * maxSell) + 1);
      return { action: "sell", shares, price: counterPrice };
    }
  }

  if (orderBook.pendingSells.length > 0 && balance >= currentPrice * 2) {
    const topSell = orderBook.pendingSells[0];
    const counterPrice = Number(topSell.price_per_share) - 1;
    if (counterPrice >= currentPrice * 0.8 && counterPrice >= 5) {
      const maxBuy = Math.floor(balance / counterPrice);
      const maxShares = Math.min(4, maxBuy, Number(topSell.shares));
      const shares = Math.max(1, Math.floor(rand() * maxShares) + 1);
      return { action: "buy", shares, price: counterPrice };
    }
  }

  return null;
}

function getSmartBuyPrice(currentPrice: number, orderBook: { lowestSell: number; highestBuy: number }, rand: () => number): number {
  if (orderBook.lowestSell > 0 && orderBook.highestBuy > 0) {
    const spread = orderBook.lowestSell - orderBook.highestBuy;
    if (spread > 2) {
      return orderBook.highestBuy + 1 + Math.floor(rand() * Math.min(spread, 3));
    }
  }

  if (orderBook.lowestSell > 0) {
    const discount = 1 - (0.01 + rand() * 0.04);
    return Math.max(5, Math.floor(orderBook.lowestSell * discount));
  }

  const discount = 1 - (0.02 + rand() * 0.06);
  return Math.max(5, Math.floor(currentPrice * discount));
}

function getSmartSellPrice(currentPrice: number, orderBook: { lowestSell: number; highestBuy: number }, rand: () => number): number {
  if (orderBook.lowestSell > 0 && orderBook.highestBuy > 0) {
    const spread = orderBook.lowestSell - orderBook.highestBuy;
    if (spread > 2) {
      return orderBook.lowestSell - 1 - Math.floor(rand() * Math.min(spread, 3));
    }
  }

  if (orderBook.highestBuy > 0) {
    const premium = 1 + (0.01 + rand() * 0.04);
    return Math.floor(orderBook.highestBuy * premium);
  }

  const premium = 1 + (0.02 + rand() * 0.06);
  return Math.floor(currentPrice * premium);
}

async function pickBuyTarget(db: any, botId: number, balance: number, config: BotConfig, realUserActivity: Record<number, number>, rand: () => number): Promise<{ companyId: number; shares: number; price: number } | null> {
  const companies = await db.prepare(
    "SELECT id, share_price, total_shares FROM companies WHERE total_shares > 0 AND share_price >= 5 ORDER BY share_price ASC LIMIT 6"
  ).all() as { id: number; share_price: number; total_shares: number }[];

  if (companies.length === 0) return null;

  const existingHoldings = await db.prepare(
    "SELECT company_id, shares_owned FROM holdings WHERE user_id = ? AND shares_owned > 0"
  ).all(botId) as { company_id: number; shares_owned: number }[];

  const holdingIds = new Set(existingHoldings.map((h) => h.company_id));
  const portfolioCount = existingHoldings.length;

  const scored = [];
  for (const company of companies) {
    const analysis = await analyzeCompany(db, company.id, realUserActivity);
    let score = 30;

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

    score += analysis.realActivity * 8;

    if (holdingIds.has(company.id)) {
      score += 20;
    } else if (portfolioCount < 4) {
      score += 30;
    }

    const orderBook = await getOrderBookState(db, company.id);
    if (orderBook.pendingSellShares > 0) score += 10;
    if (orderBook.pendingBuyShares > orderBook.pendingSellShares * 2) score += 5;

    score += rand() * 25 - 12;
    scored.push({ companyId: company.id, sharePrice: Number(company.share_price), score, orderBook });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(8, scored.length));

  for (const pick of top) {
    const price = getSmartBuyPrice(pick.sharePrice, pick.orderBook, rand);
    const maxAffordable = Math.max(1, Math.floor(balance * 0.8 / price));
    const clampedShares = Math.min(maxAffordable, config.maxSharesPerTrade);
    const shares = Math.max(1, Math.floor(rand() * clampedShares) + 1);
    const totalCost = shares * price;
    if (totalCost <= balance) {
      return { companyId: pick.companyId, shares, price };
    }
  }

  return null;
}

async function pickSellTarget(db: any, botId: number, config: BotConfig, realUserActivity: Record<number, number>, rand: () => number): Promise<{ companyId: number; shares: number; price: number } | null> {
  const holdings = await db.prepare(
    "SELECT company_id, shares_owned FROM holdings WHERE user_id = ? AND shares_owned > 0"
  ).all(botId) as { company_id: number; shares_owned: number }[];

  if (holdings.length === 0) return null;

  const pick = holdings[Math.floor(rand() * holdings.length)];
  const analysis = await analyzeCompany(db, pick.company_id, realUserActivity);
  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(pick.company_id) as { share_price: number } | undefined;
  if (!company) return null;

  const currentPrice = Number(company.share_price);
  const orderBook = await getOrderBookState(db, pick.company_id);

  let sellProb = config.sellBias;

  if (analysis.trend === "down") sellProb += 0.20;
  if (analysis.trend === "up") sellProb -= 0.15;
  if (orderBook.pendingBuyShares > 0) sellProb += 0.15;
  if (analysis.realActivity > 3) sellProb += 0.10;
  if (holdings.length > 3) sellProb += 0.10;

  sellProb = Math.max(0.08, Math.min(0.85, sellProb));
  if (rand() > sellProb) return null;

  let sellFraction: number;
  if (analysis.trend === "down") {
    sellFraction = 0.3 + rand() * 0.5;
  } else if (orderBook.pendingBuyShares > 0) {
    sellFraction = 0.2 + rand() * 0.4;
  } else {
    sellFraction = 0.1 + rand() * 0.3;
  }

  const shares = Math.max(1, Math.floor(pick.shares_owned * sellFraction));
  const price = getSmartSellPrice(currentPrice, orderBook, rand);

  return { companyId: pick.company_id, shares: Math.min(shares, pick.shares_owned), price };
}

async function placeBotBuyOrder(db: any, botId: number, companyId: number, shares: number, price: number) {
  const totalCost = price * shares;
  const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number } | undefined;
  if (!user || Number(user.balance) < totalCost) return false;

  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
  const currentPrice = company ? Number(company.share_price) : price;

  let filledShares = 0;
  let totalSpent = 0;
  let lastFillPrice = price;

  if (price >= currentPrice) {
    const pendingSells = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' AND user_id != ? ORDER BY price_per_share ASC, created_at ASC"
    ).all(companyId, botId) as any[];

    let remaining = shares;
    for (const sellOrder of pendingSells) {
      if (remaining <= 0) break;
      if (Number(sellOrder.price_per_share) > price) break;
      const fillQty = Math.min(remaining, Number(sellOrder.shares));
      const fillPrice = Number(sellOrder.price_per_share);
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

      if (fillQty >= Number(sellOrder.shares)) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(sellOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, sellOrder.id);
      }

      await db.prepare("INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)").run(botId, companyId, fillQty, fillPrice, cost);
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)").run(botId, companyId, fillQty, fillPrice, new Date().toISOString());

      remaining -= fillQty;
      filledShares += fillQty;
      totalSpent += cost;
      lastFillPrice = fillPrice;
    }

    if (remaining > 0) {
      const autoPrice = Number(company?.share_price || price);
      const totalHeld = await db.prepare("SELECT SUM(shares_owned) as total FROM holdings WHERE company_id = ?").get(companyId) as { total: number } | undefined;
      const totalSharesComp = await db.prepare("SELECT total_shares FROM companies WHERE id = ?").get(companyId) as { total_shares: number } | undefined;
      const avail = Math.max(0, (totalSharesComp?.total_shares || 0) - (totalHeld?.total || 0));
      const autoQty = Math.min(remaining, avail);

      if (autoQty > 0) {
        const autoCost = autoPrice * autoQty;
        const existingH = await db.prepare("SELECT id FROM holdings WHERE user_id = ? AND company_id = ?").get(botId, companyId) as { id: number } | undefined;
        if (existingH) {
          await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(autoQty, existingH.id);
        } else {
          await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(botId, companyId, autoQty);
        }
        await db.prepare("INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)").run(botId, companyId, autoQty, autoPrice, autoCost);
        await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)").run(botId, companyId, autoQty, autoPrice, new Date().toISOString());
        remaining -= autoQty;
        filledShares += autoQty;
        totalSpent += autoCost;
      }
    }

    if (remaining > 0) {
      const refund = remaining * price;
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(refund, botId);
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)").run(botId, companyId, remaining, remaining, price, new Date().toISOString());
    } else {
      await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalSpent, botId);
    }

    if (filledShares > 0) {
      const cappedPrice = applyPriceCapToCompany(currentPrice, lastFillPrice);
      await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(cappedPrice, companyId);
      await db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(companyId, cappedPrice, Date.now());
    }
  } else {
    await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, botId);
    await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)").run(botId, companyId, shares, shares, price, new Date().toISOString());
  }

  return filledShares > 0 || true;
}

async function placeBotSellOrder(db: any, botId: number, companyId: number, shares: number, price: number) {
  const holding = await db.prepare("SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(botId, companyId) as { id: number; shares_owned: number } | undefined;
  if (!holding || holding.shares_owned < shares) return false;

  const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
  const currentPrice = company ? Number(company.share_price) : price;

  let filledShares = 0;
  let totalRevenue = 0;
  let lastFillPrice = price;

  if (price <= currentPrice) {
    const pendingBuys = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'buy' AND status = 'pending' AND user_id != ? ORDER BY price_per_share DESC, created_at ASC"
    ).all(companyId, botId) as any[];

    let remaining = shares;
    for (const buyOrder of pendingBuys) {
      if (remaining <= 0) break;
      if (Number(buyOrder.price_per_share) < price) break;
      const fillQty = Math.min(remaining, Number(buyOrder.shares));
      const fillPrice = Number(buyOrder.price_per_share);
      const grossRevenue = fillPrice * fillQty;
      const taxAmount = Math.round(grossRevenue * 0.03);
      const netRevenue = grossRevenue - taxAmount;

      const buyer = await db.prepare("SELECT is_admin FROM users WHERE id = ?").get(buyOrder.user_id) as { is_admin: any } | undefined;
      if (!buyer?.is_admin) {
        await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(netRevenue, buyOrder.user_id);
      }

      if (fillQty >= Number(buyOrder.shares)) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(buyOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, buyOrder.id);
      }

      await db.prepare("INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)").run(botId, companyId, fillQty, fillPrice, grossRevenue);
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, 'filled', ?)").run(botId, companyId, fillQty, fillPrice, new Date().toISOString());

      remaining -= fillQty;
      filledShares += fillQty;
      totalRevenue += netRevenue;
      lastFillPrice = fillPrice;
    }

    const grossRevenueBot = remaining * price;
    const taxBot = Math.round(grossRevenueBot * 0.03);
    const netBot = grossRevenueBot - taxBot;
    totalRevenue += netBot;

    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(totalRevenue, botId);

    if (remaining > 0) {
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)").run(botId, companyId, remaining, remaining, price, new Date().toISOString());
    }

    if (holding.shares_owned <= shares) {
      await db.prepare("DELETE FROM holdings WHERE id = ?").run(holding.id);
    } else {
      await db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(shares, holding.id);
    }

    if (filledShares > 0) {
      const cappedPrice = applyPriceCapToCompany(currentPrice, lastFillPrice);
      await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(cappedPrice, companyId);
      await db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(companyId, cappedPrice, Date.now());
    }
  } else {
    await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)").run(botId, companyId, shares, shares, price, new Date().toISOString());
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
async function marketMake(db: any, bots: { id: number; name: string; config: BotConfig }[]): Promise<number> {
  let trades = 0;
  const companies = await db.prepare("SELECT id, share_price FROM companies WHERE share_price >= 5").all() as { id: number; share_price: number }[];

  for (const company of companies) {
    const orderBook = await getOrderBookState(db, company.id);
    const price = Number(company.share_price);

    if (orderBook.pendingBuyShares === 0 && orderBook.pendingSellShares === 0) {
      const botIdx = Math.floor(Math.random() * Math.min(5, bots.length));
      const bot = bots[botIdx];
      const rand = seededRandom(Date.now() + company.id * 100 + botIdx);

      const buyPrice = Math.max(5, Math.floor(price * (0.95 - rand() * 0.03)));
      const sellPrice = Math.floor(price * (1.02 + rand() * 0.03));
      const shares = 1 + Math.floor(rand() * 2);

      const botUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(bot.id) as { balance: number } | undefined;
      if (botUser && Number(botUser.balance) >= buyPrice * shares) {
        await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(buyPrice * shares, bot.id);
        await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)").run(bot.id, company.id, shares, shares, buyPrice, new Date().toISOString());
        trades++;
      }

      const botForSell = bots[(botIdx + 3) % bots.length];
      const holding = await db.prepare("SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(botForSell.id, company.id) as { id: number; shares_owned: number } | undefined;
      if (holding && holding.shares_owned >= shares) {
        await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)").run(botForSell.id, company.id, shares, shares, sellPrice, new Date().toISOString());
        trades++;
      }
    } else {
      if (orderBook.pendingBuyShares === 0 && orderBook.pendingSellShares > 0 && orderBook.lowestSell > 5) {
        const botIdx = Math.floor(Math.random() * bots.length);
        const bot = bots[botIdx];
        const botUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(bot.id) as { balance: number } | undefined;
        const buyPrice = Math.max(5, orderBook.lowestSell - Math.floor(Math.random() * 3) - 1);
        if (botUser && Number(botUser.balance) >= buyPrice * 2) {
          await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(buyPrice, bot.id);
          await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', 1, 1, ?, 'pending', ?)").run(bot.id, company.id, buyPrice, new Date().toISOString());
          trades++;
        }
      }

      if (orderBook.highestBuy > 0 && orderBook.pendingSellShares === 0) {
        const botIdx = Math.floor(Math.random() * bots.length);
        const bot = bots[botIdx];
        const holding = await db.prepare("SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(bot.id, company.id) as { id: number; shares_owned: number } | undefined;
        if (holding && holding.shares_owned > 0) {
          const sellPrice = orderBook.highestBuy + Math.floor(Math.random() * 3) + 1;
          await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', 1, 1, ?, 'pending', ?)").run(bot.id, company.id, sellPrice, new Date().toISOString());
          trades++;
        }
      }

      if (orderBook.lowestSell > 0 && orderBook.highestBuy > 0) {
        const spread = orderBook.lowestSell - orderBook.highestBuy;
        if (spread > 3) {
          const botIdx = Math.floor(Math.random() * bots.length);
          const bot = bots[botIdx];
          const midPrice = Math.floor((orderBook.lowestSell + orderBook.highestBuy) / 2);

          const holding = await db.prepare("SELECT shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(bot.id, company.id) as { shares_owned: number } | undefined;
          if (holding && holding.shares_owned > 0 && Math.random() < 0.5) {
            const sellPrice = midPrice + 1;
            if (sellPrice >= 5) {
              await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', 1, 1, ?, 'pending', ?)").run(bot.id, company.id, sellPrice, new Date().toISOString());
              trades++;
            }
          } else {
            const botUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(bot.id) as { balance: number } | undefined;
            if (botUser && Number(botUser.balance) >= midPrice) {
              const buyPrice = midPrice - 1;
              if (buyPrice >= 5) {
                await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(buyPrice, bot.id);
                await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', 1, 1, ?, 'pending', ?)").run(bot.id, company.id, buyPrice, new Date().toISOString());
                trades++;
              }
            }
          }
        }
      }
    }
  }

  return trades;
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
  tickCounter++;
  let totalTrades = 0;

  const botIds = bots.map((b) => b.id);
  const placeholders = botIds.map(() => "?").join(",");
  const botUserRows = await db.prepare(
    `SELECT id, balance FROM users WHERE id IN (${placeholders})`
  ).all(...botIds) as { id: number; balance: number }[];

  const brokeIds = botUserRows.filter((u) => Number(u.balance) < 500).map((u) => u.id);
  if (brokeIds.length > 0) {
    const bp = brokeIds.map(() => "?").join(",");
    await db.prepare(
      `UPDATE users SET balance = ${BOT_INITIAL_CASH} WHERE id IN (${bp}) AND balance < 500`
    ).all(...brokeIds);
    for (const bu of botUserRows) {
      if (Number(bu.balance) < 500) bu.balance = BOT_INITIAL_CASH;
    }
  }

  const allBalances: Record<number, number> = {};
  for (const bu of botUserRows) allBalances[bu.id] = Number(bu.balance);

  const allHoldings: Record<number, { company_id: number; shares_owned: number }[]> = {};
  for (const bot of bots) {
    allHoldings[bot.id] = await db.prepare(
      "SELECT company_id, shares_owned FROM holdings WHERE user_id = ? AND shares_owned > 0"
    ).all(bot.id) as { company_id: number; shares_owned: number }[];
  }

  const companies = await db.prepare("SELECT id, share_price FROM companies WHERE total_shares > 0 AND share_price >= 5").all() as { id: number; share_price: number }[];

  const obQueries = await Promise.all(
    companies.map((c) => getOrderBookState(db, c.id))
  );
  const orderBooks: Record<number, any> = {};
  companies.forEach((c, i) => { orderBooks[c.id] = obQueries[i]; });

  const shuffledBots = [...bots].sort(() => Math.random() - 0.5);
  const maxTraders = Math.min(5, shuffledBots.length);

  for (let bi = 0; bi < maxTraders && totalTrades < 8; bi++) {
    const bot = shuffledBots[bi];
    const balance = allBalances[bot.id] ?? 0;
    const holdings = allHoldings[bot.id] || [];
    const hasStocks = holdings.length > 0;

    if (hasStocks) {
      const pick = holdings[Math.floor(Math.random() * holdings.length)];
      const ob = orderBooks[pick.company_id];
      if (ob && ob.highestBuy > 0) {
        const company = companies.find((c) => c.id === pick.company_id);
        const currentPrice = company ? Number(company.share_price) : 0;
        const sellPrice = Math.min(ob.highestBuy + 1, currentPrice + 2);
        if (sellPrice >= 5) {
          const shares = Math.max(1, Math.floor(Math.random() * Math.min(pick.shares_owned, 3)) + 1);
          const ok = await placeBotSellOrder(db, bot.id, pick.company_id, Math.min(shares, pick.shares_owned), sellPrice);
          if (ok) { totalTrades++; allBalances[bot.id] = balance; continue; }
        }
      }
    }

    if (balance >= 10) {
      const affordable = companies.filter((c) => {
        const ob = orderBooks[c.id];
        if (ob && ob.lowestSell > 0 && ob.lowestSell <= balance * 0.5) return true;
        return Number(c.share_price) <= balance * 0.5;
      });
      if (affordable.length > 0) {
        const pick = affordable[Math.floor(Math.random() * affordable.length)];
        const ob = orderBooks[pick.id];
        const currentPrice = Number(pick.share_price);
        let buyPrice: number;
        if (ob && ob.highestBuy > 0) {
          buyPrice = Math.min(ob.lowestSell > 0 ? ob.lowestSell - 1 : currentPrice - 1, ob.highestBuy + 2);
        } else {
          buyPrice = Math.max(5, Math.floor(currentPrice * (0.92 + Math.random() * 0.05)));
        }
        buyPrice = Math.max(5, buyPrice);
        const shares = Math.max(1, Math.min(bot.config.maxSharesPerTrade, Math.floor(balance * 0.4 / buyPrice)));
        if (shares >= 1 && buyPrice * shares <= balance) {
          const ok = await placeBotBuyOrder(db, bot.id, pick.id, shares, buyPrice);
          if (ok) {
            totalTrades++;
            allBalances[bot.id] = balance - buyPrice * shares;
          }
        }
      }
    }
  }

  return {
    botsEnabled: true,
    tradesExecuted: totalTrades,
    message: totalTrades > 0 ? `Bots: ${totalTrades} trade${totalTrades > 1 ? "s" : ""}` : "No bot trades",
  };
}
