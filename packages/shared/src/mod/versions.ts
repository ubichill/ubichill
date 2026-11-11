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
