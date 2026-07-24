import getDb, { insertPriceHistory } from "@/lib/db";
import { formatCoins } from "@/lib/format";

const PRICE_CHANGE_PERCENT = 0.02;
const SELL_TAX_PERCENT = 0.03;

export function calculateBuyPrice(currentPrice: number, shares: number): number {
  const priceIncrease = currentPrice * PRICE_CHANGE_PERCENT * shares;
  return Math.round(currentPrice + priceIncrease);
}

export function calculateSellPrice(currentPrice: number, shares: number): number {
  const priceDecrease = currentPrice * PRICE_CHANGE_PERCENT * shares;
  return Math.max(100, Math.round(currentPrice - priceDecrease));
}

async function recordPriceHistory(db: any, companyId: number, price: number) {
  try {
    await insertPriceHistory(companyId, price, Date.now());
  } catch (e: any) {
    console.error("Failed to record price history:", e?.message || e);
  }
}

async function getBankFund(db: any): Promise<number> {
  const row = await db.prepare("SELECT * FROM bank_fund WHERE id = 1").all() as { balance: number }[];
  return row[0] ? row[0].balance : 0;
}

async function addToBankFund(db: any, amount: number) {
  const current = await getBankFund(db);
  await db.prepare("UPDATE bank_fund SET balance = ? WHERE id = 1").run(current + amount);
}

export async function executeBuy(userId: number, companyId: number, shares: number) {
  const db = getDb();

  const buyTransaction = await db.transaction(async () => {
    const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; name: string; ticker: string; share_price: number; total_shares: number;
    } | undefined;

    if (!company) throw new Error("Company not found");
    company.share_price = Number(company.share_price);
    company.total_shares = Number(company.total_shares);
    if (company.share_price < 5) throw new Error("Share price too low to trade (minimum 0.05c)");

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as {
      id: number; balance: number; is_admin: any;
    } | undefined;

    if (!user) throw new Error("User not found");
    const isAdmin = !!user.is_admin;

    const pendingSells = await db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' AND user_id != ? ORDER BY price_per_share ASC, created_at ASC"
    ).all(companyId, userId) as any[];

    let remaining = shares;
    let totalCost = 0;

    for (const sellOrder of pendingSells) {
      if (remaining <= 0) break;
      const fillQty = Math.min(remaining, sellOrder.shares);
      const fillPrice = sellOrder.price_per_share;
      const cost = fillPrice * fillQty;
      const taxAmount = Math.round(cost * SELL_TAX_PERCENT);
      const sellerRevenue = cost - taxAmount;

      const seller = await db.prepare("SELECT * FROM users WHERE id = ?").get(sellOrder.user_id) as { id: number; is_admin: any };
      if (!seller.is_admin) {
        await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
      }
      await addToBankFund(db, taxAmount);

      const sellerHolding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(sellOrder.user_id, companyId) as
        | { id: number; shares_owned: number } | undefined;

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

      await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(fillPrice, companyId);
      await recordPriceHistory(db, companyId, fillPrice);
      await db.prepare(
        "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
      ).run(userId, companyId, fillQty, fillPrice, cost);
      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
      ).run(userId, companyId, fillQty, fillPrice, new Date().toISOString());

      totalCost += cost;
      remaining -= fillQty;
    }

    if (remaining > 0) {
      const totalSharesAllHoldings = await db.prepare("SELECT SUM(shares_owned) as total FROM holdings WHERE company_id = ?").all(companyId) as { total: number }[];
      const totalHeld = totalSharesAllHoldings[0]?.total || 0;
      const availableShares = Math.max(0, company.total_shares - totalHeld);

      let autoFillQty = 0;
      if (availableShares > 0) {
        autoFillQty = Math.min(remaining, availableShares);
        if (!isAdmin) {
          const bal = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
          const canAfford = Math.floor((bal.balance - totalCost) / company.share_price);
          if (canAfford <= 0) autoFillQty = 0;
          else autoFillQty = Math.min(autoFillQty, canAfford);
        }
      }

      if (autoFillQty > 0) {
        const autoFillCost = company.share_price * autoFillQty;
        totalCost += autoFillCost;
        remaining -= autoFillQty;

        await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(company.share_price, companyId);
        await db.prepare(
          "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
        ).run(userId, companyId, autoFillQty, company.share_price, autoFillCost);
        await db.prepare(
          "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
        ).run(userId, companyId, autoFillQty, company.share_price, new Date().toISOString());
        await recordPriceHistory(db, companyId, company.share_price);
      }
    }

    let pendingShares = 0;
    if (remaining > 0) {
      const pendingCost = company.share_price * remaining;
      if (!isAdmin) {
        const bal = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
        if (bal.balance < totalCost + pendingCost) throw new Error("Insufficient balance");
      }
      totalCost += pendingCost;

      await db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'pending', ?)"
      ).run(userId, companyId, remaining, company.share_price, new Date().toISOString());
      pendingShares = remaining;
    }

    const buyerHolding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
      | { id: number; shares_owned: number } | undefined;

    const filledShares = shares - pendingShares;
    if (filledShares > 0) {
      if (buyerHolding) {
        await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(filledShares, buyerHolding.id);
      } else {
        await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(userId, companyId, filledShares);
      }
    }

    if (!isAdmin && totalCost > 0) {
      await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, userId);
    }

    const updatedUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    if (pendingShares > 0) {
      return { newBalance: isAdmin ? -1 : updatedUser.balance, newPrice: company.share_price, totalCost, filledShares, pendingShares, message: `Bought ${filledShares} shares, ${pendingShares} shares pending on market` };
    }

    return { newBalance: isAdmin ? -1 : updatedUser.balance, newPrice: company.share_price, totalCost };
  });

  const result = buyTransaction;
  return result;
}

