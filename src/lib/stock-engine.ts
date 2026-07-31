import getDb, { insertPriceHistory, updateCompanyPrice } from "@/lib/db";
import { formatCoins } from "@/lib/format";
import { isTradingOpen as isTradingOpenCore } from "@/lib/trading-hours";
import { addShares, removeShares, getHolding } from "@/lib/holdings";
import { transferCertificates, reserveCertificates, releaseCertificates, preTransferCheck, verifyIntegrity } from "@/lib/certificates";

const PRICE_CHANGE_PERCENT = 0.02;
const SELL_TAX_PERCENT = 0.03;
const MIN_PRICE_CHANGE_CAP = 0.15;
const MAX_PRICE_CHANGE_CAP = 0.75;
const MIN_SELL_FLOOR = 1;

async function isTradingOpen(db: any): Promise<boolean> {
  return isTradingOpenCore(db);
}

export async function awardXP(db: any, userId: number, amount: number) {
  try {
    const user = await db.prepare("SELECT xp FROM users WHERE id = ?").get(userId) as { xp: number } | undefined;
    if (!user) return;
    const newXp = (user.xp || 0) + amount;
    const newLevel = Math.floor(newXp / 1000) + 1;
    await db.prepare("UPDATE users SET xp = ?, level = ? WHERE id = ?").run(newXp, newLevel, userId);
  } catch (e: any) {
    console.error("Failed to award XP:", e?.message || e);
  }
}

export function calculateBuyPrice(currentPrice: number, shares: number): number {
  const priceIncrease = currentPrice * PRICE_CHANGE_PERCENT * shares;
  return Math.round(currentPrice + priceIncrease);
}

export function calculateSellPrice(currentPrice: number, shares: number, totalShares?: number): number {
  if (totalShares && totalShares > 0) {
    const supplyRatio = shares / totalShares;
    const impact = Math.min(supplyRatio * 4, 0.85);
    return Math.max(MIN_SELL_FLOOR, Math.round(currentPrice * (1 - impact)));
  }
  const priceDecrease = currentPrice * PRICE_CHANGE_PERCENT * shares;
  return Math.max(MIN_SELL_FLOOR, Math.round(currentPrice - priceDecrease));
}

function getDynamicCap(tradeShares?: number, totalShares?: number): number {
  if (!tradeShares || !totalShares || totalShares <= 0) return MIN_PRICE_CHANGE_CAP;
  const supplyRatio = tradeShares / totalShares;
  return Math.min(MAX_PRICE_CHANGE_CAP, Math.max(MIN_PRICE_CHANGE_CAP, supplyRatio * 3));
}

function applyPriceCap(currentPrice: number, newPrice: number, tradeShares?: number, totalShares?: number): number {
  if (currentPrice <= 0) return newPrice;
  const change = newPrice - currentPrice;
  if (change === 0) return newPrice;
  const maxChange = getDynamicCap(tradeShares, totalShares);
  const maxDelta = currentPrice * maxChange;
  if (Math.abs(change) <= maxDelta) return newPrice;
  const direction = change > 0 ? 1 : -1;
  return Math.round(currentPrice + direction * maxDelta);
}

async function recordPriceHistory(db: any, companyId: number, price: number) {
  try {
    await insertPriceHistory(companyId, price, Date.now());
  } catch (e: any) {
    console.error("Failed to record price history:", e?.message || e);
  }
}

export async function setPriceFromTrade(db: any, companyId: number, tradePrice: number, tradeShares?: number): Promise<number> {
  const row = await db.prepare("SELECT share_price, total_shares FROM companies WHERE id = ?").get(companyId) as { share_price: number; total_shares: number } | undefined;
  const currentPrice = row ? Number(row.share_price) : 0;
  const totalShares = row ? Number(row.total_shares) : undefined;
  const cappedPrice = applyPriceCap(currentPrice, tradePrice, tradeShares, totalShares);
  await updateCompanyPrice(companyId, cappedPrice);
  await recordPriceHistory(db, companyId, cappedPrice);
  return cappedPrice;
}

