export interface ApiConfig {
  databaseUrl: string;
  port: number;
  corsOrigins: string[];
}

export function loadConfig(): ApiConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const port = Number(process.env.API_PORT ?? 3030);
  // In production the wildcard origin is a misconfiguration — browsers
  // would expose every authenticated API call to any site. Require an
  // explicit comma-separated allow-list.
  const rawCors = process.env.API_CORS_ORIGINS;
  if (process.env.NODE_ENV === "production" && (!rawCors || rawCors === "*")) {
    throw new Error(
      "API_CORS_ORIGINS must be an explicit allow-list in NODE_ENV=production (wildcard '*' rejected)",
    );
  }
  const corsRaw = rawCors ?? "*";
  const corsOrigins = corsRaw === "*" ? ["*"] : corsRaw.split(",").map((s) => s.trim());
  return { databaseUrl, port, corsOrigins };
}
