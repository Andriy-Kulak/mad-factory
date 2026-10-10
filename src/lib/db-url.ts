/**
 * Lenient Postgres URL parser. Supabase dashboard passwords often contain
 * characters that must be percent-encoded in a URL; users rarely do that.
 * Accepts both encoded and raw passwords (the last "@" separates password from host).
 */
export interface DbConn {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function parseDbUrl(url: string): DbConn {
  const m = /^postgres(?:ql)?:\/\/([^:@/]+)(?::(.*))?@([^/?]+)(?:\/([^?]*))?(?:\?.*)?$/.exec(url);
  if (!m) throw new Error("SUPABASE_DB_URL is not a postgres:// URL");
  const [, user, rawPass = "", hostPort, db = "postgres"] = m;
  const safeDecode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const [host, port] = hostPort!.split(":");
  return {
    host: host!,
    port: port ? Number(port) : 5432,
    user: safeDecode(user!),
    password: safeDecode(rawPass),
    database: safeDecode(db || "postgres"),
  };
}

/** Re-encode a parsed URL so strict parsers (Supabase CLI, libpq) accept the password. */
export function normalizeDbUrl(url: string): string {
  const c = parseDbUrl(url);
  return `postgresql://${encodeURIComponent(c.user)}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${encodeURIComponent(c.database)}`;
}
