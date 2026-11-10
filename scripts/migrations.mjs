/**
 * drizzle のマイグレーションの順の規則。drizzle は最後に当てたものより `when` が新しいものしか当てないので、
 * 並行した PR で `when` が `idx` の順に並ばないと、古い `when` のマイグレーションは何も言わずに飛ばされる。
 * snapshot の `prevId` の鎖が切れている・枝分かれしているのは、2 つの PR が同じ親から生成した印。
 */

export const ROOT_SNAPSHOT_ID = '00000000-0000-0000-0000-000000000000';

/** `0012_cli_auth_requests` → `0012`（snapshot のファイル名の頭） */
export const migrationPrefix = (tag) => tag.split('_')[0];

/**
 * @param {{ entries: { idx: number; when: number; tag: string }[] }} journal
 * @param {Map<string, { id: string; prevId: string }>} snapshots `0012` → snapshot
 * @param {readonly string[]} sqlTags drizzle/ にある .sql の名前（拡張子なし）
 * @returns {string[]} 違反の説明（無ければ空）
 */
export function checkMigrations(journal, snapshots, sqlTags) {
    const entries = journal.entries;
    const tags = new Set(entries.map((e) => e.tag));
    const prefixes = new Set(entries.map((e) => migrationPrefix(e.tag)));

    const order = entries.flatMap((e, i) => {
        const prev = entries[i - 1];
        return [
            ...(e.idx === i ? [] : [`${e.tag}: idx が ${e.idx}（並びでは ${i} 番目）`]),
            ...(prev && !(e.when > prev.when)
                ? [`${e.tag}: when（${e.when}）が前の ${prev.tag}（${prev.when}）より新しくない。drizzle はこれを当てずに飛ばす`]
                : []),
        ];
    });

    const files = [
        ...entries.flatMap((e) => (sqlTags.includes(e.tag) ? [] : [`${e.tag}: ${e.tag}.sql が無い`])),
        ...sqlTags.filter((t) => !tags.has(t)).map((t) => `${t}.sql: journal に無い（当てられない）`),
        ...[...snapshots.keys()]
            .filter((p) => !prefixes.has(p))
            .map((p) => `${p}_snapshot.json: journal に無い`),
    ];

    const chain = entries.flatMap((e, i) => {
        const snapshot = snapshots.get(migrationPrefix(e.tag));
        if (!snapshot) return [`${e.tag}: ${migrationPrefix(e.tag)}_snapshot.json が無い`];
        const expected = i === 0 ? ROOT_SNAPSHOT_ID : snapshots.get(migrationPrefix(entries[i - 1].tag))?.id;
        return expected === undefined || snapshot.prevId === expected
            ? []
            : [`${e.tag}: snapshot の prevId（${snapshot.prevId}）が前の snapshot の id（${expected}）でない。同じ親から 2 つ生成された`];
    });

    return [...order, ...files, ...chain];
}