async function getBankFund(db: any): Promise<number> {
  const row = await db.prepare("SELECT * FROM bank_fund WHERE id = 1").all() as { balance: number }[];
  return row[0] ? row[0].balance : 0;
}

async function addToBankFund(db: any, amount: number) {
  const current = await getBankFund(db);
  await db.prepare("UPDATE bank_fund SET balance = ? WHERE id = 1").run(current + amount);
}

export async function executeBuy(userId: number, companyId: number, shares: number, requestId?: string) {
  const db = getDb();

  const buyTransaction = await db.transaction(async () => {
    if (requestId) {
      const existing = await db.prepare(
        "SELECT id, status FROM orders WHERE request_id = ? AND user_id = ? AND company_id = ? AND type = 'buy'"
      ).get(requestId, userId, companyId) as any;
      if (existing) {
        return { newBalance: -1, newPrice: 0, totalCost: 0, duplicate: true, message: `Duplicate order ignored (${existing.status})` };
      }
    }

    const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; name: string; ticker: string; share_price: number; total_shares: number; delisted: number;
    } | undefined;

    if (!company) throw new Error("Company not found");
    company.share_price = Number(company.share_price);
    company.total_shares = Number(company.total_shares);
    if (company.share_price < 5) throw new Error("Share price too low to trade (minimum 0.05c)");
    if (company.delisted) throw new Error("This stock is delisted and cannot be traded");

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as {
      id: number; balance: number;
    } | undefined;

    if (!user) throw new Error("User not found");
    const buyerBalance = Number(user.balance) || 0;
    if (buyerBalance < company.share_price) {
      throw new Error(`Insufficient balance. You need at least ${formatCoins(company.share_price)} but have ${formatCoins(buyerBalance)}`);
    }

    if (!(await isTradingOpen(db))) {
      return await placeLimitOrder(userId, companyId, "buy", shares, company.share_price);
    }

    await db.prepare("UPDATE orders SET price_per_share = ? WHERE company_id = ? AND status = 'pending' AND price_per_share != ?").run(company.share_price, companyId, company.share_price);

    const pendingSells = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' AND user_id != ? ORDER BY price_per_share ASC, created_at ASC"
    ).all(companyId, userId) as any[];

    let remaining = shares;
    let totalCost = 0;
    let lastFillPrice = company.share_price;

    for (const sellOrder of pendingSells) {
      if (remaining <= 0) break;
      const fillQty = Math.min(remaining, sellOrder.shares);
      const fillPrice = sellOrder.price_per_share;
      const cost = fillPrice * fillQty;
      const taxAmount = Math.round(cost * SELL_TAX_PERCENT);
      const sellerRevenue = cost - taxAmount;

      const sellerHolding = await db.prepare("SELECT shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(sellOrder.user_id, companyId) as { shares_owned: number } | undefined;
      if (!sellerHolding || Number(sellerHolding.shares_owned) < fillQty) {
        console.warn(`Seller ${sellOrder.user_id} lacks ${fillQty} shares of ${companyId}, skipping sell order ${sellOrder.id}`);
        continue;
      }

      const seller = await db.prepare("SELECT * FROM users WHERE id = ?").get(sellOrder.user_id) as { id: number };
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
      await addToBankFund(db, taxAmount);

      await removeShares(db, sellOrder.user_id, companyId, fillQty, "executeBuy_sell_fill", sellOrder.id);
      await transferCertificates(db, companyId, sellOrder.user_id, userId, fillQty);

      if (fillQty >= sellOrder.shares) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(sellOrder.id);
      } else {
        await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, sellOrder.id);
      }

      await db.prepare(
        "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
      ).run(userId, companyId, fillQty, fillPrice, cost);
      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
      ).run(userId, companyId, fillQty, fillPrice, new Date().toISOString());

      totalCost += cost;
      remaining -= fillQty;
      lastFillPrice = fillPrice;
    }

    const filledFromSells = shares - remaining;
    const buyImpactPrice = filledFromSells > 0 ? calculateBuyPrice(company.share_price, filledFromSells) : company.share_price;
    const afterFillPrice = await setPriceFromTrade(db, companyId, buyImpactPrice, filledFromSells > 0 ? filledFromSells : undefined);
    company.share_price = afterFillPrice;

    if (remaining > 0) {
      const bal = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
      if (bal.balance < totalCost + remaining * company.share_price) {
        throw new Error("Insufficient balance");
      }
    }

    let pendingShares = 0;
    if (remaining > 0) {
      const pendingCost = company.share_price * remaining;
      const bal = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
      if (bal.balance < totalCost + pendingCost) throw new Error("Insufficient balance");
      totalCost += pendingCost;

      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, request_id, created_at) VALUES (?, ?, 'buy', ?, ?, ?, 'pending', ?, ?)"
      ).run(userId, companyId, remaining, remaining, company.share_price, requestId || null, new Date().toISOString());
      pendingShares = remaining;
    }

    const filledShares = shares - pendingShares;
    if (filledShares > 0) {
      await addShares(db, userId, companyId, filledShares, "executeBuy_fill");
    }

    if (totalCost > 0) {
      const deductResult = await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?").run(totalCost, userId, totalCost);
      if (deductResult.changes === 0) {
        const currentBal = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
        throw new Error(`Insufficient balance. Need ${formatCoins(totalCost)}, have ${formatCoins(currentBal?.balance || 0)}`);
      }
    }

    if (filledShares > 0) {
      await awardXP(db, userId, filledShares * 1);
    }

    const updatedUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    if (pendingShares > 0) {
      return { newBalance: updatedUser.balance, newPrice: company.share_price, totalCost, filledShares, pendingShares, message: `Bought ${filledShares} shares, ${pendingShares} shares pending on market` };
    }

    return { newBalance: updatedUser.balance, newPrice: company.share_price, totalCost };
  });

  const result = buyTransaction;
  return result;
}

