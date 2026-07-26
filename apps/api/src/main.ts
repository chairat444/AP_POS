import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { join } from "node:path";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.useStaticAssets(join(process.cwd(), "uploads"), {
    prefix: "/uploads",
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`AP POS API listening on http://localhost:${port}`);
}

bootstrap();
