/**
 * CLI ビルドツールのコア — mod.json を廃止し、package.json + Worker コード内の
 * `export const config` を元にマニフェスト・lock.json を自動生成する。
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import {
    type DataFieldsLike,
    detectCapabilities,
    frameMediaTargets,
    MOD_EXPORTS_GLOBAL_NAME,
    type ModLockComponent,
    type ModLockEntry,
} from '@ubichill/shared';
import * as esbuild from 'esbuild';

/** base からの相対パスを OS に依らず `/` 区切りで返す（manifest/lock のキーは POSIX 形式で固定する） */
function toPosixRelative(base: string, path: string): string {
    return relative(base, path).split(sep).join('/');
}

/** Worker ファイルからコンポーネント名を導出 (ex: `canvas.worker.ts` → `canvas`, `sub/dir/canvas.worker.ts` → `sub-dir-canvas`) */
function componentNameFromFile(file: string): string {
    return file
        .replace(/\.worker\.[jt]sx?$/, '')
        .split(/[\\/]/)
        .join('-');
}

/** src/ 以下の *.worker.ts(x) を再帰的にスキャン */
function findWorkerFiles(srcDir: string): string[] {
    const results: string[] = [];
    function walk(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(p);
            } else if (entry.isFile() && /\.worker\.[jt]sx?$/.test(entry.name)) {
                results.push(p);
            }
        }
    }
    walk(srcDir);
    return results;
}

/** `export const config =` のあるファイルのみを Worker として扱う */
function isWorkerFile(path: string): boolean {
    const code = readFileSync(path, 'utf-8');
    return /export\s+const\s+config\s*(?::\s*[^=]+)?\s*=/.test(code);
}

// ============================================================
// config リテラルの安全な抽出
// ============================================================
//
// `export const config = { ... }` の値を取得するために、かつては
// `new Function("return " + literal)()` で実際に JS として実行していたが、
// Worker ソース（＝信頼できない mod 開発者のコードもあり得る）をビルド
// プロセス上で任意実行することになり、ゼロトラスト方針に反する。
// 代わりに JSON 互換のリテラル（object/array/string/number/boolean/null）
// のみを受け付ける再帰下降パーサーで抽出する。関数呼び出しや識別子参照は
// 構文エラーとして拒否され、実行されることはない。

type ParsePos = { i: number };

function skipTrivia(src: string, pos: ParsePos): void {
    for (;;) {
        const c = src[pos.i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
            pos.i++;
            continue;
        }
        if (c === '/' && src[pos.i + 1] === '/') {
            while (pos.i < src.length && src[pos.i] !== '\n') pos.i++;
            continue;
        }
        if (c === '/' && src[pos.i + 1] === '*') {
            pos.i += 2;
            while (pos.i < src.length && !(src[pos.i] === '*' && src[pos.i + 1] === '/')) pos.i++;
            pos.i += 2;
            continue;
        }
        break;
    }
}

function isIdentChar(c: string | undefined): boolean {
    return !!c && /[A-Za-z0-9_$]/.test(c);
}

function parseKeyword(src: string, pos: ParsePos, word: string): boolean {
    if (!src.startsWith(word, pos.i) || isIdentChar(src[pos.i + word.length])) return false;
    pos.i += word.length;
    return true;
}

function parseString(src: string, pos: ParsePos): string {
    const quote = src[pos.i];
    pos.i++;
    let out = '';
    while (pos.i < src.length && src[pos.i] !== quote) {
        if (src[pos.i] === '\\') {
            const esc = src[pos.i + 1];
            const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', "'": "'", '\\': '\\', '`': '`' };
            out += map[esc] ?? esc ?? '';
            pos.i += 2;
        } else {
            out += src[pos.i];
            pos.i++;
        }
    }
    if (src[pos.i] !== quote) throw new Error(`config: 閉じられていない文字列 (pos ${pos.i})`);
    pos.i++;
    return out;
}

function parseNumber(src: string, pos: ParsePos): number {
    const m = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(src.slice(pos.i));
    if (!m) throw new Error(`config: 不正な数値リテラル (pos ${pos.i})`);
    pos.i += m[0].length;
    return Number(m[0]);
}

