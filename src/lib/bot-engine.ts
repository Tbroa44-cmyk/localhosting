import getDb, { insertPriceHistory } from "@/lib/db";
import { isTradingOpen, getTradingInfo } from "@/lib/trading-hours";
import { addShares, removeShares, getHolding } from "@/lib/holdings";
import { issueCertificates, transferCertificates, reserveCertificates, releaseCertificates, countActive, countTotalForCompany, verifyIntegrity } from "@/lib/certificates";

const BOT_INITIAL_CASH = 5000;
const BOT_COOLDOWN_MS = 10000;
const MAX_BOTS = 25;

const BOT_NUMBERS = Array.from({ length: 25 }, (_, i) => String(i + 1));

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
  { riskLevel: "conservative", tradesPerHour: 20, maxSharesPerTrade: 5, buyBias: 0.50, sellBias: 0.45, stopLossPct: 0.15, takeProfitPct: 0.30 },
  { riskLevel: "balanced", tradesPerHour: 30, maxSharesPerTrade: 6, buyBias: 0.55, sellBias: 0.50, stopLossPct: 0.10, takeProfitPct: 0.22 },
  { riskLevel: "aggressive", tradesPerHour: 40, maxSharesPerTrade: 8, buyBias: 0.60, sellBias: 0.55, stopLossPct: 0.08, takeProfitPct: 0.15 },
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
    const firstBot = await db.prepare("SELECT id FROM users WHERE id = ?").get(cached[0]) as { id: number } | undefined;
    if (firstBot) {
      const bots = [];
      for (let i = 0; i < MAX_BOTS; i++) {
        bots.push({ id: cached[i], name: `Bot${BOT_NUMBERS[i]}`, config: BOT_CONFIGS[i % BOT_CONFIGS.length] });
      }
      return bots;
    }
    saveBotIds([]);
  }

  const bots: { id: number; name: string; config: BotConfig }[] = [];

  for (let i = 0; i < MAX_BOTS; i++) {
    const name = `Bot${BOT_NUMBERS[i]}`;
    const email = `bot${BOT_NUMBERS[i]}@stockgame.uk`;

    let bot = await db.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number } | undefined;

    if (!bot) {
      const bcryptHash = "$2a$10$LKjhN4bK5hGF5q6R8x9Z0uY7x3v2mK8nJ4pQ2wS6dF0gH1jL3kM5n";
      const result = await db.prepare(
        "INSERT INTO users (username, email, password, balance, is_admin, allowed, role, xp, level) VALUES (?, ?, ?, ?, 0, 0, 'Bot', 0, 1)"
      ).run(name, email, bcryptHash, BOT_INITIAL_CASH);
      bot = { id: result.lastInsertRowid as number };
      await seedBotShares(db, bot.id, i);
    } else {
      try { await db.prepare("UPDATE users SET role = 'Bot' WHERE id = ? AND (role IS NULL OR role != 'Bot')").run(bot.id); } catch {}
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

  const admin = await db.prepare("SELECT id FROM users WHERE email = ?").get("T-ADMIN@stocksim.com") as { id: number } | undefined;
  if (!admin) return;

  const seeded = new Set<number>();
  const numPositions = 1 + (botIndex % 3);

  for (let p = 0; p < numPositions; p++) {
    const idx = (botIndex + p * 3) % companies.length;
    if (seeded.has(idx)) continue;
    seeded.add(idx);

    const company = companies[idx];
    const shares = 5 + (botIndex % 8);
    const price = Number(company.share_price);
    const cost = price * shares;

    const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(botId) as { balance: number } | undefined;
    if (!user || Number(user.balance) < cost) continue;

    const adminCerts = await countActive(db, company.id, admin.id);
    if (adminCerts < shares) continue;

    await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(cost, botId);
    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(cost, admin.id);

    await addShares(db, botId, company.id, shares, "bot_market_buy");
    await removeShares(db, admin.id, company.id, shares, "bot_market_buy");
    await transferCertificates(db, company.id, admin.id, botId, shares);

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
    "SELECT id, share_price, total_shares FROM companies WHERE total_shares > 0 AND share_price >= 5 ORDER BY share_price ASC"
  ).all() as { id: number; share_price: number; total_shares: number }[];

  if (companies.length === 0) return null;

  for (let i = companies.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [companies[i], companies[j]] = [companies[j], companies[i]];
  }

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

  const company = await db.prepare("SELECT share_price, total_shares FROM companies WHERE id = ?").get(companyId) as { share_price: number; total_shares: number } | undefined;
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

      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);

      try {
        await removeShares(db, sellOrder.user_id, companyId, fillQty, "bot_buy_fill", sellOrder.id);
      } catch (e: any) {
        console.error(`Bot buy seller holding error:`, e?.message || e);
      }

      await addShares(db, botId, companyId, fillQty, "bot_buy_fill", sellOrder.id);
      try {
        await transferCertificates(db, companyId, sellOrder.user_id, botId, fillQty);
      } catch (e: any) {
        console.error(`Bot buy certificate transfer error:`, e?.message || e);
      }

      await db.prepare(
        "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)"
      ).run(sellOrder.user_id, companyId, fillQty, fillPrice, sellerRevenue);

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

    let balanceDeduction = totalSpent;

    if (remaining > 0) {
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)").run(botId, companyId, remaining, remaining, price, new Date().toISOString());
      balanceDeduction += remaining * price;
    }

    await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(balanceDeduction, botId);

    if (filledShares > 0) {
      const cappedPrice = applyPriceCapToCompany(currentPrice, lastFillPrice, filledShares, company?.total_shares);
      await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(cappedPrice, companyId);
      await insertPriceHistory(companyId, cappedPrice, Date.now());
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
  const reservedSells = await db.prepare("SELECT SUM(shares) as reserved FROM orders WHERE user_id = ? AND company_id = ? AND type = 'sell' AND status = 'pending'").all(botId, companyId) as { reserved: number }[];
  const reserved = reservedSells[0]?.reserved || 0;
  if (holding.shares_owned - reserved < shares) return false;

  const company = await db.prepare("SELECT share_price, total_shares FROM companies WHERE id = ?").get(companyId) as { share_price: number; total_shares: number } | undefined;
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

      const debitResult = await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?").run(grossRevenue, buyOrder.user_id, grossRevenue);
      if (debitResult.changes === 0) continue;

      try {
        await removeShares(db, botId, companyId, fillQty, "bot_sell_fill", buyOrder.id);
      } catch (e: any) {
        console.error(`Bot sell holding error:`, e?.message || e);
      }
      await addShares(db, buyOrder.user_id, companyId, fillQty, "bot_sell_fill", buyOrder.id);
      try {
        await transferCertificates(db, companyId, botId, buyOrder.user_id, fillQty);
      } catch (e: any) {
        console.error(`Bot sell certificate transfer error:`, e?.message || e);
      }

      if (fillQty >= Number(buyOrder.shares)) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(buyOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, buyOrder.id);
      }

      await db.prepare("INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)").run(botId, companyId, fillQty, fillPrice, grossRevenue);
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, 'filled', ?)").run(botId, companyId, fillQty, fillPrice, new Date().toISOString());

      await db.prepare("INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)").run(buyOrder.user_id, companyId, fillQty, fillPrice, grossRevenue);

      remaining -= fillQty;
      filledShares += fillQty;
      totalRevenue += netRevenue;
      lastFillPrice = fillPrice;
    }

    if (filledShares > 0) {
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(totalRevenue, botId);
    }

    if (remaining > 0) {
      const result = await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)").run(botId, companyId, remaining, remaining, price, new Date().toISOString());
      await reserveCertificates(db, companyId, botId, remaining, result.lastInsertRowid as number);
    }

    if (filledShares > 0) {
      const cappedPrice = applyPriceCapToCompany(currentPrice, lastFillPrice, filledShares, company?.total_shares);
      await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(cappedPrice, companyId);
      await insertPriceHistory(companyId, cappedPrice, Date.now());
    }
  } else {
    const result = await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)").run(botId, companyId, shares, shares, price, new Date().toISOString());
    await reserveCertificates(db, companyId, botId, shares, result.lastInsertRowid as number);
  }

  return true;
}