export async function executeSell(userId: number, companyId: number, shares: number, requestId?: string) {
  const db = getDb();

  if (!(await isTradingOpen(db))) {
    const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(companyId) as { share_price: number } | undefined;
    const sellPrice = Math.max(5, Number(company?.share_price) || 5);
    return await placeLimitOrder(userId, companyId, "sell", shares, sellPrice, requestId);
  }

  const sellTransaction = await db.transaction(async () => {
    const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; share_price: number; total_shares: number; delisted: number;
    } | undefined;

    if (!company) throw new Error("Company not found");
    company.share_price = Number(company.share_price);
    if (company.share_price < 5) throw new Error("Share price too low to trade (minimum 0.05c)");
    if (company.delisted) throw new Error("This stock is delisted and cannot be traded");

    const holding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
      | { id: number; shares_owned: number } | undefined;

    if (!holding || holding.shares_owned < shares) throw new Error("Not enough shares to sell");

    const grossRevenue = company.share_price * shares;
    const taxAmount = Math.round(grossRevenue * SELL_TAX_PERCENT);
    const totalRevenue = grossRevenue - taxAmount;
    const rawNewPrice = calculateSellPrice(company.share_price, shares, company.total_shares);
    const newPrice = applyPriceCap(company.share_price, rawNewPrice, shares, company.total_shares);

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as { balance: number };
    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(totalRevenue, userId);

    await addToBankFund(db, taxAmount);
    await updateCompanyPrice(companyId, newPrice);

    await removeShares(db, userId, companyId, shares, "executeSell");

    const cancelCertCount = await db.prepare(
      "SELECT COUNT(*) as count FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'active' LIMIT ?"
    ).get(companyId, userId, shares) as { count: number } | undefined;
    const toCancel = cancelCertCount?.count ?? 0;
    if (toCancel > 0) {
      await db.prepare(
        "UPDATE share_certificates SET status = 'cancelled' WHERE id IN (SELECT id FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'active' LIMIT ?)"
      ).run(companyId, userId, toCancel);
    }

    await db.prepare(
      "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)"
    ).run(userId, companyId, shares, company.share_price, totalRevenue);

    await recordPriceHistory(db, companyId, newPrice);

    await awardXP(db, userId, shares * 2);

    const updatedUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    return { newBalance: updatedUser.balance, newPrice, totalRevenue, taxPaid: taxAmount };
  });

  const result = sellTransaction;
  return result;
}

