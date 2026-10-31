import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { json, urlencoded, type Request, type Response, type NextFunction } from "express";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { unwrapWafJsonBody } from "@ap-pos/shared";
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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.use(json({ limit: "8mb" }));
  app.use(urlencoded({ extended: true, limit: "8mb" }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === "object") {
      req.body = unwrapWafJsonBody(req.body);
    }
    next();
  });
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
