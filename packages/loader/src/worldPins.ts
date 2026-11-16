/**
 * ワールド YAML に、実際に使う版を書き込む。
 * - 依存: 'latest'（と省略）を lock が固定した版にする。'latest' は「いつ最新になるか」が分かりにくく、
 *   書いてあることと動きが食い違うので、エディタと同じく常に版を書く（版を変えるのは install・update を実行したときだけ）。
 * - ubichill の版（spec.requires.protocol）: 無ければ今の版で固定する。あれば変えない（上げるのは作者が決める）。
 * 人が書く YAML なので、書き換える所だけを元の文字列に差し込み、ほかの整形とコメントは変えない。
 * 差し込めない形（版の無い `source: {}` など）のときだけ、YAML として書き直す。
 */
import { lockedMods, type ModLock, PROTOCOL_VERSION } from '@ubichill/shared';
import yaml, { isMap, isScalar, isSeq, type Pair, type YAMLMap } from 'yaml';

interface Edit {
    at: number;
    end: number;
    text: string;
}

/**
 * 書き換えた YAML。書き換える所が無ければ元の文字列をそのまま返す。
 * `versions` に書いた依存は、固定済みでもその版に書き換える（update で上げた版）。
 */
export function pinWorldYaml(
    raw: string,
    lock: ModLock,
    protocol: number = PROTOCOL_VERSION,
    versions: Readonly<Record<string, string>> = {},
): string {
    const doc = yaml.parseDocument(raw);
    const spec = doc.get('spec');
    if (!isMap(spec)) return raw;
    const entries = lockedMods(lock);
    const dependencies = spec.get('dependencies');
    const items = isSeq(dependencies) ? dependencies.items : [];

    const pins = items.flatMap((item, index) => {
        if (!isMap(item)) return [];
        const name = item.get('name');
        const node = item.getIn(['source', 'version'], true);
        const version = isScalar(node) ? node.value : undefined;
        const unpinned = version === undefined || version === 'latest';
        const pinned =
            typeof name !== 'string' ? undefined : (versions[name] ?? (unpinned ? entries[name]?.version : undefined));
        if (!pinned || pinned === version) return [];
        return [{ index, pinned, node: isScalar(node) && node.range ? node : undefined }];
    });
    const requiresEdit = spec.has('requires') ? null : insertRequires(raw, spec, protocol);
    const textEdits = pins.every((pin) => pin.node) && requiresEdit !== undefined;

    if (pins.length === 0 && requiresEdit === null) return raw;
    if (textEdits) {
        const edits: Edit[] = [
            ...pins.flatMap(({ node, pinned }) =>
                node?.range ? [{ at: node.range[0], end: node.range[1], text: pinned }] : [],
            ),
            ...(requiresEdit ? [requiresEdit] : []),
        ];
        return [...edits]
            .sort((a, b) => b.at - a.at)
            .reduce((text, e) => text.slice(0, e.at) + e.text + text.slice(e.end), raw);
    }
    for (const { index, pinned } of pins) doc.setIn(['spec', 'dependencies', index, 'source', 'version'], pinned);
    if (!spec.has('requires')) {
        const anchor = requiresAnchor(spec);
        const index = anchor ? spec.items.indexOf(anchor) + 1 : spec.items.length;
        spec.items.splice(index, 0, doc.createPair('requires', { protocol }) as (typeof spec.items)[number]);
    }
    return String(doc);
}

/** requires を置く場所（このキーの後）。依存・定員・説明・表示名の順に探す。 */
function requiresAnchor(spec: YAMLMap): Pair<unknown, unknown> | undefined {
    return ['dependencies', 'capacity', 'description', 'displayName']
        .map((key) => spec.items.find((pair) => isScalar(pair.key) && pair.key.value === key))
        .find((pair): pair is Pair<unknown, unknown> => pair !== undefined);
}

/** 読みやすい位置（依存の後など）に足す。null は足さなくてよい、undefined は差し込めない形。 */
function insertRequires(raw: string, spec: YAMLMap, protocol: number): Edit | null | undefined {
    const anchor = requiresAnchor(spec);
    const keyStart = isScalar(anchor?.key) ? anchor.key.range?.[0] : undefined;
    const valueEnd = (anchor?.value as { range?: [number, number, number] } | undefined)?.range?.[2];
    if (keyStart === undefined || valueEnd === undefined || spec.flow) return undefined;
    const indent = ' '.repeat(keyStart - (raw.lastIndexOf('\n', keyStart - 1) + 1));
    const block = `${indent}requires:\n${indent}  protocol: ${protocol}\n`;
    const newline = raw[valueEnd - 1] === '\n' ? valueEnd - 1 : raw.indexOf('\n', valueEnd);
    if (newline === -1) return { at: raw.length, end: raw.length, text: `\n${block}` };
    return { at: newline + 1, end: newline + 1, text: block };
}