export async function placeLimitOrder(userId: number, companyId: number, type: "buy" | "sell", shares: number, priceCents: number, requestId?: string) {
  const db = getDb();

  return await db.transaction(async () => {
    if (requestId) {
      const existing = await db.prepare(
        "SELECT id, status FROM orders WHERE request_id = ? AND user_id = ? AND company_id = ? AND type = ?"
      ).get(requestId, userId, companyId, type) as any;
      if (existing) {
        return { orderId: existing.id, message: `Duplicate order ignored (${existing.status})`, duplicate: true };
      }
    }

    const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; share_price: number; total_shares: number; delisted: number;
    } | undefined;

    if (!company) throw new Error("Company not found");
    if (shares <= 0 || !Number.isInteger(shares)) throw new Error("Shares must be a positive whole number");
    if (priceCents < 5) throw new Error("Price must be at least 0.05c");
    if (company.delisted) throw new Error("This stock is delisted and cannot be traded");

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as {
      id: number; balance: number;
    } | undefined;

    if (!user) throw new Error("User not found");

    if (type === "buy") {
      const totalCost = priceCents * shares;
      const deductResult = await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ? AND balance >= ?").run(totalCost, userId, totalCost);
      if (deductResult.changes === 0) {
        const currentBal = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
        throw new Error(`Insufficient balance. Need ${formatCoins(totalCost)}, have ${formatCoins(currentBal?.balance || 0)}`);
      }
    }

    if (type === "sell") {
      const holding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
        | { id: number; shares_owned: number } | undefined;

      const reservedSells = await db.prepare(
        "SELECT SUM(shares) as reserved FROM orders WHERE user_id = ? AND company_id = ? AND type = 'sell' AND status = 'pending'"
      ).all(userId, companyId) as { reserved: number }[];

      const reserved = reservedSells[0]?.reserved || 0;
      const available = (holding?.shares_owned || 0) - reserved;

      if (available < shares) {
        throw new Error(`Not enough shares. Available: ${available}, requested: ${shares}`);
      }
    }

    const result = await db.prepare(
      "INSERT INTO orders (user_id, company_id, type, shares, original_shares, price_per_share, status, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)"
    ).run(userId, companyId, type, shares, shares, priceCents, requestId || null, new Date().toISOString());

    const orderId = result.lastInsertRowid as number;

    if (type === "sell") {
      await reserveCertificates(db, companyId, userId, shares, orderId);
    }

    await matchOrders(db, companyId);

    return { orderId, message: `${type} order placed for ${shares} shares at ${formatCoins(priceCents)}` };
  });
}

export async function cancelOrder(userId: number, orderId: number) {
  const db = getDb();

  return await db.transaction(async () => {
    const order = await db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'pending'").get(orderId, userId) as
      | { id: number; company_id: number; type: string; shares: number; price_per_share: number; status: string } | undefined;

    if (!order) throw new Error("Order not found or already processed");

    if (order.type === "buy") {
      const refund = order.price_per_share * order.shares;
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(refund, userId);
    } else {
      await releaseCertificates(db, orderId);
    }

    await db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);

    return { message: "Order cancelled" };
  });
}

export async function matchOrders(db: any, companyId: number) {
  if (!(await isTradingOpen(db))) return;

  try {
    const stuckOrders = await db.prepare(
      "SELECT id, shares, status FROM orders WHERE company_id = ? AND status = 'pending'"
    ).all(companyId) as { id: number; shares: number; status: string }[];
    for (const so of stuckOrders) {
      if (Number(so.shares) <= 0) {
        await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(so.id);
      }
    }
  } catch (e: any) {
    console.warn(`[matchOrders] stuck-order cleanup skipped:`, e?.message || e);
  }

  try {
    const integrity = await verifyIntegrity(db, companyId);
    if (!integrity.ok) {
      console.warn(`[matchOrders] Certificate count mismatch (continuing): ${integrity.error}`);
    }
  } catch (e: any) {
    console.warn(`[matchOrders] Integrity check unavailable (continuing):`, e?.message || e);
  }

  while (true) {
    const pendingSells = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' ORDER BY price_per_share ASC, created_at ASC"
    ).all(companyId) as any[];

    if (pendingSells.length === 0) break;

    const bestSell = pendingSells[0];

    const allPendingBuys = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'buy' AND status = 'pending' ORDER BY price_per_share DESC, created_at ASC"
    ).all(companyId) as any[];

    const matchingBuy = allPendingBuys.find(
      (b: any) => Number(b.price_per_share) >= Number(bestSell.price_per_share) && b.user_id !== bestSell.user_id
    );

    if (!matchingBuy) break;

    await fillOrderPair(db, matchingBuy, bestSell);
  }
}

