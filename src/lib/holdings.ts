import getDb from "./db";

export interface HoldingRow {
  id: number;
  user_id: number;
  company_id: number;
  shares_owned: number;
}

export interface AuditEntry {
  id: number;
  user_id: number;
  company_id: number;
  action: "add" | "remove" | "delete" | "consolidate" | "admin_set" | "create";
  delta: number;
  shares_before: number;
  shares_after: number;
  source: string;
  order_id: number | null;
  created_at: string;
}

export interface VerificationIssue {
  type: "duplicate" | "negative" | "orphan" | "mismatch" | "zero_row";
  user_id: number;
  company_id: number;
  detail: string;
  holding_ids: number[];
}

export interface VerificationResult {
  totalHoldings: number;
  issues: VerificationIssue[];
  fixed: number;
  timestamp: string;
}

async function logAudit(
  db: any,
  entry: {
    user_id: number;
    company_id: number;
    action: "add" | "remove" | "delete" | "consolidate" | "admin_set" | "create";
    delta: number;
    shares_before: number;
    shares_after: number;
    source: string;
    order_id?: number;
  }
): Promise<void> {
  try {
    await db.prepare(
      "INSERT INTO holdings_audit (user_id, company_id, action, delta, shares_before, shares_after, source, order_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      entry.user_id,
      entry.company_id,
      entry.action,
      entry.delta,
      entry.shares_before,
      entry.shares_after,
      entry.source,
      entry.order_id ?? null,
      new Date().toISOString()
    );
  } catch (e: any) {
    console.error("Audit log failed:", e?.message || e);
  }
}

export async function getHolding(
  db: any,
  userId: number,
  companyId: number
): Promise<HoldingRow | undefined> {
  const rows = await db.prepare(
    "SELECT id, user_id, company_id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ?"
  ).all(userId, companyId) as HoldingRow[];

  if (rows.length === 0) return undefined;

  if (rows.length > 1) {
    let totalShares = 0;
    let keepId = rows[0].id;
    for (const r of rows) {
      totalShares += Number(r.shares_owned);
      if (r.id !== keepId) {
        await db.prepare("DELETE FROM holdings WHERE id = ?").run(r.id);
      }
    }
    await db.prepare("UPDATE holdings SET shares_owned = ? WHERE id = ?").run(totalShares, keepId);
    await logAudit(db, {
      user_id: userId,
      company_id: companyId,
      action: "consolidate",
      delta: 0,
      shares_before: rows.reduce((s, r) => s + Number(r.shares_owned), 0),
      shares_after: totalShares,
      source: "getHolding_dedup",
    });
    return { id: keepId, user_id: userId, company_id: companyId, shares_owned: totalShares };
  }

  return rows[0];
}

export async function addShares(
  db: any,
  userId: number,
  companyId: number,
  shares: number,
  source: string,
  orderId?: number
): Promise<number> {
  if (shares <= 0) throw new Error("addShares: shares must be positive");

  const existing = await getHolding(db, userId, companyId);
  const before = existing?.shares_owned ?? 0;
  const after = before + shares;

  if (existing) {
    await db.prepare("UPDATE holdings SET shares_owned = ? WHERE id = ?").run(after, existing.id);
  } else {
    await db.prepare(
      "INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)"
    ).run(userId, companyId, after);
  }

  await logAudit(db, {
    user_id: userId,
    company_id: companyId,
    action: "add",
    delta: shares,
    shares_before: before,
    shares_after: after,
    source,
    order_id: orderId,
  });

  return after;
}

export async function removeShares(
  db: any,
  userId: number,
  companyId: number,
  shares: number,
  source: string,
  orderId?: number
): Promise<number> {
  if (shares <= 0) throw new Error("removeShares: shares must be positive");

  const existing = await getHolding(db, userId, companyId);
  if (!existing) {
    throw new Error(`No holding found for user ${userId} company ${companyId} - cannot remove ${shares} shares (source: ${source})`);
  }

  const before = existing.shares_owned;
  if (before < shares) {
    throw new Error(`Insufficient shares: have ${before}, need ${shares} (user ${userId}, company ${companyId}, source: ${source})`);
  }

  if (before === shares) {
    await db.prepare("DELETE FROM holdings WHERE id = ?").run(existing.id);
    await logAudit(db, {
      user_id: userId,
      company_id: companyId,
      action: "delete",
      delta: -shares,
      shares_before: before,
      shares_after: 0,
      source,
      order_id: orderId,
    });
    return 0;
  }

  const after = before - shares;
  await db.prepare("UPDATE holdings SET shares_owned = ? WHERE id = ?").run(after, existing.id);

  await logAudit(db, {
    user_id: userId,
    company_id: companyId,
    action: "remove",
    delta: -shares,
    shares_before: before,
    shares_after: after,
    source,
    order_id: orderId,
  });

  return after;
}

