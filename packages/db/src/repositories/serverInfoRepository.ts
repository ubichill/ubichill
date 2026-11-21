import { db } from '../index';
import { serverInfo } from '../schema';

export interface ServerInfoRecord {
    name: string;
    description: string | null;
    maintainerName: string | null;
    maintainerEmail: string | null;
    tosUrl: string | null;
    privacyPolicyUrl: string | null;
    inquiryUrl: string | null;
    repositoryUrl: string | null;
    impressumUrl: string | null;
}

const ID = 'current';

/** サーバーの情報（1 行だけ。行が無ければ既定の値）。 */
export const serverInfoRepository = {
    async get(): Promise<(ServerInfoRecord & { updatedAt: Date }) | null> {
        const [row] = await db
            .select({
                name: serverInfo.name,
                description: serverInfo.description,
                maintainerName: serverInfo.maintainerName,
                maintainerEmail: serverInfo.maintainerEmail,
                tosUrl: serverInfo.tosUrl,
                privacyPolicyUrl: serverInfo.privacyPolicyUrl,
                inquiryUrl: serverInfo.inquiryUrl,
                repositoryUrl: serverInfo.repositoryUrl,
                impressumUrl: serverInfo.impressumUrl,
                updatedAt: serverInfo.updatedAt,
            })
            .from(serverInfo);
        return row ?? null;
    },

    async put(input: ServerInfoRecord, now = new Date()): Promise<void> {
        const values = { ...input, updatedAt: now };
        await db
            .insert(serverInfo)
            .values({ id: ID, ...values })
            .onConflictDoUpdate({ target: serverInfo.id, set: values });
    },
};