function parseKey(src: string, pos: ParsePos): string {
    const c = src[pos.i];
    if (c === '"' || c === "'") return parseString(src, pos);
    const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(pos.i));
    if (!m) throw new Error(`config: 不正なプロパティ名 (pos ${pos.i})`);
    pos.i += m[0].length;
    return m[0];
}

function parseArray(src: string, pos: ParsePos): unknown[] {
    pos.i++; // '['
    const arr: unknown[] = [];
    skipTrivia(src, pos);
    if (src[pos.i] === ']') {
        pos.i++;
        return arr;
    }
    for (;;) {
        arr.push(parseValue(src, pos));
        skipTrivia(src, pos);
        if (src[pos.i] === ',') {
            pos.i++;
            skipTrivia(src, pos);
            if (src[pos.i] === ']') {
                pos.i++;
                break;
            }
            continue;
        }
        if (src[pos.i] === ']') {
            pos.i++;
            break;
        }
        throw new Error(`config: ',' または ']' が必要 (pos ${pos.i})`);
    }
    return arr;
}

function parseObject(src: string, pos: ParsePos): Record<string, unknown> {
    pos.i++; // '{'
    const obj: Record<string, unknown> = {};
    skipTrivia(src, pos);
    if (src[pos.i] === '}') {
        pos.i++;
        return obj;
    }
    for (;;) {
        skipTrivia(src, pos);
        const key = parseKey(src, pos);
        skipTrivia(src, pos);
        if (src[pos.i] !== ':') throw new Error(`config: ':' が必要 (pos ${pos.i})`);
        pos.i++;
        obj[key] = parseValue(src, pos);
        skipTrivia(src, pos);
        if (src[pos.i] === ',') {
            pos.i++;
            skipTrivia(src, pos);
            if (src[pos.i] === '}') {
                pos.i++;
                break;
            }
            continue;
        }
        if (src[pos.i] === '}') {
            pos.i++;
            break;
        }
        throw new Error(`config: ',' または '}' が必要 (pos ${pos.i})`);
    }
    return obj;
}

function parseValue(src: string, pos: ParsePos): unknown {
    skipTrivia(src, pos);
    const c = src[pos.i];
    if (c === '{') return parseObject(src, pos);
    if (c === '[') return parseArray(src, pos);
    if (c === '"' || c === "'") return parseString(src, pos);
    if (parseKeyword(src, pos, 'true')) return true;
    if (parseKeyword(src, pos, 'false')) return false;
    if (parseKeyword(src, pos, 'null')) return null;
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber(src, pos);
    throw new Error(`config: 未対応のトークン (pos ${pos.i}): ${JSON.stringify(src.slice(pos.i, pos.i + 20))}`);
}

/**
 * `mediaTargets`（自分の枠に描く動画）と、`core:media` を指す参照フィールドで同じ名前を使っているもの。
 * どちらも `Ubi.media.*` の targetId になるので、同じ名前だと 1 つの targetId に `<video>` が 2 つできる
 * （Host は参照の方を使う）。ビルドで止めて名前を分けてもらう。
 */
export function mediaTargetCollisions(config: Record<string, unknown> | null): string[] {
    const mediaTargets = Array.isArray(config?.mediaTargets)
        ? config.mediaTargets.filter((t): t is string => typeof t === 'string')
        : [];
    const dataFields =
        typeof config?.dataFields === 'object' && config.dataFields !== null
            ? (config.dataFields as DataFieldsLike)
            : undefined;
    const framed = new Set(frameMediaTargets(mediaTargets, dataFields));
    return mediaTargets.filter((name) => !framed.has(name));
}

