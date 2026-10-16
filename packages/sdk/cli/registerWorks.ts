/**
 * 署名した外部の作品（GitHub Pages などに置くワールド・mod）を、作者アカウントのサーバーに登録する。
 * 登録するとユーザーページに出る（サーバーは公開先の URL を取りに行き、本人の署名付きで配られていると確かめてから出す）。
 * 登録に失敗しても署名は済んでいるので、公開は止めない（警告だけ出す）。
 */
import type { ExternalWorkRegistration, ModLockEntry } from '@ubichill/shared';

export type RegisterRequest = (
    method: 'PUT',
    path: string,
    body: unknown,
) => Promise<{ status: number; body: Record<string, unknown> }>;

export const EXTERNAL_WORKS_PATH = '/api/v1/users/me/external-works';

/** 公開先の基点を URL にそろえる（末尾の / を除く）。 */
export const normalizePublicUrl = (url: string): string => url.replace(/\/+$/, '');

const compareIdentifiers = (x: string, y: string): number => {
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1; // 数字だけの識別子は英数字の識別子より前
    return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * SemVer 2.0.0 の優先順位で比べる。a が新しければ正。
 * - ビルドメタデータ（`+...`）は順位に使わない
 * - 本体（major.minor.patch）は数として比べる
 * - プレリリース（`-alpha` など）は正式版より古い。識別子ごとに比べ、数字だけの識別子は数として、ほかは文字列として比べる
 */
export function compareVersions(a: string, b: string): number {
    const parse = (v: string) => {
        const [withoutBuild = ''] = v.split('+');
        const dash = withoutBuild.indexOf('-');
        const core = dash === -1 ? withoutBuild : withoutBuild.slice(0, dash);
        const pre = dash === -1 ? [] : withoutBuild.slice(dash + 1).split('.');
        return { core: core.split('.').map((n) => Number(n) || 0), pre };
    };
    const [pa, pb] = [parse(a), parse(b)];
    const coreDiff = [0, 1, 2].map((i) => (pa.core[i] ?? 0) - (pb.core[i] ?? 0)).find((d) => d !== 0);
    if (coreDiff) return coreDiff;
    if (pa.pre.length === 0 || pb.pre.length === 0) return pb.pre.length - pa.pre.length;
    const length = Math.max(pa.pre.length, pb.pre.length);
    const preDiff = Array.from({ length }, (_, i) => i)
        .map((i) => {
            const [x, y] = [pa.pre[i], pb.pre[i]];
            if (x === undefined || y === undefined) return x === undefined ? -1 : 1; // 識別子が少ない方が前
            return compareIdentifiers(x, y);
        })
        .find((d) => d !== 0);
    return preDiff ?? 0;
}

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
    log: (message: string) => void,
): Promise<number> {
    const results = await Promise.all(
        registrations.map(async (registration) => {
            const res = await request('PUT', EXTERNAL_WORKS_PATH, registration).catch(() => undefined);
            if (res?.status === 200) return true;
            const reason = typeof res?.body.error === 'string' ? res.body.error : res ? `HTTP ${res.status}` : '通信できません';
            log(`⚠ ${registration.url} をユーザーページに登録できませんでした（${reason}）。署名と公開は続けます`);
            return false;
        }),
    );
    const registered = results.filter(Boolean).length;
    if (registered > 0) log(`📇 ${registered} 件の作品をユーザーページに登録しました（公開先で確かめられたものから表示されます）`);
    return registered;
}
