import { eq } from 'drizzle-orm';
import { db } from '../index';
import { users } from '../schema';

export type UserRecord = typeof users.$inferSelect;

export interface CreateUserInput {
    id: string;
    name: string;
    email: string;
    emailVerified?: boolean;
    image?: string;
    username?: string;
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
                name: input.name,
                email: input.email,
                emailVerified: input.emailVerified ?? false,
                image: input.image,
                username: input.username,
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
            name: 'System',
            email: 'system@ubichill.local',
            emailVerified: true,
        });
    },
};
