import { Migrator } from '@mikro-orm/migrations';
import { defineConfig } from '@mikro-orm/postgresql';

export default defineConfig({
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? 'postgres',
  password: process.env.POSTGRES_PASSWORD ?? 'postgres',
  dbName: process.env.POSTGRES_DB ?? 'wagering',

  discovery: {
    warnWhenNoEntities: false,
  },
  migrations: {
    path: './dist/migrations',
    pathTs: './src/migrations',
  },
  extensions: [Migrator],
});
