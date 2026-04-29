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
  const corsRaw = process.env.API_CORS_ORIGINS ?? "*";
  const corsOrigins = corsRaw === "*" ? ["*"] : corsRaw.split(",").map((s) => s.trim());
  return { databaseUrl, port, corsOrigins };
}
