interface WhereCondition {
  column: string;
  op: "=" | "!=" | "<" | ">";
  value: any;
  isParam: boolean;
}

function parseWhere(whereStr: string, params: any[]): { conditions: WhereCondition[]; isOr: boolean; remainingParams: any[] } {
  const trimmed = whereStr.trim();
  if (!trimmed) return { conditions: [], isOr: false, remainingParams: [] };

  const upper = trimmed.toUpperCase();
  if (upper.includes(" OR ")) {
    const parts = trimmed.split(/\s+OR\s+/i);
    const conditions: WhereCondition[] = [];
    let paramIdx = 0;
    for (const part of parts) {
      const cond = parseSingleCondition(part.trim(), params, paramIdx);
      conditions.push(cond.condition);
      paramIdx = cond.nextIdx;
    }
    return { conditions, isOr: true, remainingParams: params.slice(paramIdx) };
  }

  const parts = trimmed.split(/\s+AND\s+/i);
  const conditions: WhereCondition[] = [];
  let paramIdx = 0;
  for (const part of parts) {
    const cond = parseSingleCondition(part.trim(), params, paramIdx);
    conditions.push(cond.condition);
    paramIdx = cond.nextIdx;
  }
  return { conditions, isOr: false, remainingParams: params.slice(paramIdx) };
}

function parseSingleCondition(s: string, params: any[], paramIdx: number): { condition: WhereCondition; nextIdx: number } {
  s = s.trim();
  if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();

  const neqMatch = s.match(/(\w+)\s*!=\s*(?:'([^']*)'|(\d+)|(\?))/i);
  if (neqMatch) {
    const column = neqMatch[1];
    if (neqMatch[4] === "?") return { condition: { column, op: "!=", value: params[paramIdx], isParam: true }, nextIdx: paramIdx + 1 };
    return { condition: { column, op: "!=", value: neqMatch[2] ?? Number(neqMatch[3]), isParam: false }, nextIdx: paramIdx };
  }

  const ltMatch = s.match(/(\w+)\s*<\s*(\d+)/i);
  if (ltMatch) {
    return { condition: { column: ltMatch[1], op: "<", value: Number(ltMatch[2]), isParam: false }, nextIdx: paramIdx };
  }

  const eqMatch = s.match(/(\w+)\s*=\s*(?:'([^']*)'|(\d+)|(\?))/i);
  if (eqMatch) {
    const column = eqMatch[1];
    if (eqMatch[4] === "?") return { condition: { column, op: "=", value: params[paramIdx], isParam: true }, nextIdx: paramIdx + 1 };
    return { condition: { column, op: "=", value: eqMatch[2] !== undefined ? eqMatch[2] : Number(eqMatch[3]), isParam: false }, nextIdx: paramIdx };
  }

  return { condition: { column: s, op: "=", value: null, isParam: false }, nextIdx: paramIdx };
}

function buildFilterParams(conditions: WhereCondition[], isOr: boolean): { filterStr: string; validConditions: WhereCondition[] } {
  const validConditions = conditions.filter((c) => c.value !== null && c.value !== undefined);
  if (validConditions.length === 0) return { filterStr: "", validConditions: [] };

  if (isOr) {
    const parts = validConditions.map((c) => {
      const val = typeof c.value === "string" ? c.value : String(c.value);
      if (c.op === "=") return `${c.column}.eq.${val}`;
      if (c.op === "!=") return `${c.column}.neq.${val}`;
      if (c.op === "<") return `${c.column}.lt.${val}`;
      if (c.op === ">") return `${c.column}.gt.${val}`;
      return `${c.column}.eq.${val}`;
    });
    return { filterStr: `or=(${parts.join(",")})`, validConditions };
  }

  const parts = validConditions.map((c) => {
    const val = typeof c.value === "string" ? encodeURIComponent(c.value) : String(c.value);
    if (c.op === "=") return `${c.column}=eq.${val}`;
    if (c.op === "!=") return `${c.column}=neq.${val}`;
    if (c.op === "<") return `${c.column}=lt.${val}`;
    if (c.op === ">") return `${c.column}=gt.${val}`;
    return `${c.column}=eq.${val}`;
  });
  return { filterStr: parts.join("&"), validConditions };
}

