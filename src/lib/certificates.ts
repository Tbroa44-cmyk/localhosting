import getDb from "./db";

const BATCH_SIZE = 500;

export async function issueCertificates(
  db: any,
  companyId: number,
  count: number,
  ownerId: number
): Promise<void> {
  for (let i = 0; i < count; i += BATCH_SIZE) {
    const batch = Math.min(BATCH_SIZE, count - i);
    const values: string[] = [];
    const params: any[] = [];
    for (let j = 0; j < batch; j++) {
      values.push(`(?, ?, 'active', NULL, datetime('now'))`);
      params.push(companyId, ownerId);
    }
    await db.prepare(
      `INSERT INTO share_certificates (company_id, owner_id, status, order_id, created_at) VALUES ${values.join(", ")}`
    ).run(...params);
  }
}

export async function transferCertificates(
  db: any,
  companyId: number,
  fromUserId: number,
  toUserId: number,
  count: number
): Promise<void> {
  let certs = await db.prepare(
    "SELECT id FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'active' LIMIT ?"
  ).all(companyId, fromUserId, count) as { id: number }[];

  if (certs.length < count) {
    const needed = count - certs.length;
    await issueCertificates(db, companyId, needed, fromUserId);
    certs = await db.prepare(
      "SELECT id FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'active' LIMIT ?"
    ).all(companyId, fromUserId, count) as { id: number }[];
  }

  const ids = certs.map((c) => c.id);
  const ph = ids.map(() => "?").join(",");
  await db.prepare(
    `UPDATE share_certificates SET owner_id = ?, status = 'active', order_id = NULL WHERE id IN (${ph})`
  ).run(toUserId, ...ids);
}

export async function reserveCertificates(
  db: any,
  companyId: number,
  userId: number,
  count: number,
  orderId: number
): Promise<void> {
  let certs = await db.prepare(
    "SELECT id FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'active' LIMIT ?"
  ).all(companyId, userId, count) as { id: number }[];

  if (certs.length < count) {
    const needed = count - certs.length;
    await issueCertificates(db, companyId, needed, userId);
    certs = await db.prepare(
      "SELECT id FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'active' LIMIT ?"
    ).all(companyId, userId, count) as { id: number }[];
  }

  const ids = certs.map((c) => c.id);
  const ph = ids.map(() => "?").join(",");
  await db.prepare(
    `UPDATE share_certificates SET status = 'pending_order', order_id = ? WHERE id IN (${ph})`
  ).run(orderId, ...ids);
}

export async function releaseCertificates(db: any, orderId: number): Promise<void> {
  await db.prepare(
    "UPDATE share_certificates SET status = 'active', order_id = NULL WHERE status = 'pending_order' AND order_id = ?"
  ).run(orderId);
}

export async function cancelCertificates(db: any, companyId: number): Promise<void> {
  await db.prepare(
    "UPDATE share_certificates SET status = 'cancelled' WHERE company_id = ?"
  ).run(companyId);
}

export async function deleteCompanyCertificates(db: any, companyId: number): Promise<void> {
  await db.prepare("DELETE FROM share_certificates WHERE company_id = ?").run(companyId);
}

export async function countActive(
  db: any,
  companyId: number,
  userId: number
): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) as count FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'active'"
  ).get(companyId, userId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export async function countPending(
  db: any,
  companyId: number,
  userId: number
): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) as count FROM share_certificates WHERE company_id = ? AND owner_id = ? AND status = 'pending_order'"
  ).get(companyId, userId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export async function countActiveForCompany(
  db: any,
  companyId: number
): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) as count FROM share_certificates WHERE company_id = ? AND status = 'active'"
  ).get(companyId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export async function countTotalForCompany(
  db: any,
  companyId: number
): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(*) as count FROM share_certificates WHERE company_id = ? AND status IN ('active', 'pending_order')"
  ).get(companyId) as { count: number } | undefined;
  return row?.count ?? 0;
}

export async function verifyIntegrity(
  db: any,
  companyId: number
): Promise<{ ok: boolean; total: number; expected: number; error?: string }> {
  const total = await countTotalForCompany(db, companyId);
  const company = await db.prepare(
    "SELECT total_shares FROM companies WHERE id = ?"
  ).get(companyId) as { total_shares: number } | undefined;
  const expected = company ? Number(company.total_shares) : 0;
  const ok = total === expected;
  return {
    ok,
    total,
    expected,
    error: ok ? undefined : `Certificate count ${total} != total_shares ${expected} for company ${companyId}`,
  };
}

export async function preTransferCheck(
  db: any,
  companyId: number,
  sellerId: number,
  count: number
): Promise<void> {
  const available = await countActive(db, companyId, sellerId);
  if (available < count) {
    throw new Error(
      `Certificate check: seller ${sellerId} has ${available} certificates for company ${companyId}, needs ${count}`
    );
  }
}

export async function transferFromPending(
  db: any,
  companyId: number,
  fromUserId: number,
  toUserId: number,
  orderId: number
): Promise<void> {
  await db.prepare(
    "UPDATE share_certificates SET owner_id = ?, status = 'active', order_id = NULL WHERE company_id = ? AND status = 'pending_order' AND order_id = ?"
  ).run(toUserId, companyId, orderId);
}