/** `export const config =` の内容を JSON 互換リテラルとしてのみ抽出する（コード実行なし）。 */
function extractConfigFromCode(code: string): Record<string, unknown> | null {
    const startMatch = code.match(/export\s+const\s+config\s*(?::\s*[^=]+)?\s*=\s*/);
    if (startMatch?.index === undefined) return null;
    const startIdx = startMatch.index + startMatch[0].length;
    const rest = code.slice(startIdx);
    try {
        const pos: ParsePos = { i: 0 };
        const value = parseValue(rest, pos);
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
        return value as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * `config.dataOnly: true` の Component の manifest エントリ（純粋）。data-only でなければ null。
 *
 * data-only は Worker を持たず、mod が spawn して持ち回るだけのデータ（例: pen:stroke）。
 * manifest に宣言しておくと、Host はその型の Entity を「この mod のデータ」と認識して Worker を探さない。
 * コードを実行しないので workerUrl・capabilities は持たせず、lock の components にも載せない
 * （manifest 自体は lock の manifestIntegrity で固定されるので、宣言は改竄できない）。
 */
export function dataOnlyManifestEntry(config: Record<string, unknown> | null): Record<string, unknown> | null {
    if (config?.dataOnly !== true) return null;
    const { capabilities: _caps, workerUrl: _url, ...rest } = config;
    return rest;
}

/**
 * ソースから data-only の宣言を読む（純粋）。data-only でなければ null。
 *
 * config はコードを実行せずリテラルとしてだけ読むので、テンプレート文字列・定数・スプレッドを使うと読めない。
 * そのとき `dataOnly` を書いていても黙って Worker として bundle すると、spawn した Entity ごとに Worker が
 * 起動してしまうので、ビルドを止める。
 */
export function dataOnlyEntryFromSource(componentType: string, source: string): Record<string, unknown> | null {
    const config = extractConfigFromCode(source);
    if (config === null && /\bdataOnly\b/.test(source)) {
        throw new Error(
            `[${componentType}] dataOnly を書いていますが、export const config をリテラルとして読めません。` +
                'テンプレート文字列・定数・スプレッド・式を使わず、JSON と同じ書き方（文字列・数・真偽値・配列・オブジェクト）で書いてください',
        );
    }
    return dataOnlyManifestEntry(config);
}

function cleanOldBundles(dir: string, keepFilename: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name !== keepFilename && entry.name.startsWith('index.')) {
            const p = join(dir, entry.name);
            try {
                unlinkSync(p);
            } catch {
                // ignore
            }
        }
    }
}

function listFilesRecursive(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listFilesRecursive(abs));
        } else {
            out.push(abs);
        }
    }
    return out;
}

function sriOf(content: string | Uint8Array): string {
    const hash = createHash('sha256').update(content).digest('base64');
    return `sha256-${hash}`;
}

/** versioned ディレクトリ直下で build が書き出すファイル。アセットが同名だと上書きし合う。 */
const RESERVED_ASSET_PATHS = new Set(['manifest.json', 'lock.json', 'lock.sig.json', 'mod.json', 'index.json']);

/** アセットの一覧（POSIX 相対パス・ソート済み）と、各ファイルの SRI。 */
export function collectAssets(
    assetsDir: string,
    componentDirs: ReadonlySet<string>,
): { files: string[]; integrity: Record<string, string> } {
    if (!existsSync(assetsDir)) return { files: [], integrity: {} };
    const files = listFilesRecursive(assetsDir)
        .map((p) => toPosixRelative(assetsDir, p))
        .sort();
    const clashes = files.filter((p) => RESERVED_ASSET_PATHS.has(p) || componentDirs.has(p.split('/')[0] ?? ''));
    if (clashes.length > 0) {
        throw new Error(
            `assets/ に build の出力と同じ名前があります: ${clashes.join(', ')}（manifest.json・lock.json・Component 名のディレクトリは使えません）`,
        );
    }
    const integrity = Object.fromEntries(files.map((p) => [p, sriOf(readFileSync(join(assetsDir, p)))]));
    return { files, integrity };
}

/**
 * mod から見た SDK の名前。npm で公開しているパッケージ名で、mod のソース・tsconfig の
 * `jsxImportSource` もこれに揃える。
 *
 * ここをワークスペース名 (`@ubichill/sdk`) にしてはいけない。その名前はこのリポジトリの外には
 * 存在しないので、公開 CLI を使う mod 作者の JSX ビルドが解決できずに失敗する。
 */
const PUBLIC_PACKAGE_NAME = 'ubichill';

