/**
 * 公開済みの mod の版を、別の中身で上書きしない。
 *
 * mod の配布物（`<mod>/v<版>/`）は、ワールドの lock がその版の manifest と Worker の hash で固定している。
 * 同じ版のまま中身が変わる（mod のコードや、mod に取り込まれる SDK・shared の変更）と、公開先で上書きされた瞬間に、
 * その版を固定している外部のワールドが「固定した内容と違う定義が配られています」で動かなくなる。
 * 中身を変えたら版を上げる。ここでは、ビルドした版がすでに公開されていて中身が違うものを見つけて止める。
 *
 * 使い方: node scripts/check-published-mods.mjs <ビルドした mods（dist/mods）> <公開済みの mods（gh-pages の mods）>
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTerminal, debugFromEnv, processIO } from '@ubichill/terminal';

/** 中身を決めるファイル。manifest は Worker・asset の hash を、lock は Worker の hash と権限を持つ。 */
const CONTENT_FILES = ['manifest.json', 'lock.json'];

const isVersionDir = (name) => /^v\d+\./.test(name);

/**
 * 公開済みなのに中身が違う版（純粋。読み方は注入する）。
 * @param {{ listDirs: (path: string) => string[], read: (path: string) => Uint8Array | null }} fs
 */
export function findOverwrites(builtRoot, publishedRoot, fs) {
    return fs.listDirs(builtRoot).flatMap((mod) =>
        fs
            .listDirs(join(builtRoot, mod))
            .filter(isVersionDir)
            .filter((version) => {
                const published = CONTENT_FILES.map((f) => fs.read(join(publishedRoot, mod, version, f)));
                if (published.every((bytes) => bytes === null)) return false; // まだ公開していない版
                return CONTENT_FILES.some((f, i) => {
                    const built = fs.read(join(builtRoot, mod, version, f));
                    const before = published[i];
                    return !built || !before || Buffer.compare(Buffer.from(built), Buffer.from(before)) !== 0;
                });
            })
            .map((version) => ({ mod, version: version.slice(1) })),
    );
}

const diskFs = {
    listDirs: (path) =>
        existsSync(path)
            ? readdirSync(path, { withFileTypes: true })
                  .filter((e) => e.isDirectory())
                  .map((e) => e.name)
            : [],
    read: (path) => (existsSync(path) ? readFileSync(path) : null),
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const term = createTerminal(processIO(), { debug: debugFromEnv(process.env) });
    const [built, published] = process.argv.slice(2);
    if (!built || !published) {
        term.error('使い方: node scripts/check-published-mods.mjs <dist/mods> <公開済みの mods>');
        process.exit(1);
    }
    const overwrites = findOverwrites(built, published, diskFs);
    if (overwrites.length > 0) {
        for (const { mod, version } of overwrites) {
            // GitHub Actions の注釈（::error::）。行の頭から書式を付けずに出さないと注釈にならない
            console.error(
                `::error::${mod}@${version} は公開済みで、ビルドした中身が違います。mods/${mod}/package.json の version を上げてください（同じ版のまま上書きすると、その版を固定しているワールドが動かなくなります）`,
            );
        }
        process.exit(1);
    }
    term.success('公開済みの mod の版は、どれも中身が変わっていません');
}
