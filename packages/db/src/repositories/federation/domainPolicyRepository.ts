import type { DomainRestriction } from '@ubichill/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../index';
import { domainPolicies } from '../../schema';

export type DomainPolicyRecord = typeof domainPolicies.$inferSelect;

/** ほかのサーバーとの付き合い方（管理者が決める）。 */
export const domainPolicyRepository = {
    async list(): Promise<DomainPolicyRecord[]> {
        return db.select().from(domainPolicies).orderBy(domainPolicies.domain);
    },

    async set(input: { domain: string; policy: DomainRestriction; reason: string | null; createdBy: string | null }) {
        await db
            .insert(domainPolicies)
            .values(input)
            .onConflictDoUpdate({
                target: domainPolicies.domain,
                set: { policy: input.policy, reason: input.reason, createdBy: input.createdBy },
            });
    },

    async remove(domain: string): Promise<boolean> {
        const rows = await db
            .delete(domainPolicies)
            .where(eq(domainPolicies.domain, domain))
            .returning({ domain: domainPolicies.domain });
        return rows.length > 0;
    },
};
