import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "stockmarket.json");

interface Row {
  [key: string]: any;
  id?: number;
}

interface TableData {
  rows: Row[];
  autoIncrement: number;
}

interface Database {
  users: TableData;
  companies: TableData;
  holdings: TableData;
  transactions: TableData;
  currency_purchases: TableData;
  price_history: TableData;
  bank_fund: TableData;
  settings: TableData;
  orders: TableData;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDb(): Database {
  ensureDataDir();
  if (fs.existsSync(DB_FILE)) {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  }
  const empty: Database = {
    users: { rows: [], autoIncrement: 1 },
    companies: { rows: [], autoIncrement: 1 },
    holdings: { rows: [], autoIncrement: 1 },
    transactions: { rows: [], autoIncrement: 1 },
    currency_purchases: { rows: [], autoIncrement: 1 },
    price_history: { rows: [], autoIncrement: 1 },
    bank_fund: { rows: [], autoIncrement: 1 },
    settings: { rows: [], autoIncrement: 1 },
    orders: { rows: [], autoIncrement: 1 },
  };
  saveDb(empty);
  return empty;
}

function saveDb(db: Database) {
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

let dbInstance: Database | null = null;
let dbPath = "";

function getDb() {
  if (!dbInstance) {
    dbInstance = loadDb();
    initializeDatabase(dbInstance);
    saveDb(dbInstance);
  }
  return dbInstance;
}

function flushDb() {
  if (dbInstance) {
    saveDb(dbInstance);
  }
}

class Statement {
  private sql: string;
  private params: any[];
  private db: Database;

  constructor(db: Database, sql: string, params: any[] = []) {
    this.db = db;
    this.sql = sql.trim();
    this.params = params;
  }

  get(...args: any[]): Row | undefined {
    const params = args.length > 0 ? args : this.params;
    const table = this.getTable();
    if (!table) return undefined;

    const parsed = this.parseSql(params);
    const rows = this.filterRows(table.rows, parsed.where, parsed.whereParams);

    if (parsed.orderBy) {
      rows.sort((a, b) => {
        const aVal = a[parsed.orderBy!.replace(" DESC", "").replace(" ASC", "")];
        const bVal = b[parsed.orderBy!.replace(" DESC", "").replace(" ASC", "")];
        if (parsed.orderBy!.includes(" DESC")) return bVal > aVal ? 1 : -1;
        return aVal > bVal ? 1 : -1;
      });
    }

    if (parsed.limit) {
      return rows.slice(0, parsed.limit)[0];
    }

    return rows[0];
  }

  all(...args: any[]): Row[] {
    const params = args.length > 0 ? args : this.params;
    const table = this.getTable();
    if (!table) return [];

    const parsed = this.parseSql(params);
    let rows = this.filterRows(table.rows, parsed.where, parsed.whereParams);

    if (parsed.orderBy) {
      const field = parsed.orderBy.replace(" DESC", "").replace(" ASC", "");
      rows = [...rows].sort((a, b) => {
        const aVal = a[field];
        const bVal = b[field];
        if (parsed.orderBy!.includes(" DESC")) return aVal > bVal ? -1 : 1;
        return aVal > bVal ? 1 : -1;
      });
    }

    if (parsed.limit) {
      rows = rows.slice(0, parsed.limit);
    }

    if (parsed.select === "COUNT(*) as count") {
      return [{ count: rows.length }] as any;
    }

    if (parsed.select?.includes("SUM(")) {
      const fieldMatch = parsed.select.match(/SUM\((\w+)\)\s*(?:,\s*\d+\))?\s+as\s+(\w+)/i);
      if (fieldMatch) {
        const field = fieldMatch[1];
        const alias = fieldMatch[2];
        const total = rows.reduce((sum: number, r: any) => sum + (r[field] || 0), 0);
        return [{ [alias]: total }] as any;
      }
    }

    return rows;
  }

  run(...args: any[]): { changes: number; lastInsertRowid: number } {
    const params = args.length > 0 ? args : this.params;
    const parsed = this.parseSql(params);

    if (parsed.type === "INSERT") {
      return this.runInsert(parsed);
    }
    if (parsed.type === "UPDATE") {
      return this.runUpdate(parsed);
    }
    if (parsed.type === "DELETE") {
      return this.runDelete(parsed);
    }
    if (parsed.type === "CREATE") {
      return { changes: 0, lastInsertRowid: 0 };
    }

    return { changes: 0, lastInsertRowid: 0 };
  }

  private getTable(): TableData | undefined {
    const match = this.sql.match(/FROM\s+(\w+)/i) || this.sql.match(/INTO\s+(\w+)/i) || this.sql.match(/UPDATE\s+(\w+)/i) || this.sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (!match) return undefined;
    const tableName = match[1] as keyof Database;
    return (this.db as any)[tableName];
  }

  private parseSql(params: any[]) {
    const upper = this.sql.toUpperCase();
    let type = "SELECT";
    if (upper.startsWith("INSERT")) type = "INSERT";
    else if (upper.startsWith("UPDATE")) type = "UPDATE";
    else if (upper.startsWith("DELETE")) type = "DELETE";
    else if (upper.startsWith("CREATE")) type = "CREATE";

    const whereMatch = this.sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/is);
    let where = "";
    let whereParams: any[] = [];

    if (whereMatch) {
      where = whereMatch[1].trim();
      const whereCount = (where.match(/\?/g) || []).length;
      if (type === "UPDATE" || type === "DELETE") {
        whereParams = params.slice(params.length - whereCount);
      } else {
        whereParams = params.slice(0, whereCount);
      }
    }

    const orderMatch = this.sql.match(/ORDER\s+BY\s+(.+?)(?:LIMIT|$)/i);
    const orderBy = orderMatch ? orderMatch[1].trim() : null;

    const limitMatch = this.sql.match(/LIMIT\s+(\d+)/i);
    const limit = limitMatch ? parseInt(limitMatch[1]) : null;

    const selectMatch = this.sql.match(/SELECT\s+(.+?)\s+FROM/i);
    const select = selectMatch ? selectMatch[1].trim() : null;

    return { type, where, whereParams, orderBy, limit, select, params };
  }

