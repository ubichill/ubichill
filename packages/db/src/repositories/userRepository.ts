import { eq } from 'drizzle-orm';
import { db } from '../index';
import { users } from '../schema';

export type UserRecord = typeof users.$inferSelect;

export interface CreateUserInput {
    id?: string;
    username: string;
    email: string;
    passwordHash?: string;
    oauthProvider?: string;
    oauthId?: string;
    profileImageUrl?: string;
}

export const userRepository = {
    async findById(id: string): Promise<UserRecord | undefined> {
        const results = await db.select().from(users).where(eq(users.id, id));
        return results[0];
    },

    async findByEmail(email: string): Promise<UserRecord | undefined> {
        const results = await db.select().from(users).where(eq(users.email, email));
        return results[0];
    },

    async create(input: CreateUserInput): Promise<UserRecord> {
        const results = await db
            .insert(users)
            .values({
                id: input.id,
                username: input.username,
                email: input.email,
                passwordHash: input.passwordHash,
                oauthProvider: input.oauthProvider,
                oauthId: input.oauthId,
                profileImageUrl: input.profileImageUrl,
            })
            .returning();
        return results[0];
    },

    async ensureSystemUser(systemUserId: string): Promise<UserRecord> {
        const existing = await this.findById(systemUserId);
        if (existing) {
            return existing;
        }

        return this.create({
            id: systemUserId,
            username: 'system',
            email: 'system@ubichill.local',
        });
    },
};
