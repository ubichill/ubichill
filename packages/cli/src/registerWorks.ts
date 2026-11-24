/**
 * 署名した外部の作品（GitHub Pages などに置くワールド・mod）を、作者アカウントのサーバーに登録する。
 * 登録するとユーザーページに出る（サーバーは公開先の URL を取りに行き、本人の署名付きで配られていると確かめてから出す）。
 * 登録に失敗しても署名は済んでいるので、既定では公開は止めない（警告だけ出す）。`--require-registration` では失敗にする。
 */
import type { ExternalWorkRegistration, ModLockEntry } from '@ubichill/shared';
import type { Logger } from '@ubichill/terminal';

export type RegisterRequest = (
    method: 'PUT' | 'DELETE',
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

/** 登録できなかったときの終了コード（CI が「公開先への反映待ち（1）」と分けてやり直しを止められるように）。 */
export const REGISTRATION_FAILED_EXIT_CODE = 2;

/**
 * `--require-registration` で、登録できなかった作品があった。retryable はやり直せば通るかもしれない失敗だけのとき
 * （サーバーから公開先がまだ見えない・作者の確認待ち・5xx・通信の失敗）で、終了コードは 1（反映待ちと同じ）にする。
 */
export class RegistrationError extends Error {
    constructor(
        message: string,
        readonly retryable: boolean,
    ) {
        super(message);
    }
}

/** コマンドの失敗の終了コード。やり直しても通らない登録の失敗（上限・権限・形）だけ 2。 */
export const exitCodeOf = (error: unknown): number =>
    error instanceof RegistrationError && !error.retryable ? REGISTRATION_FAILED_EXIT_CODE : 1;

const RETRYABLE_CODES = new Set(['mod-not-published', 'author-pending']);

/** 登録の応答の失敗がやり直せるものか（応答が無い・5xx・公開先がまだ見えない 409・作者の確認待ち）。 */
export function retryableRegistrationFailure(res: { status: number; body: Record<string, unknown> } | undefined) {
    if (!res || res.status >= 500) return true;
    return typeof res.body.code === 'string' && RETRYABLE_CODES.has(res.body.code);
}

export async function registerExternalWorks(
    request: RegisterRequest,
    registrations: readonly ExternalWorkRegistration[],
    log: Logger,
    options: { required?: boolean } = {},
): Promise<number> {
    const results = await Promise.all(
        registrations.map(async (registration) => {
            const res = await request('PUT', EXTERNAL_WORKS_PATH, registration).catch(() => undefined);
            if (res?.status === 200) return { ok: true, retryable: true };
            const reason =
                typeof res?.body.error === 'string' ? res.body.error : res ? `HTTP ${res.status}` : '通信できません';
            log.warn(
                `${registration.url} をユーザーページに登録できませんでした（${reason}）${options.required ? '' : '。署名と公開は続けます'}`,
            );
            return { ok: false, retryable: retryableRegistrationFailure(res) };
        }),
    );
    const registered = results.filter((r) => r.ok).length;
    if (registered > 0)
        log.success(`${registered} 件の作品をユーザーページに登録しました`, '公開先で確かめられたものから表示されます');
    if (options.required && registered < registrations.length)
        throw new RegistrationError(
            `${registrations.length - registered} 件の作品をユーザーページ・カタログに登録できませんでした（--require-registration）`,
            results.every((r) => r.retryable),
        );
    return registered;
}

/**
 * 配布先の一覧（`ubichill build` が書く index.json）に載っている mod ID。一覧が無い・配列でなければ undefined（すべて載せる）。
 * 一覧から外した mod も、その版を固定しているワールドのために配布物は残す。カタログとユーザーページにだけ出さない。
 */
export function listedModIds(index: unknown): ReadonlySet<string> | undefined {
    if (!Array.isArray(index)) return undefined;
    return new Set(
        index.flatMap((item: unknown) => {
            const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
            return typeof id === 'string' ? [id] : [];
        }),
    );
}

/** 登録を消す。登録が無い（404）ものは黙って飛ばし、消せた件数を返す。 */
export async function unregisterExternalMods(
    request: RegisterRequest,
    url: string,
    ids: readonly string[],
    log: Logger,
): Promise<number> {
    const results = await Promise.all(
        ids.map(async (name) => {
            const res = await request('DELETE', EXTERNAL_WORKS_PATH, { kind: 'mod', url, name }).catch(() => undefined);
            if (res?.status === 204) {
                log.success(
                    `${name} をユーザーページから外しました`,
                    `${url}/index.json に無いため（配布物は残します）`,
                );
                return true;
            }
            if (res?.status === 404) return false;
            const reason =
                typeof res?.body.error === 'string' ? res.body.error : res ? `HTTP ${res.status}` : '通信できません';
            log.warn(`${name} をユーザーページから外せませんでした（${reason}）`);
            return false;
        }),
    );
    return results.filter(Boolean).length;
}

/**
 * 配置前には登録先を動かさない。全配布物を確認できた後にだけカタログを更新する。
 * `listed`（配布先の一覧）があれば、載っている mod だけを確かめて登録し、載っていない mod の登録は消す。
 */
export async function registerDeployedMods<T extends { entry: ModLockEntry }>(options: {
    checked: boolean;
    signed: readonly T[];
    listed?: ReadonlySet<string>;
    verifyPublic: (mod: T) => Promise<void>;
    register: (latest: readonly T[]) => Promise<number>;
    unregister: (ids: readonly string[]) => Promise<number>;
    log: Logger;
}): Promise<number> {
    if (!options.checked) {
        options.log.info('配布先へ配置した後、publish --public-url=<基点> --check-public で検証・登録してください');
        return 0;
    }
    const { listed } = options;
    const shown = listed ? options.signed.filter((mod) => listed.has(mod.entry.id)) : options.signed;
    const hidden = [...new Set(options.signed.map((mod) => mod.entry.id))].filter((id) => listed && !listed.has(id));
    for (const mod of shown) await options.verifyPublic(mod);
    // 登録に失敗しても、一覧から外した mod の登録は消してから失敗を返す
    const registered = await options.register(latestPerMod(shown)).catch((error: unknown) => error);
    if (hidden.length > 0) await options.unregister(hidden);
    if (typeof registered !== 'number') throw registered;
    return registered;
}
