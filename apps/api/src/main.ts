import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { AppModule } from "./app.module";

function loadEnv() {
  const envPath = join(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    const val = t.slice(i + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function bootstrap() {
  loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads",
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`AP POS API listening on http://localhost:${port}`);
  console.log(
    `Postgres: ${process.env.DATABASE_URL ?? "postgresql://appleclub@localhost:5432/ap_pos"}`,
  );
}

bootstrap();