export async function executeSell(userId: number, companyId: number, shares: number) {
  const db = getDb();

  const sellTransaction = await db.transaction(async () => {
    const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; share_price: number; total_shares: number;
    } | undefined;

    if (!company) throw new Error("Company not found");
    company.share_price = Number(company.share_price);
    if (company.share_price < 5) throw new Error("Share price too low to trade (minimum 0.05c)");

    const holding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
      | { id: number; shares_owned: number } | undefined;

    if (!holding || holding.shares_owned < shares) throw new Error("Not enough shares to sell");

    const grossRevenue = company.share_price * shares;
    const taxAmount = Math.round(grossRevenue * SELL_TAX_PERCENT);
    const totalRevenue = grossRevenue - taxAmount;
    const newPrice = calculateSellPrice(company.share_price, shares);

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as { balance: number; is_admin: any };
    const isAdmin = !!user.is_admin;

    if (!isAdmin) {
      await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(totalRevenue, userId);
    }

    await addToBankFund(db, taxAmount);
    await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, companyId);

    if (holding.shares_owned === shares) {
      await db.prepare("DELETE FROM holdings WHERE id = ?").run(holding.id);
    } else {
      await db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(shares, holding.id);
    }

    await db.prepare(
      "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)"
    ).run(userId, companyId, shares, company.share_price, totalRevenue);

    await recordPriceHistory(db, companyId, newPrice);

    const updatedUser = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    return { newBalance: isAdmin ? -1 : updatedUser.balance, newPrice, totalRevenue, taxPaid: taxAmount };
  });

  const result = sellTransaction;
  return result;
}

