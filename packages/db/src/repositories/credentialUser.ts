import type { db } from '../index';
import { accounts, users } from '../schema';

/** メール・パスワードで登録する確認済みのユーザー（better-auth の signUpEmail が書くものと同じ形）。 */
export interface NewCredentialUser {
    userId: string;
    accountId: string;
    email: string;
    name: string;
    handle: string;
    displayNameKey: string | null;
    passwordHash: string;
    now: Date;
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * users と credential の accounts を同じトランザクションで作る。better-auth の signUpEmail は users を作ってから
 * handle を書く 2 段になり（handle は NOT NULL）、accounts とも別のトランザクションなので使わない。
 * sign-in は providerId='credential' かつ accountId=user.id の行を探し、password を ctx.password.verify で確かめる。
 */
export async function insertCredentialUser(tx: Tx, user: NewCredentialUser): Promise<void> {
    await tx.insert(users).values({
        id: user.userId,
        email: user.email,
        name: user.name,
        emailVerified: true,
        image: null,
        handle: user.handle,
        displayNameKey: user.displayNameKey,
        createdAt: user.now,
        updatedAt: user.now,
    });
    await tx.insert(accounts).values({
        id: user.accountId,
        accountId: user.userId,
        providerId: 'credential',
        userId: user.userId,
        password: user.passwordHash,
        createdAt: user.now,
        updatedAt: user.now,
    });
}
