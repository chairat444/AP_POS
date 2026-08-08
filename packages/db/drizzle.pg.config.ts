import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/pg-schema.ts",
  out: "./drizzle/pg",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://appleclub@localhost:5432/ap_pos",
  },
});