async function fillOrderPair(db: any, buyOrder: any, sellOrder: any) {
  const fillQty = Math.min(Number(buyOrder.shares), Number(sellOrder.shares));
  const fillPrice = Number(sellOrder.price_per_share);

  const cost = fillPrice * fillQty;
  const taxAmount = Math.round(cost * SELL_TAX_PERCENT);
  const sellerRevenue = cost - taxAmount;

  const sellerHolding = await db.prepare("SELECT shares_owned FROM holdings WHERE user_id = ? AND company_id = ?").get(sellOrder.user_id, buyOrder.company_id) as { shares_owned: number } | undefined;
  if (!sellerHolding || Number(sellerHolding.shares_owned) < fillQty) {
    console.warn(`fillOrderPair: seller ${sellOrder.user_id} lacks ${fillQty} shares of ${buyOrder.company_id}, skipping`);
    return;
  }

  await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
  await addToBankFund(db, taxAmount);

  await removeShares(db, sellOrder.user_id, buyOrder.company_id, fillQty, "fillOrderPair_sell", sellOrder.id);
  await addShares(db, buyOrder.user_id, buyOrder.company_id, fillQty, "fillOrderPair_buy", buyOrder.id);

  const certIds = await db.prepare(
    "SELECT id FROM share_certificates WHERE company_id = ? AND status = 'pending_order' AND order_id = ? LIMIT ?"
  ).all(buyOrder.company_id, sellOrder.id, fillQty) as { id: number }[];
  if (certIds.length > 0) {
    const ph = certIds.map(() => "?").join(",");
    await db.prepare(
      `UPDATE share_certificates SET owner_id = ?, status = 'active', order_id = NULL WHERE id IN (${ph})`
    ).run(buyOrder.user_id, ...certIds.map((c) => c.id));
  }

  const reserved = buyOrder.price_per_share * fillQty;
  if (cost < reserved) {
    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(reserved - cost, buyOrder.user_id);
  }

  await db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'trade', ?, ?, ?)"
  ).run(buyOrder.user_id, buyOrder.company_id, fillQty, fillPrice, cost);

  await db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)"
  ).run(sellOrder.user_id, buyOrder.company_id, fillQty, fillPrice, sellerRevenue);

  if (fillQty >= buyOrder.shares) {
    await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(buyOrder.id);
  } else {
    await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, buyOrder.id);
  }

  if (fillQty >= sellOrder.shares) {
    await db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(sellOrder.id);
  } else {
    await db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, sellOrder.id);
  }

  const newPrice = await setPriceFromTrade(db, buyOrder.company_id, fillPrice, fillQty);

  await awardXP(db, buyOrder.user_id, fillQty * 1);
  await awardXP(db, sellOrder.user_id, fillQty * 2);
}

export async function getBankBalance(): Promise<number> {
  const db = getDb();
  return await getBankFund(db);
}

export async function resetMarket() {
  const db = getDb();

  const resetTransaction = await db.transaction(async () => {
    const companies = await db.prepare("SELECT * FROM companies").all() as any[];

    await db.prepare("DELETE FROM share_certificates").run();
    await db.prepare("DELETE FROM holdings").run();
    await db.prepare("DELETE FROM price_history").run();
    await db.prepare("UPDATE orders SET status = 'cancelled' WHERE status = 'pending'").run();

    for (const company of companies) {
      await db.prepare("UPDATE companies SET share_price = 0, total_shares = 0 WHERE id = ?").run(company.id);
      await insertPriceHistory(company.id, 0, Date.now());
    }

    return { message: "Market reset successfully" };
  });

  return resetTransaction;
}
