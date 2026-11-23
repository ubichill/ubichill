import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import * as schema from '../schema';
import { instanceRepository } from './instanceRepository';
import { userRepository } from './userRepository';

/** 時刻の列（timestamptz）の DB 統合テスト。DATABASE_URL がある時だけ走る。 */
const RUN = !!process.env.DATABASE_URL;
const stamp = Date.now().toString(36);
const CLOCK_SKEW_MS = 5_000;

describe.skipIf(!RUN)('instances の時刻（timestamptz, DB統合）', () => {
    it('セッションの TimeZone が UTC でなくても、created_at（now()）と Date で書いた値が同じ瞬間として読める', async () => {
        const client = postgres(process.env.DATABASE_URL as string, {
            prepare: false,
            max: 1,
            connection: { TimeZone: 'Asia/Tokyo' },
        });
        const tokyo = drizzle(client, { schema });
        const userId = `tz-it-${stamp}`;
        try {
            await tokyo
                .insert(schema.users)
                .values({ id: userId, name: userId, email: `${userId}@example.com`, handle: `tz_${stamp}` });
            const before = Date.now();
            const expiresAt = new Date(before + 60_000);
            const [created] = await tokyo
                .insert(schema.instances)
                .values({ worldRef: 'https://world.test/tz.yaml', leaderId: userId, expiresAt })
                .returning();
            const after = Date.now();

            const read = await instanceRepository.findById(created.id);
            expect(read?.expiresAt?.getTime()).toBe(expiresAt.getTime());
            expect(read?.createdAt.getTime()).toBe(created.createdAt.getTime());
            expect(read?.createdAt.getTime()).toBeGreaterThanOrEqual(before - CLOCK_SKEW_MS);
            expect(read?.createdAt.getTime()).toBeLessThanOrEqual(after + CLOCK_SKEW_MS);
        } finally {
            await userRepository.deleteById(userId);
            await client.end({ timeout: 5 });
        }
    });

    it('held_until は作成で書いた瞬間のまま一覧（reaper が読む）に出る。指定しなければ NULL', async () => {
        const userId = `held-it-${stamp}`;
        try {
            await userRepository.create({
                id: userId,
                name: userId,
                email: `${userId}@example.com`,
                handle: `held_${stamp}`,
            });
            const heldUntil = new Date(Date.now() + 60_000);
            const held = await instanceRepository.create({
                worldRef: 'https://world.test/held.yaml',
                leaderId: userId,
                heldUntil,
            });
            const plain = await instanceRepository.create({
                worldRef: 'https://world.test/held.yaml',
                leaderId: userId,
            });
            expect(held.heldUntil?.getTime()).toBe(heldUntil.getTime());

            const listed = new Map((await instanceRepository.findAll()).map((row) => [row.id, row]));
            expect(listed.get(held.id)?.heldUntil?.getTime()).toBe(heldUntil.getTime());
            expect(listed.get(plain.id)?.heldUntil).toBeNull();
        } finally {
            await userRepository.deleteById(userId);
        }
    });
});
