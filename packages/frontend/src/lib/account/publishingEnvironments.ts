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

export function revokeConfirmMessage(env: PublishingEnvironment, isThisBrowser: boolean): string {
    return [
        `「${env.name}」を取り消します。`,
        'この環境で署名したワールドは、取り消し前のものも含めて作者が外れ、署名し直すまで一覧に出なくなります。元に戻せません。',
        isThisBrowser ? 'このブラウザで次に公開するときは、新しい公開環境が自動で追加されます。' : '',
    ]
        .filter(Boolean)
        .join('');
}
