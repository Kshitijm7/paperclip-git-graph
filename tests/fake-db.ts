import type { PluginDatabaseClient } from "@paperclipai/plugin-sdk";

/**
 * Minimal in-memory stand-in for ctx.db, covering only the INSERT/DELETE/SELECT
 * shapes cache.ts and live.ts actually emit against the plugin namespace.
 */
export function createFakeDb(namespace: string): PluginDatabaseClient & { dump(table: string): Record<string, unknown>[] } {
  const tables = new Map<string, Record<string, unknown>[]>();

  function tableOf(sql: string): Record<string, unknown>[] {
    const match = new RegExp(`(?:FROM|INTO)\\s+${namespace}\\.(\\w+)`, "i").exec(sql);
    if (!match) throw new Error(`fake db could not resolve table from: ${sql}`);
    const name = match[1];
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  }

  let nextId = 1;

  function insertRows(sql: string, params: unknown[] = []) {
    const table = tableOf(sql);
    const colsMatch = /\(([^)]+)\)\s+VALUES/i.exec(sql);
    if (!colsMatch) throw new Error(`fake db could not parse INSERT columns: ${sql}`);
    const cols = colsMatch[1].split(",").map((c) => c.trim());
    for (let i = 0; i < params.length; i += cols.length) {
      const row: Record<string, unknown> = { id: nextId++ };
      cols.forEach((col, idx) => {
        const value = params[i + idx];
        // Postgres auto-parses jsonb on read; mimic that for the one jsonb column we use.
        row[col] = col === "extra_json" && typeof value === "string" ? JSON.parse(value) : value;
      });
      table.push(row);
    }
  }

  function deleteRows(sql: string, params: unknown[] = []) {
    const table = tableOf(sql);
    const match = /WHERE\s+company_id\s*=\s*\$1/i.exec(sql);
    if (!match) throw new Error(`fake db only supports company_id deletes: ${sql}`);
    const companyId = params[0];

    // events pruning: "... AND id NOT IN (SELECT id ... ORDER BY at DESC LIMIT N)" keeps only the newest N rows.
    const pruneMatch = /NOT IN\s*\(SELECT id FROM \S+ WHERE company_id\s*=\s*\$1 ORDER BY at DESC LIMIT (\d+)\)/i.exec(sql);
    if (pruneMatch) {
      const keep = Number(pruneMatch[1]);
      const scoped = table.filter((row) => row.company_id === companyId).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const keptIds = new Set(scoped.slice(0, keep).map((row) => row.id));
      const remaining = table.filter((row) => row.company_id !== companyId || keptIds.has(row.id));
      table.length = 0;
      table.push(...remaining);
      return;
    }

    const remaining = table.filter((row) => row.company_id !== companyId);
    table.length = 0;
    table.push(...remaining);
  }

  return {
    namespace,
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const table = tableOf(sql);
      const companyMatch = /WHERE\s+company_id\s*=\s*\$1/i.exec(sql);
      let rows = companyMatch ? table.filter((row) => row.company_id === params[0]) : [...table];
      if (/ORDER BY position ASC/i.test(sql)) rows = [...rows].sort((a, b) => Number(a.position) - Number(b.position));
      if (/ORDER BY at DESC/i.test(sql)) rows = [...rows].sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const offsetMatch = /OFFSET\s+\$(\d+)/i.exec(sql);
      const limitParamMatch = /LIMIT\s+\$(\d+)/i.exec(sql);
      const offset = offsetMatch ? Number(params[Number(offsetMatch[1]) - 1]) || 0 : 0;
      if (limitParamMatch) {
        const limit = Number(params[Number(limitParamMatch[1]) - 1]) || 0;
        rows = rows.slice(offset, offset + limit);
      } else {
        const limitMatch = /LIMIT\s+(\d+)/i.exec(sql);
        if (limitMatch) rows = rows.slice(offset, offset + Number(limitMatch[1]));
      }
      return rows as T[];
    },
    async execute(sql: string, params: unknown[] = []): Promise<{ rowCount: number }> {
      if (/^\s*DELETE/i.test(sql)) {
        const before = tableOf(sql).length;
        deleteRows(sql, params);
        return { rowCount: before - tableOf(sql).length };
      }
      if (/^\s*INSERT/i.test(sql)) {
        insertRows(sql, params);
        return { rowCount: 1 };
      }
      if (/^\s*UPDATE\s+\S+\s+SET\s+extra_json\s*=\s*\$2\s+WHERE\s+company_id\s*=\s*\$1/i.test(sql)) {
        const table = tableOf(sql.replace("UPDATE", "FROM"));
        const companyId = params[0];
        const extra = typeof params[1] === "string" ? JSON.parse(params[1] as string) : params[1];
        let updated = 0;
        for (const row of table) {
          if (row.company_id === companyId) {
            row.extra_json = extra;
            updated += 1;
          }
        }
        return { rowCount: updated };
      }
      throw new Error(`fake db does not support: ${sql}`);
    },
    dump(table: string) {
      return tables.get(table) ?? [];
    }
  };
}