function restHeaders(): Record<string, string> {
  return {
    apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
  };
}

function restUrl(): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
}

const TEXT_FIELDS = new Set(["ticker", "name", "description", "type", "status", "email", "username", "password", "paypal_order_id", "code", "expires_at"]);

function coerceValue(v: any, fieldName?: string): any {
  if (fieldName && TEXT_FIELDS.has(fieldName)) return v;
  if (typeof v === "string" && v !== "" && !isNaN(Number(v))) return Number(v);
  return v;
}

function coerceRow(row: Record<string, any>): Record<string, any> {
  if (!row) return row;
  const flat: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    flat[key] = coerceValue(value, key);
  }
  return flat;
}

async function restFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${restUrl()}${path}`;
  const headers: Record<string, string> = { ...restHeaders(), ...(options.headers as Record<string, string> || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers, cache: "no-store" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("[restFetch] FAILED", { url, status: res.status, body: text.substring(0, 300) });
    throw new Error(`REST API error ${res.status}: ${text.substring(0, 200)}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function executeSelect(sql: string, params: any[], method: "get" | "all"): Promise<any> {
  const tableMatch = sql.match(/FROM\s+(\w+)/i);
  if (!tableMatch) return method === "get" ? undefined : [];
  const table = tableMatch[1];

  const isCount = /COUNT\(\*\)/i.test(sql);
  const sumMatch = sql.match(/SUM\((\w+)\)\s+as\s+(\w+)/i);

  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/is);
  const orderMatch = sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i);
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);

  const isRandomOrder = orderMatch && /RANDOM\(\)/i.test(orderMatch[1]);
  let whereParams = params;
  if (whereMatch) {
    const whereClause = whereMatch[1];
    const qCount = (whereClause.match(/\?/g) || []).length;
    whereParams = params.slice(0, qCount);
  }

  let selectCols = "*";
  if (!isCount && !sumMatch) {
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    const colsStr = selectMatch ? selectMatch[1].trim() : "*";
    if (colsStr !== "*") {
      selectCols = colsStr
        .split(",")
        .map((c) => {
          const m = c.trim().match(/(?:\w+\.)?(\w+)(?:\s+as\s+(\w+))?/i);
          if (!m) return c.trim();
          return m[2] ? `${m[1]}:${m[2]}` : m[1];
        })
        .join(",");
    }
  } else if (sumMatch) {
    selectCols = sumMatch[1];
  }

  const queryParts: string[] = [`select=${selectCols}`];

  if (whereMatch) {
    const { conditions, isOr } = parseWhere(whereMatch[1], whereParams);
    const { filterStr } = buildFilterParams(conditions, isOr);
    if (filterStr) queryParts.push(filterStr);
  }

  if (orderMatch && !isRandomOrder) {
    const entries = orderMatch[1].split(",").map((e) => e.trim());
    for (const entry of entries) {
      const desc = entry.toUpperCase().includes("DESC");
      let col = entry.replace(/\s+(ASC|DESC)$/i, "").trim().replace(/^\w+\./, "");
      if (col.toUpperCase() === "RANDOM()") continue;
      queryParts.push(`order=${col}.${desc ? "desc" : "asc"}`);
    }
  }

  if (limitMatch && !isCount) {
    queryParts.push(`limit=${limitMatch[1]}`);
  }

  if (isCount) {
    try {
      const data = await restFetch(`/${table}?${queryParts.join("&")}`, {
        headers: { Prefer: "count=exact", Range: "0-0" },
      });
      return [{ count: Array.isArray(data) ? data.length : 0 }];
    } catch {
      return [{ count: 0 }];
    }
  }

  try {
    let data = await restFetch(`/${table}?${queryParts.join("&")}`);
    if (!Array.isArray(data)) data = data ? [data] : [];

    if (sumMatch) {
      const alias = sumMatch[2];
      const col = sumMatch[1];
      const total = data.reduce((sum: number, r: any) => sum + (Number(r[col]) || 0), 0);
      return [{ [alias]: total }];
    }

    if (isRandomOrder) {
      data = [...data].sort(() => Math.random() - 0.5);
      if (limitMatch) data = data.slice(0, Number(limitMatch[1]));
    }

    const results = data.map((row: any) => coerceRow(row));
    return method === "get" ? results[0] : results;
  } catch (e: any) {
    console.error("[executeSelect] error:", e?.message, "table:", table);
    if (isCount) return [{ count: 0 }];
    return method === "get" ? undefined : [];
  }
}

