import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export { instanceRepository } from './repositories/instanceRepository';
export { userRepository } from './repositories/userRepository';
export { worldRepository } from './repositories/worldRepository';

const connectionString = process.env.DATABASE_URL || 'postgresql://ubichill:password@127.0.0.1:5433/ubichill';

// Disable prefetch as it is not supported for "Transaction" pool mode
export const client = postgres(connectionString, { prepare: false });
export const db: PostgresJsDatabase<typeof schema> = drizzle(client, { schema });

export * from './schema';
