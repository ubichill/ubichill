import { defineConfig } from 'drizzle-kit';

export default defineConfig({
    schema: './src/schema/*',
    out: './drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL || 'postgresql://ubichill:password@127.0.0.1:5433/ubichill',
    },
});
