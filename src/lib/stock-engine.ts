import getDb from "@/lib/db";
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

function recordPriceHistory(db: any, companyId: number, price: number) {
  db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(companyId, price, Date.now());
}

function getBankFund(db: any): number {
  const row = db.prepare("SELECT * FROM bank_fund WHERE id = 1").all() as { balance: number }[];
  return row[0] ? row[0].balance : 0;
}

function addToBankFund(db: any, amount: number) {
  const current = getBankFund(db);
  db.prepare("UPDATE bank_fund SET balance = ? WHERE id = 1").run(current + amount);
}

export function executeBuy(userId: number, companyId: number, shares: number) {
  const db = getDb();

  const buyTransaction = db.transaction(() => {
    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; name: string; ticker: string; share_price: number; total_shares: number;
    } | undefined;

    if (!company) throw new Error("Company not found");

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as {
      id: number; balance: number; is_admin: number;
    } | undefined;

    if (!user) throw new Error("User not found");
    const isAdmin = user.is_admin === 1;

    const pendingSells = db.prepare(
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

      const seller = db.prepare("SELECT * FROM users WHERE id = ?").get(sellOrder.user_id) as { id: number; is_admin: number };
      if (seller.is_admin !== 1) {
        db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
      }
      addToBankFund(db, taxAmount);

      const sellerHolding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(sellOrder.user_id, companyId) as
        | { id: number; shares_owned: number } | undefined;

      if (sellerHolding) {
        if (sellerHolding.shares_owned <= fillQty) {
          db.prepare("DELETE FROM holdings WHERE id = ?").run(sellerHolding.id);
        } else {
          db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(fillQty, sellerHolding.id);
        }
      }

      if (fillQty >= sellOrder.shares) {
        db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(sellOrder.id);
      } else {
        db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, sellOrder.id);
      }

      db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(fillPrice, companyId);
      db.prepare(
        "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'buy', ?, ?, ?)"
      ).run(userId, companyId, fillQty, fillPrice, cost);
      db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'filled', ?)"
      ).run(userId, companyId, fillQty, fillPrice, new Date().toISOString());

      totalCost += cost;
      remaining -= fillQty;
    }

    let pendingShares = 0;
    if (remaining > 0) {
      const pendingCost = company.share_price * remaining;
      if (!isAdmin) {
        const bal = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };
        if (bal.balance < totalCost + pendingCost) throw new Error("Insufficient balance");
      }
      totalCost += pendingCost;

      db.prepare(
        "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, 'buy', ?, ?, 'pending', ?)"
      ).run(userId, companyId, remaining, company.share_price, new Date().toISOString());
      pendingShares = remaining;
    }

    const buyerHolding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
      | { id: number; shares_owned: number } | undefined;

    const filledShares = shares - pendingShares;
    if (filledShares > 0) {
      if (buyerHolding) {
        db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(filledShares, buyerHolding.id);
      } else {
        db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(userId, companyId, filledShares);
      }
    }

    if (!isAdmin && totalCost > 0) {
      db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, userId);
    }

    const updatedUser = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    if (pendingShares > 0) {
      return { newBalance: isAdmin ? -1 : updatedUser.balance, newPrice: company.share_price, totalCost, filledShares, pendingShares, message: `Bought ${filledShares} shares, ${pendingShares} shares pending on market` };
    }

    return { newBalance: isAdmin ? -1 : updatedUser.balance, newPrice: company.share_price, totalCost };
  });

  const result = buyTransaction;
  return result;
}

export function executeSell(userId: number, companyId: number, shares: number) {
  const db = getDb();

  const sellTransaction = db.transaction(() => {
    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; share_price: number; total_shares: number;
    } | undefined;

    if (!company) throw new Error("Company not found");

    const holding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
      | { id: number; shares_owned: number } | undefined;

    if (!holding || holding.shares_owned < shares) throw new Error("Not enough shares to sell");

    const grossRevenue = company.share_price * shares;
    const taxAmount = Math.round(grossRevenue * SELL_TAX_PERCENT);
    const totalRevenue = grossRevenue - taxAmount;
    const newPrice = calculateSellPrice(company.share_price, shares);

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as { balance: number; is_admin: number };
    const isAdmin = user.is_admin === 1;

    if (!isAdmin) {
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(totalRevenue, userId);
    }

    addToBankFund(db, taxAmount);
    db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, companyId);

    if (holding.shares_owned === shares) {
      db.prepare("DELETE FROM holdings WHERE id = ?").run(holding.id);
    } else {
      db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(shares, holding.id);
    }

    db.prepare(
      "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'sell', ?, ?, ?)"
    ).run(userId, companyId, shares, company.share_price, totalRevenue);

    recordPriceHistory(db, companyId, newPrice);

    const updatedUser = db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number };

    return { newBalance: isAdmin ? -1 : updatedUser.balance, newPrice, totalRevenue, taxPaid: taxAmount };
  });

  const result = sellTransaction;
  return result;
}

