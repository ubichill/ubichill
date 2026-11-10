/**
 * 外部の作品の登録（`ubichill publish` が署名したときに送る）。署名の作者が本人のものだけ受け付ける。
 * 確かめ方は externalWorks.ts の verifyRegistration、上限は shared の MAX_EXTERNAL_WORKS_PER_USER。
 */
import { externalWorkRepository } from '@ubichill/db';
import { ENV_KEYS, type ExternalWorkRegistration, MAX_EXTERNAL_WORKS_PER_USER, SERVER_CONFIG } from '@ubichill/shared';
import yaml from 'yaml';
import { isAuthorKey } from '../authors/authorKeyService';
import { selfAccount } from '../authors/authorKeys';
import { federation } from '../federation';
import { verifyRegistration } from './externalWorks';
import { nodeWorldCrypto } from './worldCrypto';

type Verdict = Awaited<ReturnType<typeof verifyRegistration>>;

export type RegisterWorkOutcome =
    | { ok: true; work: Extract<Verdict, { ok: true }>['work'] }
    | { ok: false; status: number; error: string; code: string };

export async function registerExternalWork(
    owner: { id: string; handle: string },
    registration: ExternalWorkRegistration,
    tokenPublicKey: string | undefined,
): Promise<RegisterWorkOutcome> {
    const verdict = await verifyRegistration(registration, {
        account: selfAccount(owner.handle),
        crypto: nodeWorldCrypto,
        isAuthorKey,
        parseYaml: (text) => yaml.parse(text) as unknown,
        selfOrigin: new URL(process.env[ENV_KEYS.PUBLIC_BASE_URL] || SERVER_CONFIG.DEV_URL).origin,
        ...(tokenPublicKey ? { tokenPublicKey } : {}),
    });
    if (!verdict.ok) return { ok: false, status: verdict.status, error: verdict.error, code: verdict.code };
    const saved = await externalWorkRepository.registerWithinLimit(
        {
            userId: owner.id,
            kind: verdict.work.kind,
            url: verdict.work.url,
            name: verdict.work.name,
            version: verdict.work.version,
        },
        MAX_EXTERNAL_WORKS_PER_USER,
    );
    if (saved === 'limit') {
        return {
            ok: false,
            status: 409,
            error: `外部の作品は ${MAX_EXTERNAL_WORKS_PER_USER} 件まで登録できます。設定から不要なものを外してください`,
            code: 'limit',
        };
    }
    federation?.featuredChanged(owner.id);
    return { ok: true, work: verdict.work };
}

/** 登録を外す。外したら固定ノートも作り直す。 */
export async function removeExternalWork(input: {
    userId: string;
    kind: string;
    url: string;
    name: string;
}): Promise<boolean> {
    const removed = await externalWorkRepository.remove(input);
    if (removed) federation?.featuredChanged(input.userId);
    return removed;
}