export async function placeLimitOrder(userId: number, companyId: number, type: "buy" | "sell", shares: number, priceCents: number) {
  const db = getDb();

  return await db.transaction(async () => {
    const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; share_price: number; total_shares: number;
    } | undefined;

    if (!company) throw new Error("Company not found");
    if (shares <= 0 || !Number.isInteger(shares)) throw new Error("Shares must be a positive whole number");
    if (priceCents < 5) throw new Error("Price must be at least 0.05c");

    const user = await db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as {
      id: number; balance: number; is_admin: any;
    } | undefined;

    if (!user) throw new Error("User not found");
    const isAdmin = !!user.is_admin;

    if (type === "buy") {
      const totalCost = priceCents * shares;
      if (!isAdmin && user.balance < totalCost) {
        throw new Error(`Insufficient balance. Need ${formatCoins(totalCost)}, have ${formatCoins(user.balance)}`);
      }

      const totalSharesAllHoldings = await db.prepare("SELECT SUM(shares_owned) as total FROM holdings WHERE company_id = ?").all(companyId) as { total: number }[];
      const totalHeld = totalSharesAllHoldings[0]?.total || 0;
      if (shares > company.total_shares - totalHeld) {
        throw new Error(`Only ${company.total_shares - totalHeld} shares available to buy`);
      }

      if (!isAdmin) {
        await db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, userId);
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
      "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
    ).run(userId, companyId, type, shares, priceCents, new Date().toISOString());

    await matchOrders(db, companyId);

    return { orderId: result.lastInsertRowid, message: `${type} order placed for ${shares} shares at ${formatCoins(priceCents)}` };
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
    }

    if (order.type === "sell") {
      const holding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, order.company_id) as
        | { id: number; shares_owned: number } | undefined;

      if (holding) {
        await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(order.shares, holding.id);
      } else {
        await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(userId, order.company_id, order.shares);
      }
    }

    await db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);

    return { message: "Order cancelled" };
  });
}

export async function matchOrders(db: any, companyId: number) {
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

  const company = await db.prepare("SELECT * FROM companies WHERE id = ?").get(buyOrder.company_id) as {
    id: number; share_price: number; total_shares: number;
  };

  const cost = fillPrice * fillQty;
  const taxAmount = Math.round(cost * SELL_TAX_PERCENT);
  const sellerRevenue = cost - taxAmount;

  const seller = await db.prepare("SELECT * FROM users WHERE id = ?").get(sellOrder.user_id) as { id: number; is_admin: any };
  if (!seller.is_admin) {
    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
  }
  await addToBankFund(db, taxAmount);

  const sellerHolding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(sellOrder.user_id, buyOrder.company_id) as
    | { id: number; shares_owned: number } | undefined;

  if (sellerHolding) {
    if (sellerHolding.shares_owned <= fillQty) {
      await db.prepare("DELETE FROM holdings WHERE id = ?").run(sellerHolding.id);
    } else {
      await db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(fillQty, sellerHolding.id);
    }
  }

  const buyerHolding = await db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(buyOrder.user_id, buyOrder.company_id) as
    | { id: number; shares_owned: number } | undefined;

  if (buyerHolding) {
    await db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(fillQty, buyerHolding.id);
  } else {
    await db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(buyOrder.user_id, buyOrder.company_id, fillQty);
  }

  const reserved = buyOrder.price_per_share * fillQty;
  if (cost < reserved) {
    await db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(reserved - cost, buyOrder.user_id);
  }

  await db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'trade', ?, ?, ?)"
  ).run(buyOrder.user_id, buyOrder.company_id, fillQty, fillPrice, cost);

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

  const newPrice = calculateBuyPrice(Number(company.share_price), fillQty);
  await db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, buyOrder.company_id);
  await recordPriceHistory(db, buyOrder.company_id, newPrice);
}

export async function getBankBalance(): Promise<number> {
  const db = getDb();
  return await getBankFund(db);
}

export async function resetMarket() {
  const db = getDb();

  const resetTransaction = await db.transaction(async () => {
    const companies = await db.prepare("SELECT * FROM companies").all() as any[];

    await db.prepare("DELETE FROM holdings").run();
    await db.prepare("DELETE FROM price_history").run();
    await db.prepare("UPDATE orders SET status = 'cancelled' WHERE status = 'pending'").run();

    for (const company of companies) {
      const initialPrice = company.initial_price || company.share_price;
      const initialShares = company.initial_shares || company.total_shares;
      await db.prepare("UPDATE companies SET share_price = ?, total_shares = ? WHERE id = ?").run(initialPrice, initialShares, company.id);
      await insertPriceHistory(company.id, initialPrice, Date.now());
    }

    return { message: "Market reset successfully" };
  });

  return resetTransaction;
}