/** Worker を 1 ファイルにバンドルする。読んだファイル（esbuild の metafile。node_modules も含む）も返す。 */
async function bundleWorker(
    entryPath: string,
    modDir: string,
    tsconfig?: string,
): Promise<{ code: string; inputs: string[] }> {
    const result = await esbuild.build({
        entryPoints: [entryPath],
        absWorkingDir: modDir,
        bundle: true,
        format: 'iife',
        globalName: MOD_EXPORTS_GLOBAL_NAME,
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource: PUBLIC_PACKAGE_NAME,
        write: false,
        minify: true,
        metafile: true,
        tsconfig,
    });
    const out = result.outputFiles?.[0];
    if (!out) throw new Error(`esbuild failed for ${entryPath}`);
    return { code: out.text, inputs: Object.keys(result.metafile.inputs).map((input) => resolve(modDir, input)) };
}

// ============================================================
// ビルド
// ============================================================

export interface BuildOptions {
    /** mod のソースディレクトリ（既定: process.cwd()）。 */
    modDir?: string;
    /** フロントエンド配信用の出力先（既定: distDir と同じ）。 */
    publicDir?: string;
    /** CDN 配布用の出力先（既定: `<modDir>/dist`）。 */
    distDir?: string;
    /**
     * 公開済み registry（`index.json` を配信している URL）。バージョン履歴を継続するために
     * ビルド前に取得する。省略時は `package.json` の `homepage` を使う（CI のクリーン
     * チェックアウトでもバージョン履歴が失われないようにする、mod 開発者側の追加設定は不要）。
     */
    registryUrl?: string;
    /** テスト注入用の fetch 実装。既定はグローバル `fetch`。 */
    fetchImpl?: typeof fetch;
}

function resolveDirs(options: BuildOptions): { distDir: string; publicDir: string } {
    const distDir = options.distDir ?? join(options.modDir ?? process.cwd(), 'dist');
    const publicDir = options.publicDir ?? distDir;
    return { distDir, publicDir };
}

function readPackageJson(modDir: string): { id: string; name: string; version: string; homepage?: string } {
    const path = join(modDir, 'package.json');
    if (!existsSync(path)) {
        throw new Error(`package.json not found in ${modDir}`);
    }
    const pkg = JSON.parse(readFileSync(path, 'utf-8'));
    const id = pkg.ubichill?.id ?? pkg.name?.replace(/^@ubichill\/(?:mod-)?/, '') ?? basename(modDir);
    const name = pkg.ubichill?.name ?? pkg.description ?? id;
    const version = pkg.version;
    if (!version) {
        throw new Error(`package.json に version が必要です: ${path}`);
    }
    return { id, name, version, homepage: typeof pkg.homepage === 'string' ? pkg.homepage : undefined };
}

/** `index.json` エントリが持つバージョン履歴の1件。 */
export interface ModVersionSummary {
    version: string;
    components: string[];
}

/** `index.json`（レジストリ一覧）の1エントリ。World Editor の「レジストリ URL を追加」機能が読む形。 */
export interface ModIndexEntry {
    id: string;
    name: string;
    version: string;
    components: string[];
    /** 過去にビルドした全バージョンの履歴（新しい順）。World Editor のバージョン選択に使う。 */
    versions: ModVersionSummary[];
}

/** semver (x.y.z) の降順比較。 */
function compareSemVerDesc(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pb[i] - pa[i];
    }
    return 0;
}

/**
 * 既存の `index.json`（あれば）から対象 mod のバージョン履歴を読み出す。
 * `versions` フィールドが無い旧形式のファイルは、その1件を履歴の起点として扱う
 * （初回アップグレード時に直前のバージョンを失わないため）。
 */
function readExistingVersions(indexPath: string, id: string): ModVersionSummary[] {
    if (!existsSync(indexPath)) return [];
    try {
        const entries = JSON.parse(readFileSync(indexPath, 'utf-8')) as ModIndexEntry[];
        const existing = entries.find((e) => e.id === id);
        if (!existing) return [];
        if (existing.versions) return existing.versions;
        return existing.version ? [{ version: existing.version, components: existing.components }] : [];
    } catch {
        return [];
    }
}

/** 既存のバージョン履歴に今回の版をマージする（同一版は上書き、新しい順にソート）。 */
function mergeVersionHistory(existing: ModVersionSummary[], next: ModVersionSummary): ModVersionSummary[] {
    const withoutNext = existing.filter((v) => v.version !== next.version);
    return [...withoutNext, next].sort((a, b) => compareSemVerDesc(a.version, b.version));
}

