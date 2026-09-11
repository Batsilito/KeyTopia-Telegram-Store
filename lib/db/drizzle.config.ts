import { defineConfig } from "drizzle-kit";
import path from "path";

const databaseUrl =
  process.env.Neon_Connection ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "Neon_Connection must be set. DATABASE_URL is supported as a fallback.",
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
