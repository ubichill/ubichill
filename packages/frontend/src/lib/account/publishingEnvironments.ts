import type { RevokeReason } from '@ubichill/shared';
import type { PublishingEnvironment } from './me';

/** これより長く使われていない公開環境は、取り消し忘れとして目立たせる。 */
export const STALE_ENVIRONMENT_MS = 90 * 24 * 60 * 60 * 1000;

export function isStaleEnvironment(env: PublishingEnvironment, now: number): boolean {
    if (env.revokedAt) return false;
    const lastActivity = Date.parse(env.lastUsedAt ?? env.createdAt);
    return now - lastActivity > STALE_ENVIRONMENT_MS;
}

/** 有効なものを先に、それぞれ最近使った順。取り消したものは後ろにまとめる。 */
export function sortEnvironments(envs: readonly PublishingEnvironment[]): PublishingEnvironment[] {
    const activity = (e: PublishingEnvironment) => Date.parse(e.lastUsedAt ?? e.createdAt);
    return [...envs].sort((a, b) => {
        if (!!a.revokedAt !== !!b.revokedAt) return a.revokedAt ? 1 : -1;
        return activity(b) - activity(a);
    });
}

/** 追加されてからこの期間は「新しい」と目立たせる（心当たりのない環境に気付けるように）。 */
export const RECENTLY_ADDED_MS = 7 * 24 * 60 * 60 * 1000;

export function isRecentlyAdded(env: PublishingEnvironment, now: number): boolean {
    return !env.revokedAt && now - Date.parse(env.createdAt) <= RECENTLY_ADDED_MS;
}

export function revokeConfirmMessage(env: PublishingEnvironment, isThisBrowser: boolean, reason: RevokeReason): string {
    return [
        `「${env.name}」を取り消します。`,
        'この環境で署名したワールドは、取り消し前のものも含めて作者が外れ、署名し直すまで一覧に出なくなります。元に戻せません。',
        reason === 'compromised'
            ? 'この環境で署名したワールドは内容が書き換えられている可能性があるため、まとめて署名し直す対象にはせず、1 つずつ確認してもらいます。'
            : '',
        isThisBrowser ? 'このブラウザで次に公開するときは、新しい公開環境が自動で追加されます。' : '',
    ]
        .filter(Boolean)
        .join('');
}