/** 2つのバージョン履歴配列を統合する（同一版は後者を優先、新しい順にソート）。 */
function mergeVersionArrays(a: ModVersionSummary[], b: ModVersionSummary[]): ModVersionSummary[] {
    const byVersion = new Map<string, ModVersionSummary>();
    for (const v of a) byVersion.set(v.version, v);
    for (const v of b) byVersion.set(v.version, v);
    return [...byVersion.values()].sort((x, y) => compareSemVerDesc(x.version, y.version));
}

/**
 * リモートの `index.json`（GitHub Pages 等、外部 mod リポジトリが公開している registry）から
 * 過去のバージョン履歴を取得する純粋な補助関数。
 *
 * CI のクリーンチェックアウトではローカルに前回ビルドの `dist/index.json` が残らないため、
 * `readExistingVersions` だけでは履歴が毎回失われ、World Editor のバージョン選択が
 * 「latest」しか出せなくなる。`package.json` の `homepage`（または `--registry-url=`）を
 * 起点にリモートの履歴を取得し、mod 開発者が意識しなくても複数バージョンが積み上がるようにする。
 *
 * ネットワーク障害・未公開（404）・不正な JSON はすべて空配列として無視する
 * （ビルド自体を失敗させない）。
 */
async function fetchRemoteVersions(
    registryUrl: string,
    id: string,
    fetchImpl: typeof fetch = fetch,
): Promise<ModVersionSummary[]> {
    const base = registryUrl.replace(/\/$/, '');
    try {
        const res = await fetchImpl(`${base}/index.json`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) return [];
        const entries = (await res.json()) as ModIndexEntry[];
        const existing = entries.find((e) => e.id === id);
        if (!existing) return [];
        if (existing.versions) return existing.versions;
        return existing.version ? [{ version: existing.version, components: existing.components }] : [];
    } catch {
        return [];
    }
}

/** lock.json を書く。内容が変わったら、以前の内容に付けた署名（lock.sig.json）は無効なので消す。 */
function writeLock(versionDir: string, lock: Uint8Array): void {
    const lockPath = join(versionDir, 'lock.json');
    const sigPath = join(versionDir, 'lock.sig.json');
    const unchanged = existsSync(lockPath) && Buffer.from(readFileSync(lockPath)).equals(Buffer.from(lock));
    if (!unchanged && existsSync(sigPath)) unlinkSync(sigPath);
    writeFileSync(lockPath, lock);
}

/**
 * 1 つの mod の 1 回のビルドの結果。書き込みはしない（`writeArtifacts` が dist / public に置き、
 * dev サーバーはメモリから配る）。
 */
export interface ModArtifacts {
    id: string;
    name: string;
    version: string;
    /** Worker を持つ Component 型（`<id>:<name>`）。data-only は置くものではないので含めない（manifest にだけ載る）。 */
    components: string[];
    /** `v<version>/` の下に置くファイル（POSIX 相対パス → 中身）: Worker・manifest.json・lock.json・asset。 */
    files: ReadonlyMap<string, Uint8Array>;
    lockEntry: ModLockEntry;
    /** このビルドが読んだファイルの絶対パス（Worker・import した共有コード・package.json・tsconfig・asset）。監視に使う。 */
    inputs: ReadonlySet<string>;
}

/**
 * mod をビルドして成果物をメモリに作る。毎回 package.json を読み直し、Worker と asset を探し直す
 * （Worker の追加・削除・版の変更を差分で追う仕組みは持たない。1 回のビルドは十分に速い）。
 */