export function placeLimitOrder(userId: number, companyId: number, type: "buy" | "sell", shares: number, priceCents: number) {
  const db = getDb();

  return db.transaction(() => {
    const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(companyId) as {
      id: number; share_price: number; total_shares: number;
    } | undefined;

    if (!company) throw new Error("Company not found");
    if (shares <= 0 || !Number.isInteger(shares)) throw new Error("Shares must be a positive whole number");
    if (priceCents <= 0) throw new Error("Price must be greater than 0");

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as {
      id: number; balance: number; is_admin: number;
    } | undefined;

    if (!user) throw new Error("User not found");
    const isAdmin = user.is_admin === 1;

    if (type === "buy") {
      const totalCost = priceCents * shares;
      if (!isAdmin && user.balance < totalCost) {
        throw new Error(`Insufficient balance. Need ${formatCoins(totalCost)}, have ${formatCoins(user.balance)}`);
      }

      const totalSharesAllHoldings = db.prepare("SELECT SUM(shares_owned) as total FROM holdings WHERE company_id = ?").all(companyId) as { total: number }[];
      const totalHeld = totalSharesAllHoldings[0]?.total || 0;
      if (shares > company.total_shares - totalHeld) {
        throw new Error(`Only ${company.total_shares - totalHeld} shares available to buy`);
      }

      if (!isAdmin) {
        db.prepare("UPDATE users SET balance = balance - ? WHERE id = ?").run(totalCost, userId);
      }
    }

    if (type === "sell") {
      const holding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, companyId) as
        | { id: number; shares_owned: number } | undefined;

      const reservedSells = db.prepare(
        "SELECT SUM(shares) as reserved FROM orders WHERE user_id = ? AND company_id = ? AND type = 'sell' AND status = 'pending'"
      ).all(userId, companyId) as { reserved: number }[];

      const reserved = reservedSells[0]?.reserved || 0;
      const available = (holding?.shares_owned || 0) - reserved;

      if (available < shares) {
        throw new Error(`Not enough shares. Available: ${available}, requested: ${shares}`);
      }
    }

    const result = db.prepare(
      "INSERT INTO orders (user_id, company_id, type, shares, price_per_share, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)"
    ).run(userId, companyId, type, shares, priceCents, new Date().toISOString());

    matchOrders(db, companyId);

    return { orderId: result.lastInsertRowid, message: `${type} order placed for ${shares} shares at ${formatCoins(priceCents)}` };
  });
}

export function cancelOrder(userId: number, orderId: number) {
  const db = getDb();

  return db.transaction(() => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ? AND status = 'pending'").get(orderId, userId) as
      | { id: number; company_id: number; type: string; shares: number; price_per_share: number; status: string } | undefined;

    if (!order) throw new Error("Order not found or already processed");

    if (order.type === "buy") {
      const refund = order.price_per_share * order.shares;
      db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(refund, userId);
    }

    if (order.type === "sell") {
      const holding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(userId, order.company_id) as
        | { id: number; shares_owned: number } | undefined;

      if (holding) {
        db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(order.shares, holding.id);
      } else {
        db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(userId, order.company_id, order.shares);
      }
    }

    db.prepare("UPDATE orders SET status = 'cancelled' WHERE id = ?").run(orderId);

    return { message: "Order cancelled" };
  });
}

