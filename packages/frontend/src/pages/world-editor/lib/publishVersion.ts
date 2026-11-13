const parse = (version: string): [number, number, number] | null => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

const compare = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * 公開に使う版。作者は版を意識しないので、公開中の版から変えるときは必要最小限（パッチ）だけ上げる。
 * - まだ公開していない・中身を変えていない: そのまま
 * - 作者が自分で公開中より上げている: そのまま
 * - それ以外: 公開中の版のパッチを 1 つ上げる
 */
export function nextPublishVersion(input: {
    version: string;
    publishedVersion: string | null;
    changed: boolean;
}): string {
    const published = input.publishedVersion ? parse(input.publishedVersion) : null;
    if (!published || !input.changed) return input.version;
    const current = parse(input.version);
    if (current && compare(current, published) > 0) return input.version;
    return `${published[0]}.${published[1]}.${published[2] + 1}`;
}
