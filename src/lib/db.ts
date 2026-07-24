import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

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

function applyFilters(query: any, conditions: WhereCondition[], isOr: boolean): any {
  if (conditions.length === 0) return query;

  if (isOr) {
    const filterParts = conditions.map((c) => {
      const val = typeof c.value === "string" ? c.value : c.value;
      if (c.op === "=") return `${c.column}.eq.${val}`;
      if (c.op === "!=") return `${c.column}.neq.${val}`;
      if (c.op === "<") return `${c.column}.lt.${val}`;
      return `${c.column}.eq.${val}`;
    });
    return query.or(filterParts.join(","));
  }

  for (const c of conditions) {
    if (c.op === "=") query = query.eq(c.column, c.value);
    else if (c.op === "!=") query = query.neq(c.column, c.value);
    else if (c.op === "<") query = query.lt(c.column, c.value);
    else if (c.op === ">") query = query.gt(c.column, c.value);
  }
  return query;
}

function applyOrderBy(query: any, orderByStr: string): any {
  if (!orderByStr) return query;
  const entries = orderByStr.split(",").map((e) => e.trim());
  for (const entry of entries) {
    const desc = entry.toUpperCase().includes(" DESC");
    const col = entry.replace(/\s+(ASC|DESC)$/i, "").trim();
    if (col.toUpperCase() === "RANDOM()") continue;
    query = query.order(col, { ascending: !desc });
  }
  return query;
}

async function executeSelect(sql: string, params: any[], method: "get" | "all"): Promise<any> {
  const sb = getSupabase();

  const upper = sql.toUpperCase();
  const tableMatch = sql.match(/FROM\s+(\w+)/i);
  if (!tableMatch) return method === "get" ? undefined : [];
  const table = tableMatch[1];

  const isCount = /COUNT\(\*\)/i.test(sql);
  const sumMatch = sql.match(/SUM\((\w+)\)\s+as\s+(\w+)/i);
  const joinMatch = sql.match(/JOIN\s+(\w+)\s+\w+\s+ON\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/i);

  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/is);
  const orderMatch = sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|$)/i);
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);

  const isRandomOrder = orderMatch && /RANDOM\(\)/i.test(orderMatch[1]);
  let whereParams = params;
  let extraParams: any[] = [];
  if (whereMatch) {
    const whereClause = whereMatch[1];
    const qCount = (whereClause.match(/\?/g) || []).length;
    whereParams = params.slice(0, qCount);
    extraParams = params.slice(qCount);
  }

  if (joinMatch) {
    return executeJoinQuery(sb, sql, table, joinMatch, whereParams, orderMatch, limitMatch, isCount, sumMatch, method);
  }

  let query;
  if (isCount) {
    query = sb.from(table).select("*", { count: "exact", head: true });
  } else if (sumMatch) {
    query = sb.from(table).select(sumMatch[1]);
  } else {
    const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
    const colsStr = selectMatch ? selectMatch[1].trim() : "*";
    if (colsStr !== "*") {
      const cols = colsStr.split(",").map((c) => {
        const m = c.trim().match(/(?:\w+\.)?(\w+)/);
        return m ? m[1] : c.trim();
      });
      query = sb.from(table).select(cols.join(","));
    } else {
      query = sb.from(table).select("*");
    }
  }

  if (whereMatch) {
    const { conditions, isOr } = parseWhere(whereMatch[1], whereParams);
    query = applyFilters(query, conditions, isOr);
  }

  if (orderMatch && !isRandomOrder) {
    query = applyOrderBy(query, orderMatch[1]);
  }

  if (isRandomOrder) {
    const { data } = await query;
    if (!data || data.length === 0) return method === "get" ? undefined : [];
    const shuffled = [...data].sort(() => Math.random() - 0.5);
    if (limitMatch) return method === "get" ? shuffled[0] : shuffled.slice(0, Number(limitMatch[1]));
    return method === "get" ? shuffled[0] : shuffled;
  }

  if (limitMatch && !isCount) {
    query = query.limit(Number(limitMatch[1]));
  }

  const { data, error, count } = await query;

  if (isCount) {
    return [{ count: count || 0 }];
  }

  if (sumMatch) {
    const alias = sumMatch[2];
    const col = sumMatch[1];
    const total = (data || []).reduce((sum: number, r: any) => sum + (Number(r[col]) || 0), 0);
    return [{ [alias]: total }];
  }

  const results = (data || []).map((row: any) => flattenRow(row));
  return method === "get" ? results[0] : results;
}

function coerceValue(v: any): any {
  if (typeof v === "string" && v !== "" && !isNaN(Number(v))) return Number(v);
  return v;
}

function flattenRow(row: any): any {
  if (!row) return row;
  const flat: any = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") flat.id = row.id;
    else if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as any).id !== undefined && key.endsWith("s")) {
      for (const [fk, fv] of Object.entries(value as Record<string, any>)) {
        flat[fk] = coerceValue(fv);
      }
    } else {
      flat[key] = coerceValue(value);
    }
  }
  return flat;
}