function applyPriceCapToCompany(currentPrice: number, tradePrice: number, tradeShares?: number, totalShares?: number): number {
  if (currentPrice <= 0) return tradePrice;
  const change = tradePrice - currentPrice;
  if (change === 0) return tradePrice;
  let maxChangePercent = 0.25;
  if (tradeShares && totalShares && totalShares > 0) {
    const supplyRatio = tradeShares / totalShares;
    maxChangePercent = Math.min(0.75, Math.max(0.15, supplyRatio * 3));
  }
  const maxDelta = currentPrice * maxChangePercent;
  if (Math.abs(change) <= maxDelta) return tradePrice;
  const direction = change > 0 ? 1 : -1;
  return Math.max(5, Math.round(currentPrice + direction * maxDelta));
}
async function marketMake(db: any, bots: { id: number; name: string; config: BotConfig }[]): Promise<number> {
  let trades = 0;
  const companies = await db.prepare("SELECT id, share_price FROM companies WHERE share_price >= 5").all() as { id: number; share_price: number }[];

  for (const company of companies) {
    if (trades >= 4) break;
    const orderBook = await getOrderBookState(db, company.id);
    const price = Number(company.share_price);

    if (orderBook.pendingBuyShares === 0 && orderBook.pendingSellShares === 0) {
      const botIdx = Math.floor(Math.random() * Math.min(6, bots.length));
      const bot = bots[botIdx];
      const rand = seededRandom(Date.now() + company.id * 100 + botIdx);

      const buyPrice = Math.max(5, Math.floor(price * (0.97 - rand() * 0.01)));
      const sellPrice = Math.floor(price * (1.02 + rand() * 0.01));
      const shares = 1 + Math.floor(rand() * 2);

      const botUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(bot.id) as { balance: number } | undefined;
      if (botUser && Number(botUser.balance) >= buyPrice * shares) {
        await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(buyPrice * shares, bot.id);
        await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?)").run(bot.id, company.id, shares, shares, buyPrice, new Date().toISOString());
        trades++;
      }

      if (trades >= 4) break;
      const botForSell = bots[(botIdx + 3) % bots.length];
      const holding = await db.prepare("SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(botForSell.id, company.id) as { id: number; shares_owned: number } | undefined;
      const certCount = await countActive(db, company.id, botForSell.id);
      if (holding && holding.shares_owned >= shares && certCount >= shares) {
        const result = await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, ?, 'pending', ?)").run(botForSell.id, company.id, shares, shares, sellPrice, new Date().toISOString());
        await reserveCertificates(db, company.id, botForSell.id, shares, result.lastInsertRowid as number);
        trades++;
      }
    }
  }

  return trades;
}

