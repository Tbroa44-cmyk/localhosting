import getDb from "@/lib/db";
import { formatCoins } from "@/lib/format";

const MIN_BALANCE_TO_OPERATE = 50;
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;
const ROTATION_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_COMPANIES = 3;

export async function getOrCreateBankAccount(db: any, userId: number) {
  let account = await db.prepare(
    "SELECT * FROM user_bank_accounts WHERE user_id = ?"
  ).get(userId) as any;

  if (!account) {
    await db.prepare(
      "INSERT INTO user_bank_accounts (user_id, balance, last_balance_update, last_company_pick) VALUES (?, 0, ?, ?)"
    ).run(userId, new Date().toISOString(), new Date().toISOString());
    account = await db.prepare(
      "SELECT * FROM user_bank_accounts WHERE user_id = ?"
    ).get(userId);
  }

  return account;
}

export async function deposit(userId: number, amountCents: number) {
  const db = getDb();

  if (amountCents < 50) throw new Error("Minimum deposit is 0.50c");

  const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number } | undefined;
  if (!user) throw new Error("User not found");
  const currentBalance = Number(user.balance);
  if (currentBalance < amountCents) {
    throw new Error(`Insufficient wallet balance. You have ${formatCoins(currentBalance)} but need ${formatCoins(amountCents)}`);
  }

  const account = await getOrCreateBankAccount(db, userId);
  const newWalletBalance = currentBalance - amountCents;
  const newBankBalance = Number(account.balance) + amountCents;

  const walletResult = await db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newWalletBalance, userId);

  if (!walletResult || walletResult.changes === 0) {
    throw new Error("Failed to deduct from wallet - please try again");
  }

  await db.prepare("UPDATE user_bank_accounts SET balance = ? WHERE id = ?").run(newBankBalance, account.id);

  await db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount, created_at) VALUES (?, 0, 'bank_deposit', 0, 0, ?, ?)"
  ).run(userId, amountCents, new Date().toISOString());

  return {
    walletBalance: newWalletBalance,
    bankBalance: newBankBalance,
    message: `Deposited ${formatCoins(amountCents)} into your bank`,
  };
}

export async function withdraw(userId: number, amountCents: number) {
  const db = getDb();

  if (amountCents <= 0) throw new Error("Invalid amount");

  const account = await getOrCreateBankAccount(db, userId);
  const currentBankBalance = Number(account.balance);
  if (currentBankBalance < amountCents) {
    throw new Error(`Insufficient bank balance. You have ${formatCoins(currentBankBalance)} but want to withdraw ${formatCoins(amountCents)}`);
  }

  const user = await db.prepare("SELECT balance FROM users WHERE id = ?").get(userId) as { balance: number } | undefined;
  const currentWalletBalance = Number(user?.balance || 0);
  const newBankBalance = currentBankBalance - amountCents;
  const newWalletBalance = currentWalletBalance + amountCents;

  await db.prepare("UPDATE user_bank_accounts SET balance = ? WHERE id = ?").run(newBankBalance, account.id);
  await db.prepare("UPDATE users SET balance = ? WHERE id = ?").run(newWalletBalance, userId);

  await db.prepare(
    "INSERT INTO transactions (user_id, company_id, type, shares, price_per_share, total_amount, created_at) VALUES (?, 0, 'bank_withdraw', 0, 0, ?, ?)"
  ).run(userId, amountCents, new Date().toISOString());

  return {
    walletBalance: newWalletBalance,
    bankBalance: newBankBalance,
    message: `Withdrew ${formatCoins(amountCents)} from your bank`,
  };
}

export async function getBankStatus(userId: number) {
  const db = getDb();
  const account = await getOrCreateBankAccount(db, userId);
  const investments = await db.prepare(
    "SELECT bi.*, c.name, c.ticker, c.share_price FROM user_bank_investments bi JOIN companies c ON bi.company_id = c.id WHERE bi.user_id = ?"
  ).all(userId) as any[];

  const now = Date.now();
  const lastUpdate = new Date(account.last_balance_update).getTime();
  const lastPick = new Date(account.last_company_pick).getTime();
  const needsUpdate = now - lastUpdate >= UPDATE_INTERVAL_MS;
  const needsRotation = now - lastPick >= ROTATION_INTERVAL_MS;

  let totalInvestmentValue = 0;
  const enrichedInvestments = investments.map((inv: any) => {
    const currentPrice = Number(inv.share_price);
    const entryPrice = Number(inv.entry_price);
    const weight = Number(inv.weight);
    const bankShare = Math.round(Number(account.balance) * weight);
    const profit = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * bankShare : 0;
    const currentValue = bankShare + profit;
    totalInvestmentValue += currentValue;
    return {
      ...inv,
      current_price: currentPrice,
      entry_price: entryPrice,
      weight,
      bank_share: bankShare,
      profit: Math.round(profit),
      current_value: Math.round(currentValue),
      profit_pct: entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice * 100).toFixed(2) : "0.00",
    };
  });

  return {
    balance: Number(account.balance),
    totalInvestmentValue: Math.round(totalInvestmentValue),
    totalValue: Number(account.balance) + Math.round(totalInvestmentValue),
    investments: enrichedInvestments,
    lastBalanceUpdate: account.last_balance_update,
    lastCompanyPick: account.last_company_pick,
    needsUpdate,
    needsRotation,
    canOperate: Number(account.balance) >= MIN_BALANCE_TO_OPERATE,
  };
}

