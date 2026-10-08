import { defineConfig } from "drizzle-kit";

// Импорт ради побочного эффекта: подхватывает crm/.env в process.env.
import { config } from "./server/config.ts";

export default defineConfig({
  dialect: "postgresql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: config.databaseUrl },
});
