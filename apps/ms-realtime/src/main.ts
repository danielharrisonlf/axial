import "reflect-metadata";
import { Module, type OnApplicationShutdown } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { readConfig } from "./config.js";
import { RealtimeServer } from "./realtime.js";

@Module({})
class AppModule implements OnApplicationShutdown {
  server?: RealtimeServer;
  async onApplicationShutdown(): Promise<void> {
    await this.server?.close();
  }
}
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  try {
    app.get(AppModule).server = await RealtimeServer.start(readConfig(process.env));
  } catch (error) {
    await app.close();
    throw error;
  }
}
void bootstrap();
