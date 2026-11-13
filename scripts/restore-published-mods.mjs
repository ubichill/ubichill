/**
 * 公開済みの mod の版を、Host に同梱する mods（packages/frontend/public/mods）へ戻す。
 *
 * Host のイメージはクリーンな checkout からビルドするので、そのままでは今の版しか入らない。mod の版を上げてデプロイすると、
 * 以前の版を固定しているワールドは取得先を失って動かなくなる（リポジトリから外した mod は全部の版を失う）。
 * ビルドの前に公開済み（gh-pages の mods）の版を置いておき、一度公開した版を配り続ける。
 *
 * 置くのは、置き先にまだ無い版のディレクトリ（署名 lock.sig.json ごと）と、版の履歴（index.json の versions）だけ。
 * 今の版はこのあとの build が書く（公開済みの版と中身が違えば、CI の check-published-mods が先に止めている）。
 * 依存を入れていない CI の手順からも動くように、node の標準モジュールだけを使う。
 *
 * 使い方: node scripts/restore-published-mods.mjs <公開済みの mods> <置き先>...
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const isVersionDir = (name) => /^v\d+\.\d+\.\d+$/.test(name);

const compareDesc = (a, b) => {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    const diff = [0, 1, 2].map((i) => pb[i] - pa[i]).find((d) => d !== 0);
    return diff ?? 0;
};

/** index.json の 1 件から版の履歴を取る。versions の無い古い形は、その 1 件を履歴にする。 */
const historyOf = (entry) =>
    Array.isArray(entry?.versions)
        ? entry.versions
        : entry?.version
          ? [{ version: entry.version, components: entry.components ?? [] }]
          : [];

/**
 * 版の履歴を足し合わせた index.json（純粋）。置き先の 1 件を土台にし、同じ版は置き先を優先する。
 * 置き先に無ければ公開済みの内容をそのまま使う。
 */
export function mergeIndex(published, target) {
    if (!target) return published;
    return target.map((entry) => {
        const before = published.find((p) => p.id === entry.id);
        const byVersion = new Map([...historyOf(before), ...historyOf(entry)].map((v) => [v.version, v]));
        return { ...entry, versions: [...byVersion.values()].sort((a, b) => compareDesc(a.version, b.version)) };
    });
}

/**
 * 戻す内容（純粋。読み方は注入する）。
 * @param {{ listDirs: (path: string) => string[], exists: (path: string) => boolean, readJson: (path: string) => unknown }} fs
 * @returns {{ copies: Array<{ from: string, to: string }>, indexes: Array<{ path: string, entries: unknown[] }> }}
 */
export function restorePlan(publishedRoot, targetRoot, fs) {
    const mods = fs.listDirs(publishedRoot);
    const copies = mods.flatMap((mod) => [
        ...fs
            .listDirs(join(publishedRoot, mod))
            .filter(isVersionDir)
            .map((version) => ({ from: join(publishedRoot, mod, version), to: join(targetRoot, mod, version) })),
        // リポジトリから外した mod も、版を指さずに読むワールドのために最新版へのポインタを残す
        { from: join(publishedRoot, mod, 'mod.json'), to: join(targetRoot, mod, 'mod.json') },
    ]);
    const indexes = mods.flatMap((mod) => {
        const from = join(publishedRoot, mod, 'index.json');
        if (!fs.exists(from)) return [];
        const to = join(targetRoot, mod, 'index.json');
        return [{ path: to, entries: mergeIndex(fs.readJson(from), fs.exists(to) ? fs.readJson(to) : undefined) }];
    });
    return { copies: copies.filter((c) => fs.exists(c.from) && !fs.exists(c.to)), indexes };
}

const diskFs = {
    listDirs: (path) =>
        existsSync(path)
            ? readdirSync(path, { withFileTypes: true })
                  .filter((e) => e.isDirectory())
                  .map((e) => e.name)
            : [],
    exists: existsSync,
    readJson: (path) => JSON.parse(readFileSync(path, 'utf8')),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [published, ...targets] = process.argv.slice(2);
    if (!published || targets.length === 0) {
        console.error('使い方: node scripts/restore-published-mods.mjs <公開済みの mods> <置き先>...');
        process.exit(1);
    }
    if (!existsSync(published)) {
        console.error(`公開済みの mods がありません: ${published}`);
        process.exit(1);
    }
    for (const target of targets) {
        const { copies, indexes } = restorePlan(published, target, diskFs);
        for (const { from, to } of copies) cpSync(from, to, { recursive: true });
        for (const { path, entries } of indexes) {
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
        }
        const versions = copies.filter((c) => !c.to.endsWith('mod.json')).length;
        console.log(`${target}: 公開済みの版を ${versions} 件戻しました`);
    }
}
