import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const connectionString =
    process.env.DATABASE_URL || 'postgresql://ubichill:password@127.0.0.1:5433/ubichill';

async function runMigrate() {
    console.log('🔄 DBマイグレーションを実行中...');

    const client = postgres(connectionString, { max: 1 });
    const db = drizzle(client);

    // __dirname は dist/migrate.js の場所なので、dist/../drizzle を参照
    const migrationsFolder = path.resolve(__dirname, '..', 'drizzle');

    try {
        await migrate(db, { migrationsFolder });
        console.log('✅ DBマイグレーション完了');
    } catch (error) {
        console.error('❌ DBマイグレーション失敗:', error);
        throw error;
    } finally {
        await client.end();
    }
}

runMigrate().catch((err) => {
    console.error(err);
    process.exit(1);
});