export function matchOrders(db: any, companyId: number) {
  while (true) {
    const pendingSells = db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'sell' AND status = 'pending' ORDER BY price_per_share ASC, created_at ASC"
    ).all(companyId) as any[];

    if (pendingSells.length === 0) break;

    const bestSell = pendingSells[0];

    const allPendingBuys = db.prepare(
      "SELECT * FROM orders WHERE company_id = ? AND type = 'buy' AND status = 'pending' ORDER BY price_per_share DESC, created_at ASC"
    ).all(companyId) as any[];

    const matchingBuy = allPendingBuys.find(
      (b: any) => b.price_per_share >= bestSell.price_per_share && b.user_id !== bestSell.user_id
    );

    if (!matchingBuy) break;

    fillOrderPair(db, matchingBuy, bestSell);
  }
}

function fillOrderPair(db: any, buyOrder: any, sellOrder: any) {
  const fillQty = Math.min(buyOrder.shares, sellOrder.shares);
  const fillPrice = sellOrder.price_per_share;

  const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(buyOrder.company_id) as {
    id: number; share_price: number; total_shares: number;
  };

  const cost = fillPrice * fillQty;
  const taxAmount = Math.round(cost * SELL_TAX_PERCENT);
  const sellerRevenue = cost - taxAmount;

  const seller = db.prepare("SELECT * FROM users WHERE id = ?").get(sellOrder.user_id) as { id: number; is_admin: number };
  if (seller.is_admin !== 1) {
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(sellerRevenue, sellOrder.user_id);
  }
  addToBankFund(db, taxAmount);

  const sellerHolding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(sellOrder.user_id, buyOrder.company_id) as
    | { id: number; shares_owned: number } | undefined;

  if (sellerHolding) {
    if (sellerHolding.shares_owned <= fillQty) {
      db.prepare("DELETE FROM holdings WHERE id = ?").run(sellerHolding.id);
    } else {
      db.prepare("UPDATE holdings SET shares_owned = shares_owned - ? WHERE id = ?").run(fillQty, sellerHolding.id);
    }
  }

  const buyerHolding = db.prepare("SELECT * FROM holdings WHERE user_id = ? AND company_id = ?").get(buyOrder.user_id, buyOrder.company_id) as
    | { id: number; shares_owned: number } | undefined;

  if (buyerHolding) {
    db.prepare("UPDATE holdings SET shares_owned = shares_owned + ? WHERE id = ?").run(fillQty, buyerHolding.id);
  } else {
    db.prepare("INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)").run(buyOrder.user_id, buyOrder.company_id, fillQty);
  }

  const reserved = buyOrder.price_per_share * fillQty;
  if (cost < reserved) {
    db.prepare("UPDATE users SET balance = balance + ? WHERE id = ?").run(reserved - cost, buyOrder.user_id);
  }

  db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount) VALUES (?, ?, 'trade', ?, ?, ?)"
  ).run(buyOrder.user_id, buyOrder.company_id, fillQty, fillPrice, cost);

  if (fillQty >= buyOrder.shares) {
    db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(buyOrder.id);
  } else {
    db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, buyOrder.id);
  }

  if (fillQty >= sellOrder.shares) {
    db.prepare("UPDATE orders SET status = 'filled' WHERE id = ?").run(sellOrder.id);
  } else {
    db.prepare("UPDATE orders SET shares = shares - ? WHERE id = ?").run(fillQty, sellOrder.id);
  }

  const newPrice = calculateBuyPrice(company.share_price, fillQty);
  db.prepare("UPDATE companies SET share_price = ? WHERE id = ?").run(newPrice, buyOrder.company_id);
  recordPriceHistory(db, buyOrder.company_id, newPrice);
}

export function getBankBalance(): number {
  const db = getDb();
  return getBankFund(db);
}

export function resetMarket() {
  const db = getDb();

  const resetTransaction = db.transaction(() => {
    const companies = db.prepare("SELECT * FROM companies").all() as any[];

    db.prepare("DELETE FROM holdings").run();
    db.prepare("DELETE FROM price_history").run();
    db.prepare("UPDATE orders SET status = 'cancelled' WHERE status = 'pending'").run();

    for (const company of companies) {
      const initialPrice = company.initial_price || company.share_price;
      const initialShares = company.initial_shares || company.total_shares;
      db.prepare("UPDATE companies SET share_price = ?, total_shares = ? WHERE id = ?").run(initialPrice, initialShares, company.id);
      db.prepare("INSERT INTO price_history (company_id, price, timestamp) VALUES (?, ?, ?)").run(company.id, initialPrice, Date.now());
    }

    return { message: "Market reset successfully" };
  });

  return resetTransaction;
}