export async function compileMod(modDir: string): Promise<ModArtifacts> {
    const { id, name, version } = readPackageJson(modDir);
    const rootTsconfig = join(modDir, 'tsconfig.json');
    const tsconfig = existsSync(rootTsconfig) ? rootTsconfig : undefined;
    const inputs = new Set<string>([join(modDir, 'package.json'), ...(tsconfig ? [tsconfig] : [])]);
    const files = new Map<string, Uint8Array>();
    const encoder = new TextEncoder();

    const srcDir = join(modDir, 'src');
    const versionedComponents: Record<string, unknown> = {};
    const lockComponents: Record<string, ModLockComponent> = {};

    for (const workerPath of findWorkerFiles(srcDir)) {
        const relPath = toPosixRelative(srcDir, workerPath);
        const componentName = componentNameFromFile(relPath);
        const componentType = `${id}:${componentName}`;
        inputs.add(workerPath);

        // `export const config` を持つファイルのみを処理する
        if (!isWorkerFile(workerPath)) {
            console.log(`📋 [${componentType}] skipped (no export const config)`);
            continue;
        }

        const dataOnly = dataOnlyEntryFromSource(componentType, readFileSync(workerPath, 'utf-8'));
        if (dataOnly) {
            versionedComponents[componentType] = dataOnly;
            console.log(`📦 [${componentType}] data-only（Worker なし）`);
            continue;
        }

        const bundled = await bundleWorker(workerPath, modDir, tsconfig);
        for (const input of bundled.inputs) inputs.add(input);
        const code = bundled.code;

        // コンテンツハッシュ（8文字）でキャッシュバスティング
        const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
        const outFilename = `index.${hash}.js`;
        files.set(`${componentName}/${outFilename}`, encoder.encode(code));

        // config からメタデータを取得
        const srcCode = readFileSync(workerPath, 'utf-8');
        const config = extractConfigFromCode(srcCode);
        const collisions = mediaTargetCollisions(config);
        if (collisions.length > 0) {
            throw new Error(
                `[${componentType}] mediaTargets の ${collisions.join(', ')} は core:media を指す参照フィールドと同じ名前です。どちらも Ubi.media の targetId になるので、名前を分けてください`,
            );
        }

        // capability をコードから自動検出。
        // `export default`（ui:render の自動マウント対象）は globalName バンドル後には
        // 文字列として残らないため、生ソース（srcCode）も検出対象に含める。
        const detected = detectCapabilities(`${code}\n${srcCode}`);
        const declaredCapabilities = Array.isArray(config?.capabilities) ? (config.capabilities as string[]) : [];

        // 宣言された capability と検出結果を突き合わせて警告
        const undetected = declaredCapabilities.filter((cap) => !detected.includes(cap));
        const excess = detected.filter((cap) => !declaredCapabilities.includes(cap));
        if (undetected.length > 0) {
            console.warn(
                `⚠️  [${componentType}] 検出されない宣言: ${undetected.join(', ')} (静的解析では検出されず。動的アクセス等の可能性)`,
            );
        }
        if (excess.length > 0) {
            console.warn(`⚠️  [${componentType}] 過剰検出: ${excess.join(', ')} (config.capabilities に宣言なし)`);
        }

        // マニフェスト用: 検出結果と宣言の和集合（セキュリティ的に過剰許可より安全）
        const capabilities = [...new Set([...detected, ...declaredCapabilities])].sort();

        const workerUrl = `./${componentName}/${outFilename}`;
        const { capabilities: _ignoredCaps, workerUrl: _ignoredUrl, ...restConfig } = config ?? {};
        versionedComponents[componentType] = { ...restConfig, capabilities, workerUrl };
        // lock: worker バイト列のフル sha256 + capability 天井を固定する。
        lockComponents[componentType] = { workerUrl, integrity: sriOf(code), capabilities };

        console.log(
            `✅ [${componentType}] ${componentName}/${outFilename} [caps: ${capabilities.join(', ') || 'none'}]`,
        );
    }

    // assets/ をバージョン固定パスに置く（Worker は Ubi.asset / Ubi.modBase で参照）。
    // 各ファイルの SRI を manifest に載せる。manifest は lock で固定されるので、アセットの中身も固定される。
    const assetsSrcDir = join(modDir, 'assets');
    const componentDirs = new Set(Object.keys(lockComponents).map((type) => type.slice(id.length + 1).split('/')[0]));
    const assets = collectAssets(assetsSrcDir, componentDirs);
    for (const asset of assets.files) {
        const path = join(assetsSrcDir, asset);
        inputs.add(path);
        files.set(asset, readFileSync(path));
    }
    if (assets.files.length > 0) console.log(`✅ [${id}] assets → v${version}/ (${assets.files.length} files)`);

    const versionedManifest = JSON.stringify(
        {
            id,
            name,
            version,
            components: versionedComponents,
            assets: assets.files,
            // アセットの無い mod の manifest は従来とバイト単位で同じにする（既存の lock を壊さない）。
            ...(assets.files.length > 0 ? { assetIntegrity: assets.integrity } : {}),
        },
        null,
        2,
    );
    files.set('manifest.json', encoder.encode(versionedManifest));

    // ── lock.json（ModLockEntry 形状）─────────────────────────────
    const lockEntry: ModLockEntry = {
        id,
        version,
        manifestIntegrity: sriOf(versionedManifest),
        components: lockComponents,
    };
    files.set('lock.json', encoder.encode(JSON.stringify(lockEntry, null, 2)));
    console.log(`🔒 [${id}] lock.json (${Object.keys(lockComponents).length} components)`);

    return { id, name, version, components: Object.keys(lockComponents), files, lockEntry, inputs };
}