async function executeInsert(sql: string, params: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
  const tableMatch = sql.match(/INTO\s+(\w+)/i);
  if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
  const table = tableMatch[1];

  const colsMatch = sql.match(/\(([^)]+)\)\s+VALUES/i);
  if (!colsMatch) return { changes: 0, lastInsertRowid: 0 };
  const columns = colsMatch[1].split(",").map((c: string) => c.trim());

  const valuesMatch = sql.match(/VALUES\s*\(([^)]+)\)/i);
  let values: any[] = [];
  if (valuesMatch) {
    const parts = valuesMatch[1].split(",").map((s: string) => s.trim());
    let paramIdx = 0;
    for (const part of parts) {
      if (part === "?") {
        values.push(params[paramIdx++]);
      } else if (part === "NOW()") {
        values.push(new Date().toISOString());
      } else {
        values.push(part.replace(/^['"]|['"]$/g, ""));
      }
    }
  } else {
    values = params;
  }

  const row: Record<string, any> = {};
  columns.forEach((col, i) => {
    row[col] = values[i] !== undefined ? values[i] : null;
  });

  try {
    const data = await restFetch(`/${table}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(row),
    });
    const id = Array.isArray(data) ? data[0]?.id : data?.id;
    return { changes: 1, lastInsertRowid: id ?? 0 };
  } catch (e: any) {
    console.error("[executeInsert] error:", e?.message, "table:", table, "row:", JSON.stringify(row));
    throw new Error(`Insert failed for ${table}: ${e.message}`);
  }
}

async function executeUpdate(sql: string, params: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
  const tableMatch = sql.match(/UPDATE\s+(\w+)/i);
  if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
  const table = tableMatch[1];

  const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/is);
  if (!setMatch) return { changes: 0, lastInsertRowid: 0 };
  const setClauses = setMatch[1].split(",").map((s) => s.trim());

  const whereMatch = sql.match(/WHERE\s+(.+?)$/is);
  let whereParams: any[] = [];
  if (whereMatch) {
    const whereClause = whereMatch[1];
    const qCount = (whereClause.match(/\?/g) || []).length;
    whereParams = params.slice(params.length - qCount);
  }

  const needsFetch = (clause: string) => {
    return /\w+\s*=\s*\w+\s*[-+]/.test(clause) || /MAX\(/i.test(clause);
  };

  let fetchCol: string | null = null;
  let fetchWhereCol: string | null = null;
  let fetchWhereVal: any = null;
  if (whereMatch) {
    fetchWhereCol = extractFirstWhereCol(whereMatch[1]);
    fetchWhereVal = whereParams[0];
  }

  for (const clause of setClauses) {
    if (needsFetch(clause) && fetchWhereCol) {
      const colMatch = clause.match(/(\w+)\s*=/);
      if (colMatch) fetchCol = colMatch[1];
      break;
    }
  }

  let currentRow: Record<string, any> = {};
  if (fetchCol && fetchWhereCol) {
    try {
      const data = await restFetch(`/${table}?select=${fetchCol},${fetchWhereCol}&${fetchWhereCol}=eq.${encodeURIComponent(fetchWhereVal)}`);
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      currentRow = rows[0] || {};
    } catch {
      currentRow = {};
    }
  }

  const setValues: { column: string; value: any }[] = [];
  let paramIdx = 0;

  for (const clause of setClauses) {
    const arithmeticAddParam = clause.match(/(\w+)\s*=\s*\w+\s*\+\s*\?/i);
    if (arithmeticAddParam) {
      const column = arithmeticAddParam[1];
      const increment = params[paramIdx++];
      const currentVal = Number(currentRow[column]) || 0;
      setValues.push({ column, value: currentVal + Number(increment) });
      continue;
    }

    const arithmeticSubParam = clause.match(/(\w+)\s*=\s*\w+\s*-\s*\?/i);
    if (arithmeticSubParam) {
      const column = arithmeticSubParam[1];
      const decrement = params[paramIdx++];
      const currentVal = Number(currentRow[column]) || 0;
      setValues.push({ column, value: currentVal - Number(decrement) });
      continue;
    }

    const arithmeticAddLit = clause.match(/(\w+)\s*=\s*\w+\s*\+\s*(\d+\.?\d*)/i);
    if (arithmeticAddLit) {
      const column = arithmeticAddLit[1];
      const increment = Number(arithmeticAddLit[2]);
      const currentVal = Number(currentRow[column]) || 0;
      setValues.push({ column, value: currentVal + increment });
      continue;
    }

    const arithmeticSubLit = clause.match(/(\w+)\s*=\s*\w+\s*-\s*(\d+\.?\d*)/i);
    if (arithmeticSubLit) {
      const column = arithmeticSubLit[1];
      const decrement = Number(arithmeticSubLit[2]);
      const currentVal = Number(currentRow[column]) || 0;
      setValues.push({ column, value: currentVal - decrement });
      continue;
    }

    const maxMatch = clause.match(/(\w+)\s*=\s*MAX\(\w+\s*-\s*\?\s*,\s*(\d+)\)/i);
    if (maxMatch) {
      const column = maxMatch[1];
      const decrement = params[paramIdx++];
      const minVal = Number(maxMatch[2]);
      const currentVal = Number(currentRow[column]) || 0;
      setValues.push({ column, value: Math.max(minVal, currentVal - Number(decrement)) });
      continue;
    }

    const coalesceMatch = clause.match(/(\w+)\s*=\s*COALESCE\(\?\s*,\s*(\w+)\)/i);
    if (coalesceMatch) {
      const column = coalesceMatch[1];
      const paramVal = params[paramIdx++];
      if (paramVal !== null && paramVal !== undefined) {
        setValues.push({ column, value: paramVal });
      }
      continue;
    }

    const strLitMatch = clause.match(/(\w+)\s*=\s*'([^']*)'/i);
    if (strLitMatch) {
      setValues.push({ column: strLitMatch[1], value: strLitMatch[2] });
      continue;
    }

    const numLitMatch = clause.match(/(\w+)\s*=\s*(\d+\.?\d*)/i);
    if (numLitMatch) {
      setValues.push({ column: numLitMatch[1], value: Number(numLitMatch[2]) });
      continue;
    }

    const simpleMatch = clause.match(/(\w+)\s*=\s*\?/i);
    if (simpleMatch) {
      setValues.push({ column: simpleMatch[1], value: params[paramIdx++] });
    }
  }

  const updateObj: Record<string, any> = {};
  for (const sv of setValues) {
    if (sv.value !== null && sv.value !== undefined) {
      updateObj[sv.column] = sv.value;
    }
  }

  if (Object.keys(updateObj).length === 0) {
    return { changes: 0, lastInsertRowid: 0 };
  }

  let filterStr = "";
  if (whereMatch) {
    const { conditions, isOr } = parseWhere(whereMatch[1], whereParams);
    const result = buildFilterParams(conditions, isOr);
    filterStr = result.filterStr;
  }

  try {
    const path = filterStr ? `/${table}?${filterStr}` : `/${table}`;
    const data = await restFetch(path, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(updateObj),
    });
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return { changes: rows.length, lastInsertRowid: 0 };
  } catch (e: any) {
    console.error("[executeUpdate] error:", e?.message, "table:", table, "data:", JSON.stringify(updateObj));
    throw new Error(`Update failed for ${table}: ${e.message}`);
  }
}

function extractFirstWhereCol(whereStr: string): string | null {
  const match = whereStr.match(/(\w+)\s*=/);
  return match ? match[1] : null;
}

async function executeDelete(sql: string, params: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
  const tableMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
  if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
  const table = tableMatch[1];

  const whereMatch = sql.match(/WHERE\s+(.+?)$/is);
  let filterStr = "";
  if (whereMatch) {
    const { conditions, isOr } = parseWhere(whereMatch[1], params);
    const result = buildFilterParams(conditions, isOr);
    filterStr = result.filterStr;
  }

  try {
    const path = filterStr ? `/${table}?${filterStr}` : `/${table}`;
    await restFetch(path, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    return { changes: 1, lastInsertRowid: 0 };
  } catch (e: any) {
    console.error("[executeDelete] error:", e?.message, "table:", table);
    throw new Error(`Delete failed for ${table}: ${e.message}`);
  }
}

async function executeQuery(sql: string, params: any[], method: "get" | "all" | "run"): Promise<any> {
  const upper = sql.trim().toUpperCase();

  if (upper.startsWith("SELECT")) {
    return executeSelect(sql, params, method as "get" | "all");
  }
  if (upper.startsWith("INSERT")) {
    return executeInsert(sql, params);
  }
  if (upper.startsWith("UPDATE")) {
    return executeUpdate(sql, params);
  }
  if (upper.startsWith("DELETE")) {
    return executeDelete(sql, params);
  }
  if (upper.startsWith("CREATE")) {
    return { changes: 0, lastInsertRowid: 0 };
  }

  return method === "get" ? undefined : [];
}

let initialized = false;

function getDbProxy() {
  if (!initialized) {
    initialized = true;
  }

  return {
    prepare: (sql: string) => ({
      get: (...args: any[]) => executeQuery(sql, args, "get"),
      all: (...args: any[]) => executeQuery(sql, args, "all"),
      run: (...args: any[]) => executeQuery(sql, args, "run"),
    }),
    transaction: async <T>(fn: () => T | Promise<T>): Promise<T> => fn(),
    exec: async (_sql: string) => {},
    pragma: async (_pragma: string) => {},
  };
}

export default getDbProxy;

export async function insertPriceHistory(companyId: number, price: number, timestamp: number) {
  try {
    let holderCount = 0;
    try {
      const holdings = await restFetch(`/holdings?company_id=eq.${companyId}&shares_owned=gt.0&select=user_id`, {});
      if (Array.isArray(holdings)) {
        const uniqueUsers = new Set(holdings.map((h: any) => h.user_id));
        holderCount = uniqueUsers.size;
      }
    } catch {
      console.error("[insertPriceHistory] holder_count lookup failed");
    }

    await restFetch(`/price_history`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ company_id: companyId, price, timestamp, holder_count: holderCount }),
    });
  } catch (e: any) {
    console.error("[insertPriceHistory] FAILED:", e?.message);
  }
}

export async function updateCompanyPrice(companyId: number, price: number): Promise<void> {
  if (!companyId || !Number.isFinite(price)) {
    console.error("updateCompanyPrice: invalid params", { companyId, price });
    return;
  }
  console.log(`[updateCompanyPrice] companyId=${companyId} price=${price}`);
  await restFetch(`/companies?id=eq.${companyId}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ share_price: price }),
  });
}