async function botToBotMatch(db: any, bots: { id: number; name: string; config: BotConfig }[]): Promise<number> {
  let trades = 0;
  const botIds = bots.map(b => b.id);
  if (botIds.length === 0) return 0;
  const placeholders = botIds.map(() => "?").join(",");

  const pendingBuys = await db.prepare(
    `SELECT id, user_id, company_id, shares, price_per_share FROM orders WHERE type = 'buy' AND status = 'pending' AND user_id IN (${placeholders}) ORDER BY price_per_share DESC`
  ).all(...botIds) as any[];

  const pendingSells = await db.prepare(
    `SELECT id, user_id, company_id, shares, price_per_share FROM orders WHERE type = 'sell' AND status = 'pending' AND user_id IN (${placeholders}) ORDER BY price_per_share ASC`
  ).all(...botIds) as any[];

  if (pendingBuys.length === 0 || pendingSells.length === 0) return 0;

  const sellsByCompany: Record<number, any[]> = {};
  for (const s of pendingSells) {
    const cid = Number(s.company_id);
    if (!sellsByCompany[cid]) sellsByCompany[cid] = [];
    sellsByCompany[cid].push(s);
  }

  for (const buyOrder of pendingBuys) {
    if (trades >= 3) break;
    const companyId = Number(buyOrder.company_id);
    const buyPrice = Number(buyOrder.price_per_share);
    const buyShares = Number(buyOrder.shares);
    const buyBotId = Number(buyOrder.user_id);

    const sells = sellsByCompany[companyId];
    if (!sells || sells.length === 0) continue;

    const matchingSells = sells.filter(s => {
      const sellPrice = Number(s.price_per_share);
      return sellPrice <= buyPrice && Number(s.user_id) !== buyBotId && Number(s.shares) > 0;
    });

    if (matchingSells.length === 0) continue;

    let remaining = buyShares;
    for (const sellOrder of matchingSells) {
      if (remaining <= 0) break;
      if (trades >= 3) break;

      const fillQty = Math.min(remaining, Number(sellOrder.shares));
      const fillPrice = Number(sellOrder.price_per_share);
      const grossCost = fillPrice * fillQty;
      const taxAmount = Math.round(grossCost * 0.03);
      const sellerRevenue = grossCost - taxAmount;

      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
      await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(grossCost, buyBotId);

      try {
        await removeShares(db, sellOrder.user_id, companyId, fillQty, "bot_match_sell", sellOrder.id);
      } catch (e: any) {
        console.error(`botToBotMatch seller holding error:`, e?.message || e);
      }

      await addShares(db, buyBotId, companyId, fillQty, "bot_match_buy", buyOrder.id);

      try {
        const certIds = await db.prepare(
          "SELECT id FROM share_certificates WHERE company_id = ? AND status = 'pending_order' AND order_id = ? LIMIT ?"
        ).all(companyId, sellOrder.id, fillQty) as { id: number }[];
        if (certIds.length > 0) {
          const ph = certIds.map(() => "?").join(",");
          await db.prepare(
            `UPDATE share_certificates SET owner_id = ?, status = 'active', order_id = NULL WHERE id IN (${ph})`
          ).run(buyBotId, ...certIds.map((c) => c.id));
        } else {
          await transferCertificates(db, companyId, sellOrder.user_id, buyBotId, fillQty);
        }
      } catch (e: any) {
        console.error(`botToBotMatch certificate transfer error:`, e?.message || e);
      }

      if (fillQty >= Number(sellOrder.shares)) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(sellOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, sellOrder.id);
      }

      if (fillQty >= remaining) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(buyOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, buyOrder.id);
      }

      await db.prepare("INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)").run(sellOrder.user_id, companyId, fillQty, fillPrice, grossCost);
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'sell', ?, ?, 'filled', ?)").run(sellOrder.user_id, companyId, fillQty, fillPrice, new Date().toISOString());

      await db.prepare("INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)").run(buyBotId, companyId, fillQty, fillPrice, grossCost);
      await db.prepare("INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)").run(buyBotId, companyId, fillQty, fillPrice, new Date().toISOString());

      remaining -= fillQty;
      sellOrder.shares = Number(sellOrder.shares) - fillQty;
      trades++;

      const company = await db.prepare("SELECT share_price, total_shares FROM companies WHERE id = ?").get(companyId) as { share_price: number; total_shares: number } | undefined;
      if (company) {
        const cappedPrice = applyPriceCapToCompany(Number(company.share_price), fillPrice, fillQty, company.total_shares);
        await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(cappedPrice, companyId);
        await insertPriceHistory(companyId, cappedPrice, Date.now());
      }
    }
  }

  return trades;
}

