/**
 * 公開環境（署名鍵）の登録と取り消しの実体（DB・メール・ワールドのキャッシュをつなぐ）。判定は publishingEnvironments.ts と
 * shared の verifyKeyRegistration。
 */
import { authorKeyRepository } from '@ubichill/db';
import { ENV_KEYS, type RevokeReason, SERVER_CONFIG, verifyKeyRegistration } from '@ubichill/shared';
import { sendAccountNotice } from '../../lib/auth';
import { nodeWorldCrypto } from '../worlds/worldCrypto';
import { worldRegistry } from '../worlds/worldRegistry';
import {
    browserEnvironmentName,
    newEnvironmentNotice,
    type PublishingEnvironmentView,
    publishingEnvironmentView,
    registrationOutcome,
} from './publishingEnvironments';

export type RegisterEnvironmentOutcome =
    | { ok: true; created: boolean; environment: PublishingEnvironmentView }
    | { ok: false; status: 409 | 422; error: string; code?: 'revoked' | 'taken' };

const taken = { ok: false, status: 409, error: 'この鍵は登録できません', code: 'taken' } as const;

export const publishingEnvironmentService = {
    async list(userId: string): Promise<PublishingEnvironmentView[]> {
        return (await authorKeyRepository.listByUser(userId)).map((row) => publishingEnvironmentView(row));
    },

    /** このブラウザを公開環境として登録する（ログインできる = 公開できる）。秘密鍵の所有を署名で証明させる。 */
    async registerBrowser(
        user: { id: string; name: string; email: string },
        proof: { publicKey: string; at: string; signature: string },
        userAgent: string | undefined,
    ): Promise<RegisterEnvironmentOutcome> {
        const verdict = await verifyKeyRegistration(
            { userId: user.id, publicKey: proof.publicKey, at: proof.at },
            proof.signature,
            Date.now(),
            nodeWorldCrypto,
        );
        if (!verdict.ok) return { ok: false, status: 422, error: `鍵の所有を確認できません (${verdict.reason})` };
        const existing = await authorKeyRepository.findLocalKey(proof.publicKey);
        const outcome = registrationOutcome(existing, user.id);
        if (outcome === 'already-registered' && existing) {
            return { ok: true, created: false, environment: publishingEnvironmentView(existing) };
        }
        if (outcome === 'revoked') {
            return { ok: false, status: 409, error: 'この鍵は取り消し済みのため使えません', code: 'revoked' };
        }
        if (outcome === 'taken') return taken;
        try {
            const created = await authorKeyRepository.createLocal({
                userId: user.id,
                kind: 'browser',
                name: browserEnvironmentName(userAgent),
                publicKey: proof.publicKey,
            });
            worldRegistry.invalidateResolvedWorlds();
            // 乗っ取った攻撃者が公開環境を追加しても本人が気付けるように知らせる
            const notice = newEnvironmentNotice({
                displayName: user.name,
                environmentName: created.name,
                siteUrl: new URL('/', process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL).href,
                at: created.createdAt,
            });
            void sendAccountNotice(user.email, notice.subject, notice.text);
            return { ok: true, created: true, environment: publishingEnvironmentView(created) };
        } catch {
            return taken;
        }
    },

    /** 取り消す。その鍵の署名は、取り消し前のものも含めてすべて作者が付かなくなる。 */
    async revoke(userId: string, id: string, reason: RevokeReason): Promise<PublishingEnvironmentView | undefined> {
        const revoked = await authorKeyRepository.revoke(userId, id, reason);
        if (!revoked) return undefined;
        worldRegistry.invalidateResolvedWorlds();
        return publishingEnvironmentView(revoked);
    },
};
