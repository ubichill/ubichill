import { and, eq } from 'drizzle-orm';
import { db } from '../../index';
import { federatedAdmissions } from '../../schema';

/** このサーバーの部屋に入れた、ほかのサーバーの来訪者（部屋が続く間は、入り直しに招待を求めない）。 */
export const admissionRepository = {
    async admit(instanceId: string, actorId: string, now: Date): Promise<void> {
        await db
            .insert(federatedAdmissions)
            .values({ instanceId, actorId, admittedAt: now })
            .onConflictDoNothing({ target: [federatedAdmissions.instanceId, federatedAdmissions.actorId] });
    },

    async isAdmitted(instanceId: string, actorId: string): Promise<boolean> {
        const [row] = await db
            .select({ actorId: federatedAdmissions.actorId })
            .from(federatedAdmissions)
            .where(and(eq(federatedAdmissions.instanceId, instanceId), eq(federatedAdmissions.actorId, actorId)));
        return !!row;
    },

    /** 締め出した（もう入り直せない）。 */
    async revoke(instanceId: string, actorId: string): Promise<void> {
        await db
            .delete(federatedAdmissions)
            .where(and(eq(federatedAdmissions.instanceId, instanceId), eq(federatedAdmissions.actorId, actorId)));
    },
};
