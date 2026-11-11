/**
 * 署名した外部の作品（GitHub Pages などに置くワールド・mod）を、作者アカウントのサーバーに登録する。
 * 登録するとユーザーページに出る（サーバーは公開先の URL を取りに行き、本人の署名付きで配られていると確かめてから出す）。
 * 登録に失敗しても署名は済んでいるので、公開は止めない（警告だけ出す）。
 */
import type { ExternalWorkRegistration, ModLockEntry } from '@ubichill/shared';
import type { Logger } from '@ubichill/terminal';

export type RegisterRequest = (
    method: 'PUT',
    path: string,
    body: unknown,
) => Promise<{ status: number; body: Record<string, unknown> }>;

export const EXTERNAL_WORKS_PATH = '/api/v1/users/me/external-works';

/** 公開先の基点を URL にそろえる（末尾の / を除く）。 */
export const normalizePublicUrl = (url: string): string => url.replace(/\/+$/, '');

export { compareVersions } from '@ubichill/shared';

import { compareVersions } from '@ubichill/shared';

/** mod ごとに一番新しい版だけを残す（ユーザーページに出すのは最新の版）。 */
export function latestPerMod<T extends { entry: ModLockEntry }>(signed: readonly T[]): T[] {
    const latest = signed.reduce((acc, item) => {
        const current = acc.get(item.entry.id);
        return !current || compareVersions(item.entry.version, current.entry.version) > 0
            ? new Map(acc).set(item.entry.id, item)
            : acc;
    }, new Map<string, T>());
    return [...latest.values()];
}

export async function registerExternalWorks(
    request: RegisterRequest,
    registrations: readonly ExternalWorkRegistration[],
    log: Logger,
): Promise<number> {
    const results = await Promise.all(
        registrations.map(async (registration) => {
            const res = await request('PUT', EXTERNAL_WORKS_PATH, registration).catch(() => undefined);
            if (res?.status === 200) return true;
            const reason =
                typeof res?.body.error === 'string' ? res.body.error : res ? `HTTP ${res.status}` : '通信できません';
            log.warn(`${registration.url} をユーザーページに登録できませんでした（${reason}）。署名と公開は続けます`);
            return false;
        }),
    );
    const registered = results.filter(Boolean).length;
    if (registered > 0)
        log.success(`${registered} 件の作品をユーザーページに登録しました`, '公開先で確かめられたものから表示されます');
    return registered;
}

/** 配置前には登録先を動かさない。全配布物を確認できた後にだけカタログを更新する。 */
export async function registerDeployedMods<T extends { entry: ModLockEntry }>(options: {
    checked: boolean;
    signed: readonly T[];
    verifyPublic: (mod: T) => Promise<void>;
    register: (latest: readonly T[]) => Promise<number>;
    log: Logger;
}): Promise<number> {
    if (!options.checked) {
        options.log.info('配布先へ配置した後、publish --public-url=<基点> --check-public で検証・登録してください');
        return 0;
    }
    for (const mod of options.signed) await options.verifyPublic(mod);
    return options.register(latestPerMod(options.signed));
}