async function executeJoinQuery(
  sb: SupabaseClient,
  sql: string,
  table: string,
  joinMatch: RegExpMatchArray,
  params: any[],
  orderMatch: RegExpMatchArray | null,
  limitMatch: RegExpMatchArray | null,
  isCount: boolean,
  sumMatch: RegExpMatchArray | null,
  method: "get" | "all"
): Promise<any> {
  const joinTable = joinMatch[1];
  const localCol = joinMatch[2];

  const selectMatch = sql.match(/SELECT\s+(.+?)\s+FROM/i);
  const colsStr = selectMatch ? selectMatch[1] : "*";

  const needsCompanyFields = /c\.(?:name|ticker|share_price|total_shares|description)/i.test(colsStr) || /c\.name\s+as\s+company_name/i.test(colsStr);

  let selectCols = "*";
  if (needsCompanyFields) {
    const localCols: string[] = [];
    const companyCols: string[] = [];

    const colParts = colsStr.split(",").map((c) => c.trim());
    let mainTableSelectAll = false;
    for (const col of colParts) {
      const trimmedCol = col.trim();

      if (/^\w+\.\*$/.test(trimmedCol)) {
        const tbl = trimmedCol.split(".")[0].toLowerCase();
        if (tbl === table.toLowerCase() || tbl === localCol.toLowerCase()) {
          mainTableSelectAll = true;
        }
        continue;
      }

      const aliasMatch = trimmedCol.match(/(?:\w+\.)?(\w+)(?:\s+as\s+(\w+))?/i);
      if (!aliasMatch) continue;
      const colName = aliasMatch[1];
      const alias = aliasMatch[2];

      const isCompanyRef = /^(c\.|company)/i.test(trimmedCol) || /^(c\.|company)/i.test(col);
      const isKnownCompanyCol = ["company_name", "ticker", "share_price", "total_shares", "current_price", "description"].includes(colName) || ["ticker", "name", "share_price", "total_shares", "description"].includes(alias || "");

      if (isCompanyRef || isKnownCompanyCol) {
        companyCols.push(colName);
      } else {
        localCols.push(colName === "*" ? "*" : (alias || colName));
      }
    }

    if (mainTableSelectAll || localCols.length === 0) localCols.unshift("*");
    if (companyCols.length > 0) {
      const localPart = localCols.includes("*") ? "*" : localCols.join(", ");
      selectCols = `${localPart}, ${joinTable}(${[...new Set(companyCols)].join(", ")})`;
    } else {
      selectCols = localCols.includes("*") ? "*" : localCols.join(", ");
    }
  }

  let query = sb.from(table).select(selectCols);

  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/is);
  if (whereMatch) {
    const { conditions, isOr } = parseWhere(whereMatch[1], params);
    query = applyFilters(query, conditions, isOr);
  }

  if (orderMatch) {
    const entries = orderMatch[1].split(",").map((e) => e.trim());
    for (const entry of entries) {
      const desc = entry.toUpperCase().includes(" DESC");
      let col = entry.replace(/\s+(ASC|DESC)$/i, "").trim();
      col = col.replace(/^\w+\./, "");
      if (col.toUpperCase() === "RANDOM()") continue;
      const prefix = col.startsWith(joinTable + ".") ? "" : "";
      const orderCol = prefix ? col : col;
      if (tableColumns(col) || isCompanyColumn(col)) {
        query = query.order(col, { ascending: !desc });
      }
    }
  }

  if (limitMatch) query = query.limit(Number(limitMatch[1]));

  const { data, error, count } = await query;

  if (isCount) return [{ count: count || 0 }];
  if (sumMatch) {
    const total = (data || []).reduce((s: number, r: any) => s + (Number(r[sumMatch[1]]) || 0), 0);
    return [{ [sumMatch[2]]: total }];
  }

  const results = (data || []).map((row: any) => {
    const flat: any = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === joinTable && value && typeof value === "object" && !Array.isArray(value)) {
        for (const [fk, fv] of Object.entries(value)) {
          if (fk === "name" && colsStr.includes("as company_name")) flat["company_name"] = coerceValue(fv);
          else if (fk === "share_price" && colsStr.includes("as current_price")) flat["current_price"] = coerceValue(fv);
          else flat[fk] = coerceValue(fv);
        }
      } else {
        flat[key] = coerceValue(value);
      }
    }
    return flat;
  });

  return method === "get" ? results[0] : results;
}

function tableColumns(col: string): boolean {
  return true;
}
function isCompanyColumn(col: string): boolean {
  return ["name", "ticker", "share_price", "total_shares", "description", "id"].includes(col);
}

async function executeInsert(sql: string, params: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
  const sb = getSupabase();
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

  const { data, error } = await sb.from(table).insert(row).select("id");
  if (error) {
    console.error("Insert error:", JSON.stringify(error), "table:", table, "row:", JSON.stringify(row));
    throw new Error(`Insert failed for ${table}: ${error.message || JSON.stringify(error)}`);
  }
  return { changes: 1, lastInsertRowid: data?.[0]?.id ?? 0 };
}