export interface WriteArtifactsOptions {
    /** CDN 配布用の出力先（`<modDir>/dist` 相当）。 */
    distDir: string;
    /** フロントエンド配信用の出力先（既定: distDir と同じ）。 */
    publicDir?: string;
    /** 公開済み registry（`index.json` を配信している URL）。バージョン履歴を継続するために取得する。 */
    registryUrl?: string;
    /** テスト注入用の fetch 実装。既定はグローバル `fetch`。 */
    fetchImpl?: typeof fetch;
}

/**
 * 成果物を dist / public に書く。`mod.json`（最新の版へのポインタ）、`v<version>/` の中身、
 * `index.json`（この mod 単体のレジストリ。過去の版の履歴を持つ）。
 */
export async function writeArtifacts(artifacts: ModArtifacts, options: WriteArtifactsOptions): Promise<ModIndexEntry> {
    const { id, name, version, components, files } = artifacts;
    const distDir = options.distDir;
    const publicDir = options.publicDir ?? distDir;

    // ── ルート index（npm の "latest" pointer 相当） ──────────────────
    // バージョンへのポインタのみ。エンティティ詳細はバージョン付きマニフェストに分離。
    const rootIndex = JSON.stringify({ id, name, version }, null, 2);
    for (const dir of new Set([publicDir, distDir])) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'mod.json'), rootIndex, 'utf-8');
        const versionDir = join(dir, `v${version}`);
        mkdirSync(versionDir, { recursive: true });
        for (const [relPath, bytes] of files) {
            const target = join(versionDir, ...relPath.split('/'));
            mkdirSync(dirname(target), { recursive: true });
            if (relPath === 'lock.json') {
                writeLock(versionDir, bytes);
                continue;
            }
            writeFileSync(target, bytes);
            // Worker のバンドル名は内容の hash なので、前の内容のバンドルは消す
            if (/^[^/]+\/index\.[0-9a-f]{8}\.js$/.test(relPath)) cleanOldBundles(dirname(target), basename(target));
        }
    }

    // ── index.json（この mod 単体をレジストリとして公開する）────────────
    // World Editor の「レジストリ URL を追加」機能は index.json（一覧）を期待する。
    // 外部 mod は単体でも「1件だけのレジストリ」として同じ形で公開できるようにする。
    // トップレベルの id/name/version/components は常に「現行最新」（既存の外部消費者との
    // 後方互換のため）。versions は過去にビルドした全バージョンの履歴（新しい順）。
    //
    // ローカルの `dist/index.json`（直前ビルドの成果物）に加え、`registryUrl`（既定は
    // package.json の homepage）から公開済み index.json を取得して履歴を補う。CI の
    // クリーンチェックアウトではローカル履歴が毎回失われるため、これが無いと
    // 「latest」以外のバージョンが World Editor から選べなくなる。
    const localVersions = readExistingVersions(join(distDir, 'index.json'), id);
    const remoteVersions = options.registryUrl
        ? await fetchRemoteVersions(options.registryUrl, id, options.fetchImpl)
        : [];
    if (options.registryUrl && remoteVersions.length > 0) {
        console.log(
            `🌐 [${id}] registry からバージョン履歴を取得 (${options.registryUrl}): ${remoteVersions.length}件`,
        );
    }
    const existingVersions = mergeVersionArrays(localVersions, remoteVersions);
    const versions = mergeVersionHistory(existingVersions, { version, components });
    const indexEntry: ModIndexEntry = { id, name, version, components, versions };
    const indexJson = JSON.stringify([indexEntry], null, 2);
    writeFileSync(join(distDir, 'index.json'), indexJson, 'utf-8');
    writeFileSync(join(publicDir, 'index.json'), indexJson, 'utf-8');

    return indexEntry;
}

