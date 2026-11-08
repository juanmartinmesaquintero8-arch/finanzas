import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { resolveListenHost } from './listen-host';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  const port = Number(process.env.API_PORT ?? 3001);
  const host = resolveListenHost(process.env);
  await app.listen(port, host);
  console.log(`API de Finanzas escuchando en http://${host}:${port}`);
}

void bootstrap();