async function adjustPricesByPressure(db: any, companies: { id: number; share_price: number }[]) {
  let botIds: number[] = [];
  try {
    const bots = await db.prepare("SELECT id FROM users WHERE role = 'Bot'").all() as { id: number }[];
    botIds = (Array.isArray(bots) ? bots : []).map((b) => b.id);
  } catch {}

  for (const c of companies) {
    try {
      const companyId = c.id;
      const price = Number(c.share_price);
      if (price < 5) continue;

      let recentTx: { type: string; shares: number }[] = [];
      if (botIds.length > 0) {
        const ph = botIds.map(() => "?").join(",");
        recentTx = await db.prepare(
          `SELECT type, shares FROM transactions WHERE company_id = ? AND user_id NOT IN (${ph}) ORDER BY created_at DESC LIMIT 100`
        ).all(companyId, ...botIds) as { type: string; shares: number }[];
      } else {
        recentTx = await db.prepare(
          "SELECT type, shares FROM transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT 100"
        ).all(companyId) as { type: string; shares: number }[];
      }

      let buyShares = 0;
      let sellShares = 0;
      for (const tx of recentTx) {
        if (tx.type === "buy") buyShares += Number(tx.shares);
        else sellShares += Number(tx.shares);
      }

      const company = await db.prepare("SELECT total_shares, initial_shares FROM companies WHERE id = ?").get(companyId) as { total_shares: number; initial_shares: number } | undefined;
      if (!company) continue;
      const totalShares = Number(company.total_shares);
      const initialShares = Number(company.initial_shares || totalShares);

      let heldShares = 0;
      try {
        const holdings = await db.prepare("SELECT shares_owned FROM holdings WHERE company_id = ?").all(companyId) as { shares_owned: number }[];
        heldShares = (Array.isArray(holdings) ? holdings : []).reduce((s, h) => s + Number(h.shares_owned || 0), 0);
      } catch {}

      let adjustment = 0;

      // Lingering effects from press releases
      try {
        const lingeringPRs = await db.prepare(
          "SELECT id, type, lingering_remaining FROM press_releases WHERE company_id = ? AND lingering_remaining > 0 ORDER BY created_at ASC"
        ).all(companyId) as { id: number; type: string; lingering_remaining: number }[];
        for (const pr of lingeringPRs) {
          const applyCents = Math.max(1, Math.ceil(Number(pr.lingering_remaining) * 0.05));
          if (pr.type === "positive") {
            adjustment += applyCents;
          } else {
            adjustment -= applyCents;
          }
          const newRemaining = Number(pr.lingering_remaining) - applyCents;
          await db.prepare("UPDATE press_releases SET lingering_remaining = ? WHERE id = ?").run(Math.max(0, newRemaining), pr.id);
        }
      } catch {}

      const recentSharesReleased = totalShares > initialShares;
      const heldRatio = totalShares > 0 ? heldShares / totalShares : 1;
      const totalTxShares = buyShares + sellShares;
      const buyRatio = totalTxShares > 0 ? buyShares / totalTxShares : 0.5;

      if (recentSharesReleased) {
        const releasePct = (totalShares - initialShares) / initialShares;
        adjustment -= Math.round(price * Math.min(releasePct * 0.005, 0.01));
      }

      if (buyRatio > 0.6) {
        const strength = (buyRatio - 0.6) / 0.4;
        adjustment += Math.round(price * strength * 0.003);
      } else if (buyRatio < 0.4) {
        const strength = (0.4 - buyRatio) / 0.4;
        adjustment -= Math.round(price * strength * 0.003);
      }

      if (heldRatio > 0.5 && sellShares > 0) {
        const holdStrength = (heldRatio - 0.5) * 2;
        adjustment += Math.round(price * holdStrength * 0.001);
      }

      if (heldRatio < 0.3 && sellShares > buyShares * 1.5) {
        const sellPressure = (buyRatio < 0.3 ? 0.3 - buyRatio : 0);
        adjustment -= Math.round(price * sellPressure * 0.002);
      }

      if (adjustment !== 0) {
        const newPrice = Math.max(5, price + adjustment);
        if (newPrice !== price) {
          await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, companyId);
          await insertPriceHistory(companyId, newPrice, Date.now());
        }
      }
    } catch {}
  }
}