/** `ubichill build` の 1 mod ぶん: ビルドして dist / public に書く。 */
export async function buildMod(modDir: string, options: BuildOptions = {}): Promise<ModIndexEntry> {
    const { distDir, publicDir } = resolveDirs({ ...options, modDir });
    const registryUrl = options.registryUrl ?? readPackageJson(modDir).homepage;
    return writeArtifacts(await compileMod(modDir), { distDir, publicDir, registryUrl, fetchImpl: options.fetchImpl });
}

/**
 * 複数 mod を一括ビルド（モノレポ用）。`modsDir` 配下の各サブディレクトリを
 * 個別の mod として扱い、それぞれ `buildMod` する。
 */
async function runBatchBuild(modsDirArg: string, args: string[]): Promise<void> {
    const argValue = (flag: string): string | undefined => args.find((a) => a.startsWith(flag))?.slice(flag.length);

    // esbuild は呼び出しごとに絶対パスを要求するため、相対指定を早期に解決しておく。
    const modsDir = resolve(modsDirArg);
    const distDir = argValue('--dist-dir=') ?? join(process.cwd(), 'dist', 'mods');
    const publicDir = argValue('--public-mods-dir=') ?? distDir;

    const indexEntries: ModIndexEntry[] = [];
    for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const modDir = join(modsDir, entry.name);
        const pkgJsonPath = join(modDir, 'package.json');
        if (!existsSync(pkgJsonPath)) continue;

        const { id } = readPackageJson(modDir);
        const modDistDir = join(distDir, id);
        const modPublicDir = join(publicDir, id);

        console.log(`\n🔨 [${entry.name}] building...`);
        indexEntries.push(await buildMod(modDir, { distDir: modDistDir, publicDir: modPublicDir }));
    }

    // ── index.json（このモノレポが持つ全 mod のレジストリ一覧）───────────
    // World Editor の「使用する mod」一覧はこの index.json（バッチのルート）を読む。
    mkdirSync(distDir, { recursive: true });
    mkdirSync(publicDir, { recursive: true });
    const aggregateIndexJson = JSON.stringify(indexEntries, null, 2);
    writeFileSync(join(distDir, 'index.json'), aggregateIndexJson, 'utf-8');
    writeFileSync(join(publicDir, 'index.json'), aggregateIndexJson, 'utf-8');
    console.log(`\n📇 index.json (${indexEntries.length} mods)`);
}

/**
 * `ubichill build` のエントリポイント。
 *
 * 通常（外部 mod リポジトリ）は cwd 自体が 1 つの mod のルートであるとみなし、
 * `buildMod(cwd)` を実行する。`mods/` ディレクトリ（モノレポの複数 mod 構成）が
 * 存在する場合、または `--mods-dir=` が明示された場合のみ一括ビルドに切り替える。
 */
export async function runBuild(args: string[]): Promise<void> {
    const argValue = (flag: string): string | undefined => args.find((a) => a.startsWith(flag))?.slice(flag.length);

    const modsDirArg = argValue('--mods-dir=');
    const modsDir = modsDirArg ?? 'mods';
    if (modsDirArg !== undefined || existsSync(modsDir)) {
        await runBatchBuild(modsDir, args);
        return;
    }

    // 単一 mod ビルド（外部リポジトリでの標準フロー）: cwd をそのまま modDir とする。
    const modDir = process.cwd();
    if (!existsSync(join(modDir, 'package.json'))) {
        throw new Error(
            'package.json が見つかりません。mod のルートディレクトリで実行するか、' +
                '複数 mod をまとめてビルドする場合は --mods-dir=<dir> を指定してください。',
        );
    }
    const distDir = argValue('--dist-dir=') ?? join(modDir, 'dist');
    const publicDir = argValue('--public-mods-dir=') ?? distDir;
    const registryUrl = argValue('--registry-url=');

    console.log(`🔨 [${basename(modDir)}] building...`);
    await buildMod(modDir, { distDir, publicDir, registryUrl });
}