export async function scoreCompanies(db: any): Promise<{ companyId: number; score: number }[]> {
  const companies = await db.prepare(
    "SELECT id, share_price, total_shares FROM companies WHERE total_shares > 0"
  ).all() as any[];

  if (companies.length === 0) return [];

  const historyResults = await Promise.all(
    companies.map(c =>
      db.prepare("SELECT price FROM price_history WHERE company_id = ? ORDER BY timestamp DESC LIMIT 48").all(c.id) as any[]
    )
  );

  const txResults = await Promise.all(
    companies.map(c =>
      db.prepare("SELECT type FROM transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT 100").all(c.id) as any[]
    )
  );

  const scored: { companyId: number; score: number }[] = [];

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const priceHistory = historyResults[i];
    const transactions = txResults[i];

    let score = 0;
    const currentPrice = Number(company.share_price);

    if (priceHistory.length >= 2) {
      const recentPrice = Number(priceHistory[0].price);
      const olderPrice = Number(priceHistory[priceHistory.length - 1].price);
      if (olderPrice > 0) {
        const momentum = (recentPrice - olderPrice) / olderPrice;
        score += momentum * 40;
      }

      if (priceHistory.length >= 6) {
        const prices = priceHistory.slice(0, 6).map((p) => Number(p.price));
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        const variance = prices.reduce((a, p) => a + Math.pow(p - avg, 2), 0) / prices.length;
        const stability = 1 - Math.min(1, Math.sqrt(variance) / (avg || 1));
        score += stability * 20;
      }
    }

    const recentBuys = transactions.filter((t) => String(t.type).includes("buy")).length;
    const recentSells = transactions.filter((t) => String(t.type).includes("sell")).length;
    const netDemand = recentBuys - recentSells;
    score += Math.sign(netDemand) * Math.min(20, Math.abs(netDemand) * 2);

    if (currentPrice >= 200) score += 5;
    if (currentPrice >= 500) score += 10;

    scored.push({ companyId: company.id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_COMPANIES + 2);
}

export async function pickCompaniesForUser(db: any, userId: number) {
  const account = await getOrCreateBankAccount(db, userId);

  if (Number(account.balance) < MIN_BALANCE_TO_OPERATE) {
    return { message: "Bank balance too low to invest (minimum 50c)" };
  }

  const existing = await db.prepare(
    "SELECT * FROM user_bank_investments WHERE user_id = ?"
  ).all(userId) as any[];

  if (existing.length > 0) {
    await db.prepare("DELETE FROM user_bank_investments WHERE user_id = ?").run(userId);
  }

  const scored = await scoreCompanies(db);
  const picks = scored.slice(0, MAX_COMPANIES);

  if (picks.length === 0) {
    await db.prepare("UPDATE user_bank_accounts SET last_company_pick = ? WHERE user_id = ?").run(
      new Date().toISOString(), userId
    );
    return { message: "No companies available to invest in", investments: [] };
  }

  const companyPrices = await Promise.all(
    picks.map(p => db.prepare("SELECT share_price FROM companies WHERE id = ?").get(p.companyId) as { share_price: number })
  );

  const totalScore = picks.reduce((sum, p) => sum + Math.max(0.01, p.score + 10), 0);

  const investments = [];
  for (let i = 0; i < picks.length; i++) {
    const pick = picks[i];
    const weight = Math.max(0.01, pick.score + 10) / totalScore;

    await db.prepare(
      "INSERT INTO user_bank_investments (user_id, company_id, weight, entry_price) VALUES (?, ?, ?, ?)"
    ).run(userId, pick.companyId, weight, companyPrices[i].share_price);

    investments.push({
      companyId: pick.companyId,
      weight,
      entryPrice: companyPrices[i].share_price,
      score: pick.score,
    });
  }

  await db.prepare("UPDATE user_bank_accounts SET last_company_pick = ?, last_balance_update = ? WHERE user_id = ?").run(
    new Date().toISOString(), new Date().toISOString(), userId
  );

  return { message: `Invested in ${picks.length} companies`, investments };
}

export async function updateBankBalance(db: any, userId: number) {
  const account = await getOrCreateBankAccount(db, userId);

  if (Number(account.balance) < MIN_BALANCE_TO_OPERATE) return;

  const investments = await db.prepare(
    "SELECT * FROM user_bank_investments WHERE user_id = ?"
  ).all(userId) as any[];

  if (investments.length === 0) return;

  let totalProfit = 0;
  for (const inv of investments) {
    const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(inv.company_id) as { share_price: number } | undefined;
    if (!company) continue;

    const currentPrice = Number(company.share_price);
    const entryPrice = Number(inv.entry_price);
    if (entryPrice <= 0) continue;

    const weight = Number(inv.weight);
    const bankShare = Math.round(Number(account.balance) * weight);
    const profitPct = (currentPrice - entryPrice) / entryPrice;
    const profit = Math.round(bankShare * profitPct);
    totalProfit += profit;
  }

  if (totalProfit !== 0) {
    const newBalance = Math.max(0, Number(account.balance) + totalProfit);
    await db.prepare("UPDATE user_bank_accounts SET balance = ?, last_balance_update = ? WHERE id = ?").run(
      newBalance, new Date().toISOString(), account.id
    );
    for (const inv of investments) {
      const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(inv.company_id) as { share_price: number } | undefined;
      if (company) {
        await db.prepare("UPDATE user_bank_investments SET entry_price = ? WHERE id = ?").run(
          company.share_price, inv.id
        );
      }
    }
  } else {
    await db.prepare("UPDATE user_bank_accounts SET last_balance_update = ? WHERE id = ?").run(
      new Date().toISOString(), account.id
    );
  }
}

export async function rotateCompanies(db: any, userId: number) {
  const account = await getOrCreateBankAccount(db, userId);

  if (Number(account.balance) < MIN_BALANCE_TO_OPERATE) return;

  const investments = await db.prepare(
    "SELECT * FROM user_bank_investments WHERE user_id = ?"
  ).all(userId) as any[];

  if (investments.length === 0) {
    await pickCompaniesForUser(db, userId);
    return;
  }

  const losingCompanies: number[] = [];
  for (const inv of investments) {
    const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(inv.company_id) as { share_price: number } | undefined;
    if (!company) {
      losingCompanies.push(inv.company_id);
      continue;
    }
    const currentPrice = Number(company.share_price);
    const entryPrice = Number(inv.entry_price);
    if (entryPrice > 0 && currentPrice < entryPrice * 0.95) {
      losingCompanies.push(inv.company_id);
    }
  }

  if (losingCompanies.length === 0) {
    await db.prepare("UPDATE user_bank_accounts SET last_company_pick = ? WHERE user_id = ?").run(
      new Date().toISOString(), userId
    );
    return;
  }

  if (losingCompanies.length === investments.length) {
    await db.prepare("DELETE FROM user_bank_investments WHERE user_id = ?").run(userId);
    await pickCompaniesForUser(db, userId);
    return;
  }

  for (const companyId of losingCompanies) {
    await db.prepare("DELETE FROM user_bank_investments WHERE user_id = ? AND company_id = ?").run(userId, companyId);
  }

  const remaining = await db.prepare(
    "SELECT * FROM user_bank_investments WHERE user_id = ?"
  ).all(userId) as any[];

  const remainingIds = remaining.map((r: any) => r.company_id);
  const scored = await scoreCompanies(db);
  const candidates = scored.filter((s) => !remainingIds.includes(s.companyId));
  const newPicks = candidates.slice(0, losingCompanies.length);

  const remainingScore = remaining.reduce((sum: number, r: any) => sum + Math.max(0.01, Number(r.weight) * 100), 0);
  const newScore = newPicks.reduce((sum, p) => sum + Math.max(0.01, p.score + 10), 0);
  const combinedScore = remainingScore + newScore;

  for (const r of remaining) {
    const newWeight = (Math.max(0.01, Number(r.weight) * 100) / combinedScore);
    await db.prepare("UPDATE user_bank_investments SET weight = ? WHERE id = ?").run(newWeight, r.id);
  }

  for (const pick of newPicks) {
    const company = await db.prepare("SELECT share_price FROM companies WHERE id = ?").get(pick.companyId) as { share_price: number };
    const newWeight = Math.max(0.01, pick.score + 10) / combinedScore;
    await db.prepare(
      "INSERT INTO user_bank_investments (user_id, company_id, weight, entry_price) VALUES (?, ?, ?, ?)"
    ).run(userId, pick.companyId, newWeight, company.share_price);
  }

  await db.prepare("UPDATE user_bank_accounts SET last_company_pick = ?, last_balance_update = ? WHERE user_id = ?").run(
    new Date().toISOString(), new Date().toISOString(), userId
  );
}

export async function refreshUserBank(db: any, userId: number) {
  const account = await getOrCreateBankAccount(db, userId);
  const now = Date.now();
  const lastUpdate = new Date(account.last_balance_update).getTime();
  const lastPick = new Date(account.last_company_pick).getTime();

  if (now - lastPick >= ROTATION_INTERVAL_MS) {
    await rotateCompanies(db, userId);
  } else if (now - lastUpdate >= UPDATE_INTERVAL_MS) {
    await updateBankBalance(db, userId);
  }
}