export async function getCompanyPrice(companyId: number): Promise<number> {
  try {
    const data = await restFetch(`/companies?id=eq.${companyId}&select=share_price`);
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    return rows[0] ? (Number(rows[0].share_price) || 0) : 0;
  } catch {
    return 0;
  }
}

export async function getLowestPendingSell(companyId: number, excludeOrderId?: number): Promise<number | null> {
  if (!companyId) return null;
  try {
    let path = `/orders?company_id=eq.${companyId}&type=eq.sell&status=eq.pending&order=price_per_share.asc&limit=1&select=price_per_share`;
    if (excludeOrderId !== undefined && excludeOrderId !== null) {
      path += `&id=neq.${excludeOrderId}`;
    }
    const data = await restFetch(path);
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (rows.length === 0) return null;
    const price = Number(rows[0].price_per_share);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function getLowestPendingSellsBulk(): Promise<Map<number, number>> {
  try {
    const data = await restFetch(`/orders?type=eq.sell&status=eq.pending&order=price_per_share.asc&select=company_id,price_per_share`);
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    const map = new Map<number, number>();
    for (const row of rows) {
      const cid = Number(row.company_id);
      const price = Number(row.price_per_share);
      if (cid > 0 && Number.isFinite(price) && price > 0 && !map.has(cid)) {
        map.set(cid, price);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}