export async function runBotTick(): Promise<{ botsEnabled: boolean; tradesExecuted: number; message: string }> {
  const db = getDb();

  const settings = await db.prepare("SELECT bots_enabled FROM settings WHERE id = 1").get() as { bots_enabled: number } | undefined;
  if (!settings || settings.bots_enabled === 0) {
    return { botsEnabled: false, tradesExecuted: 0, message: "Bots disabled" };
  }

  const tradingInfo = await getTradingInfo(db);
  if (tradingInfo.emergencyClose) {
    return { botsEnabled: true, tradesExecuted: 0, message: `Session closed: ${tradingInfo.emergencyMessage}` };
  }

  if (!tradingInfo.isOpen) {
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

  const brokeIds = botUserRows.filter((u) => Number(u.balance) < 1000).map((u) => u.id);
  if (brokeIds.length > 0) {
    const bp = brokeIds.map(() => "?").join(",");
    await db.prepare(
      `UPDATE users SET balance = ${BOT_INITIAL_CASH} WHERE id IN (${bp}) AND balance < 1000`
    ).all(...brokeIds);
    for (const bu of botUserRows) {
      if (Number(bu.balance) < 1000) bu.balance = BOT_INITIAL_CASH;
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

  const companies = await db.prepare("SELECT id, share_price FROM companies WHERE total_shares > 0 AND share_price >= 5 AND delisted = 0").all() as { id: number; share_price: number }[];

  for (const c of companies) {
    const price = Number(c.share_price);
    if (price > 0) {
      await db.prepare("UPDATE orders SET price_per_share = ? WHERE company_id = ? AND status = 'pending' AND price_per_share != ?").run(price, c.id, price);
    }
  }

  await adjustPricesByPressure(db, companies);

  let recentPressReleases: Record<number, { type: string; severity: number }> = {};
  try {
    const dayAgo = new Date(Date.now() - 86400000).toISOString();
    const prs = await db.prepare(
      "SELECT company_id, type, severity FROM press_releases WHERE created_at >= ? ORDER BY created_at DESC"
    ).all(dayAgo) as { company_id: number; type: string; severity: number }[];
    if (Array.isArray(prs)) {
      for (const pr of prs) {
        if (!recentPressReleases[pr.company_id]) {
          recentPressReleases[pr.company_id] = { type: pr.type, severity: Number(pr.severity) || 1 };
        }
      }
    }
  } catch {}

  const obQueries = await Promise.all(
    companies.map((c) => getOrderBookState(db, c.id))
  );
  const orderBooks: Record<number, any> = {};
  companies.forEach((c, i) => { orderBooks[c.id] = obQueries[i]; });

  const mmTrades = await marketMake(db, bots);
  totalTrades += mmTrades;

  const matchTrades = await botToBotMatch(db, bots);
  totalTrades += matchTrades;

  const shuffledBots = [...bots].sort(() => Math.random() - 0.5);

  for (const bot of shuffledBots) {
    if (totalTrades >= 10) break;
    const lastTick = lastBotTickTime[bot.id] || 0;
    if (now - lastTick < BOT_COOLDOWN_MS) continue;
    lastBotTickTime[bot.id] = now;
    const balance = allBalances[bot.id] ?? 0;
    const holdings = allHoldings[bot.id] || [];
    const hasStocks = holdings.length > 0;

    const prForCompany = (companyId: number) => recentPressReleases[companyId];

    if (hasStocks && Math.random() < 0.2) {
      const pick = holdings[Math.floor(Math.random() * holdings.length)];
      const ob = orderBooks[pick.company_id];
      const company = companies.find((c) => c.id === pick.company_id);
      const currentPrice = company ? Number(company.share_price) : 0;

      const pr = prForCompany(pick.company_id);
      const sellMod = pr && pr.type === "negative" ? Math.min(pr.severity * 0.05, 0.3) : 0;
      if (Math.random() < sellMod) {
        const sellPrice = Math.max(5, Math.floor(currentPrice * (0.95 - Math.random() * 0.05)));
        const shares = Math.max(1, Math.floor(Math.random() * Math.min(pick.shares_owned, bot.config.maxSharesPerTrade)) + 1);
        const ok = await placeBotSellOrder(db, bot.id, pick.company_id, Math.min(shares, pick.shares_owned), sellPrice);
        if (ok) { totalTrades++; const reloaded = await db.prepare("SELECT balance FROM users WHERE id = ?").get(bot.id) as { balance: number } | undefined; if (reloaded) allBalances[bot.id] = Number(reloaded.balance); continue; }
      }

      let sellPrice: number;
      if (ob && ob.highestBuy > 0) {
        sellPrice = Math.max(5, ob.highestBuy + Math.floor(Math.random() * 3));
      } else {
        sellPrice = Math.max(5, Math.floor(currentPrice * (1 + Math.random() * 0.04)));
      }
      const shares = Math.max(1, Math.floor(Math.random() * Math.min(pick.shares_owned, bot.config.maxSharesPerTrade)) + 1);
      const ok = await placeBotSellOrder(db, bot.id, pick.company_id, Math.min(shares, pick.shares_owned), sellPrice);
      if (ok) {
        totalTrades++;
        const reloaded = await db.prepare("SELECT balance FROM users WHERE id = ?").get(bot.id) as { balance: number } | undefined;
        if (reloaded) allBalances[bot.id] = Number(reloaded.balance);
        continue;
      }
    }

    if (balance >= 10) {
      let buyProb = 0.25;
      const affordable = companies.filter((c) => {
        const ob = orderBooks[c.id];
        if (ob && ob.lowestSell > 0 && ob.lowestSell <= balance * 0.6) return true;
        return Number(c.share_price) <= balance * 0.6;
      });
      const posPR = affordable.find((c) => { const pr = prForCompany(c.id); return pr && pr.type === "positive"; });
      if (posPR) buyProb += 0.15;
      if (Math.random() < buyProb && affordable.length > 0) {
        const pick = affordable[Math.floor(Math.random() * affordable.length)];
        const ob = orderBooks[pick.id];
        const currentPrice = Number(pick.share_price);
        let buyPrice: number;
        if (ob && ob.lowestSell > 0) {
          buyPrice = Math.min(ob.lowestSell + Math.floor(Math.random() * 3), ob.lowestSell + 2);
        } else if (ob && ob.highestBuy > 0) {
          buyPrice = Math.max(ob.highestBuy + 1, currentPrice - Math.floor(Math.random() * 5));
        } else {
          buyPrice = Math.max(5, Math.floor(currentPrice * (0.95 + Math.random() * 0.08)));
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