export async function setShares(
  db: any,
  userId: number,
  companyId: number,
  shares: number,
  source: string,
  orderId?: number
): Promise<number> {
  const existing = await getHolding(db, userId, companyId);
  const before = existing?.shares_owned ?? 0;

  if (shares <= 0) {
    if (existing) {
      await db.prepare("DELETE FROM holdings WHERE id = ?").run(existing.id);
    }
    await logAudit(db, {
      user_id: userId,
      company_id: companyId,
      action: "delete",
      delta: -before,
      shares_before: before,
      shares_after: 0,
      source,
      order_id: orderId,
    });
    return 0;
  }

  if (existing) {
    await db.prepare("UPDATE holdings SET shares_owned = ? WHERE id = ?").run(shares, existing.id);
  } else {
    await db.prepare(
      "INSERT INTO holdings (user_id, company_id, shares_owned) VALUES (?, ?, ?)"
    ).run(userId, companyId, shares);
  }

  await logAudit(db, {
    user_id: userId,
    company_id: companyId,
    action: "admin_set",
    delta: shares - before,
    shares_before: before,
    shares_after: shares,
    source,
    order_id: orderId,
  });

  return shares;
}

export async function consolidateDuplicates(
  db: any,
  targetUserId?: number
): Promise<{ pairsFixed: number; rowsRemoved: number }> {
  let pairsFixed = 0;
  let rowsRemoved = 0;

  const whereClause = targetUserId
    ? "WHERE user_id = ? GROUP BY user_id, company_id HAVING COUNT(*) > 1"
    : "GROUP BY user_id, company_id HAVING COUNT(*) > 1";

  const query = targetUserId
    ? `SELECT user_id, company_id FROM holdings ${whereClause}`
    : `SELECT user_id, company_id FROM holdings ${whereClause}`;

  const duplicates = targetUserId
    ? await db.prepare(query).all(targetUserId) as { user_id: number; company_id: number }[]
    : await db.prepare(query).all() as { user_id: number; company_id: number }[];

  for (const dup of duplicates) {
    const rows = await db.prepare(
      "SELECT id, shares_owned FROM holdings WHERE user_id = ? AND company_id = ? ORDER BY id ASC"
    ).all(dup.user_id, dup.company_id) as { id: number; shares_owned: number }[];

    const totalShares = rows.reduce((s, r) => s + Number(r.shares_owned), 0);
    const keepId = rows[0].id;
    const deleteIds = rows.slice(1).map((r) => r.id);

    if (deleteIds.length > 0) {
      const placeholders = deleteIds.map(() => "?").join(",");
      await db.prepare(`DELETE FROM holdings WHERE id IN (${placeholders})`).run(...deleteIds);
      await db.prepare("UPDATE holdings SET shares_owned = ? WHERE id = ?").run(totalShares, keepId);

      await logAudit(db, {
        user_id: dup.user_id,
        company_id: dup.company_id,
        action: "consolidate",
        delta: 0,
        shares_before: rows.reduce((s, r) => s + Number(r.shares_owned), 0),
        shares_after: totalShares,
        source: "consolidateDuplicates",
      });

      pairsFixed++;
      rowsRemoved += deleteIds.length;
    }
  }

  return { pairsFixed, rowsRemoved };
}