  private filterRows(rows: Row[], where: string, whereParams: any[]): Row[] {
    if (!where) return rows;

    return rows.filter((row) => {
      return this.evaluateWhere(row, where, whereParams);
    });
  }

  private evaluateWhere(row: Row, where: string, params: any[]): boolean {
    let paramIndex = 0;

    function evaluate(segment: string): boolean {
      const orParts = segment.split(/\s+OR\s+/i);
      if (orParts.length > 1) {
        return orParts.some((p) => evaluate(p.trim()));
      }

      const andParts = segment.split(/\s+AND\s+/i);
      if (andParts.length > 1) {
        return andParts.every((p) => evaluate(p.trim()));
      }

      let s = segment.trim();

      const isNegated = s.toUpperCase().startsWith("NOT ");
      if (isNegated) s = s.slice(4).trim();

      const isNotEqual = s.includes("!=");
      if (isNotEqual) {
        const neqMatch = s.match(/(\w+)\s*!=\s*(\?|'[^']*'|[\d.]+)/i);
        if (neqMatch) {
          const field = neqMatch[1];
          let val = neqMatch[2];
          if (val === "?") {
            val = params[paramIndex++];
          } else {
            val = val.replace(/['"]/g, "");
          }
          return String(row[field]) !== String(val);
        }
      }

      let result = false;

      if (s.toUpperCase().startsWith("(") && s.toUpperCase().endsWith(")")) {
        result = evaluate(s.slice(1, -1).trim());
      } else if (s.toUpperCase().includes(" IN ")) {
        const inMatch = s.match(/(\w+)\s+IN\s+\((.+)\)/i);
        if (inMatch) {
          const field = inMatch[1];
          const values = inMatch[2].split(",").map((v) => {
            v = v.trim();
            if (v === "?") {
              return params[paramIndex++];
            }
            return v.replace(/['"]/g, "");
          });
          result = values.includes(String(row[field]));
        }
      } else if (s.includes(" LIKE ")) {
        const likeMatch = s.match(/(\w+)\s+LIKE\s+\?/i);
        if (likeMatch) {
          const field = likeMatch[1];
          const pattern = params[paramIndex++];
          const regex = new RegExp("^" + pattern.replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
          result = regex.test(String(row[field] || ""));
        }
      } else {
        const eqMatch = s.match(/(\w+)\s*=\s*(?:MAX\((\w+)\s*-\s*\?\s*,\s*(\d+)\)|COALESCE\(\?\s*,\s*(\w+)\)|\?)/i);
        if (eqMatch) {
          const field = eqMatch[1];
          const val = params[paramIndex++];
          result = String(row[field]) === String(val);
        } else {
          const simpleMatch = s.match(/(\w+)\s*=\s*(\?|'[^']*'|[\d.]+)/i);
          if (simpleMatch) {
            const field = simpleMatch[1];
            let val = simpleMatch[2];
            if (val === "?") {
              val = params[paramIndex++];
            } else {
              val = val.replace(/['"]/g, "");
            }
            result = String(row[field]) === String(val);
          }
        }
      }

      return isNegated ? !result : result;
    }

    return evaluate(where);
  }

  private runInsert(parsed: any): { changes: number; lastInsertRowid: number } {
    const tableMatch = this.sql.match(/INTO\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
    const tableName = tableMatch[1] as keyof Database;
    const table = (this.db as any)[tableName] as TableData;

    const colsMatch = this.sql.match(/\(([^)]+)\)\s+VALUES/i);
    if (!colsMatch) return { changes: 0, lastInsertRowid: 0 };
    const columns = colsMatch[1].split(",").map((c: string) => c.trim());

    let valParams = parsed.params;
    if (parsed.where) {
      valParams = parsed.params;
    }

    const insertParams = this.sql.match(/VALUES\s*\(([^)]+)\)/i);
    let values: any[] = [];
    if (insertParams) {
      const parts = insertParams[1].split(",").map((s: string) => s.trim());
      let paramIdx = 0;
      for (const part of parts) {
        if (part === "?") {
          values.push(parsed.params[paramIdx++]);
        } else {
          values.push(part.replace(/^['"]|['"]$/g, ""));
        }
      }
    } else {
      values = parsed.params;
    }

    const row: Row = {};
    columns.forEach((col: string, i: number) => {
      row[col] = values[i] !== undefined ? values[i] : null;
    });

    row.id = table.autoIncrement;
    table.autoIncrement++;
    table.rows.push(row);
    saveDb(this.db);

    return { changes: 1, lastInsertRowid: row.id! };
  }

  private runUpdate(parsed: any): { changes: number; lastInsertRowid: number } {
    const tableMatch = this.sql.match(/UPDATE\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
    const tableName = tableMatch[1] as keyof Database;
    const table = (this.db as any)[tableName] as TableData;

    const setMatch = this.sql.match(/SET\s+(.+?)(?:\s+WHERE|$)/is);
    if (!setMatch) return { changes: 0, lastInsertRowid: 0 };
    const setClauses = setMatch[1].split(",").map((s: string) => s.trim());

    let paramOffset = 0;
    const setValues: { field: string; value: any; op: string }[] = [];

    for (const clause of setClauses) {
      if (clause.toUpperCase().includes("COALESCE")) {
        const coalesceMatch = clause.match(/(\w+)\s*=\s*COALESCE\(\?\s*,\s*(\w+)\)/i);
        if (coalesceMatch) {
          setValues.push({ field: coalesceMatch[1], value: parsed.params[paramOffset++], op: "coalesce" });
        }
      } else if (clause.toUpperCase().includes("MAX(")) {
        const maxMatch = clause.match(/(\w+)\s*=\s*MAX\((\w+)\s*-\s*\?\s*,\s*(\d+)\)/i);
        if (maxMatch) {
          setValues.push({ field: maxMatch[1], value: { subtract: parsed.params[paramOffset++], min: parseInt(maxMatch[3]) }, op: "max" });
        }
      } else {
        const simpleMatch = clause.match(/(\w+)\s*=\s*(?:\?|(\w+)\s*\+\s*\?|(\w+)\s*-\s*\?)/i);
        if (simpleMatch) {
          if (clause.includes("+")) {
            setValues.push({ field: simpleMatch[1], value: parsed.params[paramOffset++], op: "add" });
          } else if (clause.includes("-")) {
            setValues.push({ field: simpleMatch[1], value: parsed.params[paramOffset++], op: "subtract" });
          } else {
            setValues.push({ field: simpleMatch[1], value: parsed.params[paramOffset++], op: "set" });
          }
        } else {
          const strLitMatch = clause.match(/(\w+)\s*=\s*'([^']*)'/i);
          if (strLitMatch) {
            setValues.push({ field: strLitMatch[1], value: strLitMatch[2], op: "set" });
          } else {
            const numLitMatch = clause.match(/(\w+)\s*=\s*(\d+\.?\d*)/i);
            if (numLitMatch) {
              setValues.push({ field: numLitMatch[1], value: Number(numLitMatch[2]), op: "set" });
            }
          }
        }
      }
    }

    const rows = this.filterRows(table.rows, parsed.where, parsed.whereParams);

    for (const row of rows) {
      for (const sv of setValues) {
        if (sv.op === "set") {
          row[sv.field] = sv.value;
        } else if (sv.op === "coalesce") {
          if (row[sv.field] === undefined || row[sv.field] === null) {
            row[sv.field] = sv.value;
          }
        } else if (sv.op === "add") {
          row[sv.field] = (row[sv.field] || 0) + sv.value;
        } else if (sv.op === "subtract") {
          row[sv.field] = (row[sv.field] || 0) - sv.value;
        } else if (sv.op === "max") {
          row[sv.field] = Math.max(sv.value.min, (row[sv.field] || 0) - sv.value.subtract);
        }
      }
    }

    saveDb(this.db);
    return { changes: rows.length, lastInsertRowid: 0 };
  }

  private runDelete(parsed: any): { changes: number; lastInsertRowid: number } {
    const tableMatch = this.sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (!tableMatch) return { changes: 0, lastInsertRowid: 0 };
    const tableName = tableMatch[1] as keyof Database;
    const table = (this.db as any)[tableName] as TableData;

    const before = table.rows.length;
    table.rows = table.rows.filter((row) => !this.evaluateWhere(row, parsed.where, parsed.whereParams));
    const deleted = before - table.rows.length;

    saveDb(this.db);
    return { changes: deleted, lastInsertRowid: 0 };
  }
}

function initializeDatabase(db: Database) {
  db.users = db.users || { rows: [], autoIncrement: 1 };
  db.companies = db.companies || { rows: [], autoIncrement: 1 };
  db.holdings = db.holdings || { rows: [], autoIncrement: 1 };
  db.transactions = db.transactions || { rows: [], autoIncrement: 1 };
  db.currency_purchases = db.currency_purchases || { rows: [], autoIncrement: 1 };
  db.price_history = db.price_history || { rows: [], autoIncrement: 1 };
  db.bank_fund = db.bank_fund || { rows: [], autoIncrement: 1 };
  db.settings = db.settings || { rows: [], autoIncrement: 1 };
  db.orders = db.orders || { rows: [], autoIncrement: 1 };

  if (db.bank_fund.rows.length === 0) {
    db.bank_fund.rows.push({ id: 1, balance: 0 });
  }

  if (db.settings.rows.length === 0) {
    db.settings.rows.push({ id: 1, trading_enabled: 1, trading_open_hour: 0, trading_close_hour: 24 });
  }

  if (db.companies.rows.length === 0) {
    seedCompanies(db);
  }
}

function seedCompanies(db: Database) {
  const companies = [
    { name: "NovaTech Industries", ticker: "NVTK", description: "Leading tech innovator in AI and cloud computing", share_price: 15000, total_shares: 5000 },
    { name: "Global Energy Corp", ticker: "GEC", description: "Renewable energy solutions worldwide", share_price: 8500, total_shares: 8000 },
    { name: "MediVita Pharmaceuticals", ticker: "MDVT", description: "Biotech and pharmaceutical research", share_price: 22000, total_shares: 3000 },
    { name: "SkyLine Aerospace", ticker: "SKLA", description: "Space technology and aviation", share_price: 35000, total_shares: 2000 },
    { name: "FreshHarvest Foods", ticker: "FRHV", description: "Organic food production and distribution", share_price: 4500, total_shares: 12000 },
    { name: "CryptoVault Digital", ticker: "CVDC", description: "Cryptocurrency exchange and blockchain services", share_price: 12000, total_shares: 6000 },
    { name: "UrbanBuild Construction", ticker: "UBLD", description: "Smart city infrastructure and construction", share_price: 6800, total_shares: 7000 },
    { name: "AquaPure Systems", ticker: "AQPS", description: "Water purification and environmental tech", share_price: 9200, total_shares: 5500 },
    { name: "NeuralLink Gaming", ticker: "NRLG", description: "VR/AR gaming and immersive experiences", share_price: 18500, total_shares: 4000 },
    { name: "Titan Steel Works", ticker: "TSTL", description: "Advanced materials and metallurgy", share_price: 5500, total_shares: 10000 },
  ];

  const now = Date.now();

  for (const c of companies) {
    const id = db.companies.autoIncrement++;
    db.companies.rows.push({ id, ...c, initial_price: c.share_price, initial_shares: c.total_shares });

    const dayAgo = now - 24 * 60 * 60 * 1000;
    for (let i = 0; i < 24; i++) {
      const time = dayAgo + i * 60 * 60 * 1000;
      const fluctuation = 1 + (Math.random() - 0.5) * 0.06;
      db.price_history.rows.push({
        id: db.price_history.autoIncrement++,
        company_id: id,
        price: Math.round(c.share_price * fluctuation),
        timestamp: time,
      });
    }
  }
}

function prepareQuery(db: Database, sql: string, params: any[] = []): Statement {
  return new Statement(db, sql, params);
}

function getDbProxy() {
  const db = getDb();
  return {
    prepare: (sql: string) => ({
      get: (...params: any[]) => {
        const s = new Statement(db, sql, params);
        const result = s.get(...params);
        flushDb();
        return result;
      },
      all: (...params: any[]) => {
        const s = new Statement(db, sql, params);
        const result = s.all(...params);
        flushDb();
        return result;
      },
      run: (...params: any[]) => {
        const s = new Statement(db, sql, params);
        const result = s.run(...params);
        flushDb();
        return result;
      },
    }),
    transaction: <T>(fn: () => T): T => {
      const result = fn();
      flushDb();
      return result;
    },
    exec: (_sql: string) => {
      flushDb();
    },
    pragma: (_pragma: string) => {},
  };
}

export default getDbProxy;