async function executeUpdate(sql: string, params: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
  const sb = getSupabase();
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
    const { data } = await sb.from(table).select(`${fetchCol}, ${fetchWhereCol}`).eq(fetchWhereCol, fetchWhereVal).single();
    currentRow = data || {};
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
    updateObj[sv.column] = sv.value;
  }

  let query = sb.from(table).update(updateObj);
  if (whereMatch) {
    const { conditions, isOr } = parseWhere(whereMatch[1], whereParams);
    query = applyFilters(query, conditions, isOr);
  }

  const { data, error } = await query.select("id");
  if (error) {
    console.error("Update error:", JSON.stringify(error), "table:", table);
    throw new Error(`Update failed for ${table}: ${error.message || JSON.stringify(error)}`);
  }
  return { changes: data?.length ?? 0, lastInsertRowid: 0 };
}

function extractFirstWhereCol(whereStr: string): string | null {
  const match = whereStr.match(/(\w+)\s*=/);
  return match ? match[1] : null;
}

async function executeDelete(sql: string, params: any[]): Promise<{ changes: number; lastInsertRowid: number }> {
  const sb = getSupabase();
  const tableMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
  if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
  const table = tableMatch[1];

  let query = sb.from(table).delete();

  const whereMatch = sql.match(/WHERE\s+(.+?)$/is);
  if (whereMatch) {
    const { conditions, isOr } = parseWhere(whereMatch[1], params);
    query = applyFilters(query, conditions, isOr);
  }

  const { data, error } = await query.select("id");
  if (error) console.error("Delete error:", error);
  return { changes: data?.length ?? 0, lastInsertRowid: 0 };
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

async function seedIfEmpty() {
  const sb = getSupabase();
  const { data: existing } = await sb.from("companies").select("id").limit(1);
  if (existing && existing.length > 0) return;

  const companies = [
    { name: "NovaTech Industries", ticker: "NVTK", description: "Leading tech innovator in AI and cloud computing", share_price: 15000, total_shares: 5000, initial_price: 15000, initial_shares: 5000 },
    { name: "Global Energy Corp", ticker: "GEC", description: "Renewable energy solutions worldwide", share_price: 8500, total_shares: 8000, initial_price: 8500, initial_shares: 8000 },
    { name: "MediVita Pharmaceuticals", ticker: "MDVT", description: "Biotech and pharmaceutical research", share_price: 22000, total_shares: 3000, initial_price: 22000, initial_shares: 3000 },
    { name: "SkyLine Aerospace", ticker: "SKLA", description: "Space technology and aviation", share_price: 35000, total_shares: 2000, initial_price: 35000, initial_shares: 2000 },
    { name: "FreshHarvest Foods", ticker: "FRHV", description: "Organic food production and distribution", share_price: 4500, total_shares: 12000, initial_price: 4500, initial_shares: 12000 },
    { name: "CryptoVault Digital", ticker: "CVDC", description: "Cryptocurrency exchange and blockchain services", share_price: 12000, total_shares: 6000, initial_price: 12000, initial_shares: 6000 },
    { name: "UrbanBuild Construction", ticker: "UBLD", description: "Smart city infrastructure and construction", share_price: 6800, total_shares: 7000, initial_price: 6800, initial_shares: 7000 },
    { name: "AquaPure Systems", ticker: "AQPS", description: "Water purification and environmental tech", share_price: 9200, total_shares: 5500, initial_price: 9200, initial_shares: 5500 },
    { name: "NeuralLink Gaming", ticker: "NRLG", description: "VR/AR gaming and immersive experiences", share_price: 18500, total_shares: 4000, initial_price: 18500, initial_shares: 4000 },
    { name: "Titan Steel Works", ticker: "TSTL", description: "Advanced materials and metallurgy", share_price: 5500, total_shares: 10000, initial_price: 5500, initial_shares: 10000 },
  ];

  for (const c of companies) {
    const { data } = await sb.from("companies").insert(c).select("id");
    const companyId = data?.[0]?.id;
    if (companyId) {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const priceRows = Array.from({ length: 24 }, (_, i) => ({
        company_id: companyId,
        price: Math.round(c.share_price * (1 + (Math.random() - 0.5) * 0.06)),
        timestamp: dayAgo + i * 60 * 60 * 1000,
      }));
      await sb.from("price_history").insert(priceRows);
    }
  }
}

let initialized = false;

function getDbProxy() {
  if (!initialized) {
    initialized = true;
    seedIfEmpty().catch(console.error);
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
  const sb = getSupabase();
  const { error } = await sb.from("price_history").insert({ company_id: companyId, price, timestamp });
  if (error) {
    console.error("Direct price_history insert error:", JSON.stringify(error));
    throw new Error(`price_history insert failed: ${error.message || JSON.stringify(error)}`);
  }
}