export async function verifyHoldings(
  db: any,
  targetUserId?: number
): Promise<VerificationResult> {
  const issues: VerificationIssue[] = [];
  let fixed = 0;

  const { pairsFixed, rowsRemoved } = await consolidateDuplicates(db, targetUserId);
  fixed += rowsRemoved;

  const holdings = targetUserId
    ? (await db.prepare("SELECT id, user_id, company_id, shares_owned FROM holdings WHERE user_id = ?").all(targetUserId) as HoldingRow[])
    : (await db.prepare("SELECT id, user_id, company_id, shares_owned FROM holdings").all() as HoldingRow[]);

  for (const h of holdings) {
    if (Number(h.shares_owned) < 0) {
      issues.push({
        type: "negative",
        user_id: h.user_id,
        company_id: h.company_id,
        detail: `Negative shares: ${h.shares_owned}`,
        holding_ids: [h.id],
      });
    }

    if (Number(h.shares_owned) === 0) {
      issues.push({
        type: "zero_row",
        user_id: h.user_id,
        company_id: h.company_id,
        detail: `Zero-share holding row (id: ${h.id})`,
        holding_ids: [h.id],
      });
      await db.prepare("DELETE FROM holdings WHERE id = ?").run(h.id);
      fixed++;
    }
  }

  const buySum = await db.prepare(
    `SELECT user_id, company_id, SUM(shares) as total
     FROM transactions
     WHERE type = 'buy' ${targetUserId ? "AND user_id = ?" : ""}
     GROUP BY user_id, company_id`
  ).all(...(targetUserId ? [targetUserId] : [])) as { user_id: number; company_id: number; total: number }[];

  const sellSum = await db.prepare(
    `SELECT user_id, company_id, SUM(shares) as total
     FROM transactions
     WHERE type = 'sell' ${targetUserId ? "AND user_id = ?" : ""}
     GROUP BY user_id, company_id`
  ).all(...(targetUserId ? [targetUserId] : [])) as { user_id: number; company_id: number; total: number }[];

  const tradeBuySum = await db.prepare(
    `SELECT user_id, company_id, SUM(shares) as total
     FROM transactions
     WHERE type = 'trade' ${targetUserId ? "AND user_id = ?" : ""}
     GROUP BY user_id, company_id`
  ).all(...(targetUserId ? [targetUserId] : [])) as { user_id: number; company_id: number; total: number }[];

  const pendingSellShares = await db.prepare(
    `SELECT user_id, company_id, SUM(shares) as total
     FROM orders
     WHERE type = 'sell' AND status = 'pending' ${targetUserId ? "AND user_id = ?" : ""}
     GROUP BY user_id, company_id`
  ).all(...(targetUserId ? [targetUserId] : [])) as { user_id: number; company_id: number; total: number }[];

  const expectedMap: Record<string, number> = {};
  const pendingSellMap: Record<string, number> = {};

  for (const r of buySum) {
    const key = `${r.user_id}_${r.company_id}`;
    expectedMap[key] = (expectedMap[key] || 0) + Number(r.total);
  }
  for (const r of tradeBuySum) {
    const key = `${r.user_id}_${r.company_id}`;
    expectedMap[key] = (expectedMap[key] || 0) + Number(r.total);
  }
  for (const r of sellSum) {
    const key = `${r.user_id}_${r.company_id}`;
    expectedMap[key] = (expectedMap[key] || 0) - Number(r.total);
  }
  for (const r of pendingSellShares) {
    const key = `${r.user_id}_${r.company_id}`;
    pendingSellMap[key] = Number(r.total);
  }

  const holdingMap: Record<string, HoldingRow[]> = {};
  for (const h of holdings) {
    const key = `${h.user_id}_${h.company_id}`;
    if (!holdingMap[key]) holdingMap[key] = [];
    holdingMap[key].push(h);
  }

  const allKeys = new Set([...Object.keys(expectedMap), ...Object.keys(holdingMap)]);

  for (const key of allKeys) {
    const expected = expectedMap[key] ?? 0;
    const pendingSell = pendingSellMap[key] ?? 0;
    const rows = holdingMap[key] || [];
    const actual = rows.reduce((s, r) => s + Number(r.shares_owned), 0);
    const expectedWithPending = expected - pendingSell;

    if (actual !== expectedWithPending) {
      const [userId, companyId] = key.split("_").map(Number);
      issues.push({
        type: "mismatch",
        user_id: userId,
        company_id: companyId,
        detail: `Actual: ${actual}, Expected: ${expectedWithPending} (buys+trades: ${expected}, pending sells: ${pendingSell})`,
        holding_ids: rows.map((r) => r.id),
      });
    }
  }

  const zeroRows = holdings.filter((h) => Number(h.shares_owned) === 0);
  for (const z of zeroRows) {
    await db.prepare("DELETE FROM holdings WHERE id = ?").run(z.id);
    fixed++;
  }

  return {
    totalHoldings: holdings.length - fixed,
    issues,
    fixed,
    timestamp: new Date().toISOString(),
  };
}

export async function deleteCompanyHoldings(
  db: any,
  companyId: number
): Promise<void> {
  const holdings = await db.prepare(
    "SELECT id, user_id, shares_owned FROM holdings WHERE company_id = ?"
  ).all(companyId) as { id: number; user_id: number; shares_owned: number }[];

  for (const h of holdings) {
    await logAudit(db, {
      user_id: h.user_id,
      company_id: companyId,
      action: "delete",
      delta: -Number(h.shares_owned),
      shares_before: Number(h.shares_owned),
      shares_after: 0,
      source: "deleteCompanyHoldings",
    });
  }

  await db.prepare("DELETE FROM holdings WHERE company_id = ?").run(companyId);
}
