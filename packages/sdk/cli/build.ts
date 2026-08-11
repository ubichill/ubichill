/**
 * CLI ビルドツールのコア — mod.json を廃止し、package.json + Worker コード内の
 * `export const config` を元にマニフェスト・lock.json を自動生成する。
 */
import { detectCapabilities, MOD_EXPORTS_GLOBAL_NAME } from '@ubichill/shared';
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

/** Worker ファイルからコンポーネント名を導出 (ex: `canvas.worker.ts` → `canvas`, `sub/dir/canvas.worker.ts` → `sub-dir-canvas`) */
function componentNameFromFile(file: string): string {
    return file.replace(/\.worker\.[jt]sx?$/, '').split(/[\\/]/).join('-');
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

function copyDirRecursive(src: string, dest: string): void {
    mkdirSync(dest, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            writeFileSync(destPath, readFileSync(srcPath));
        }
    }
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

function sriOf(text: string): string {
    const hash = createHash('sha256').update(text).digest('base64');
    return `sha256-${hash}`;
}

async function bundleWorker(entryPath: string, tsconfig?: string): Promise<string> {
    const result = await esbuild.build({
        entryPoints: [entryPath],
        bundle: true,
        format: 'iife',
        globalName: MOD_EXPORTS_GLOBAL_NAME,
        platform: 'browser',
        target: 'es2022',
        jsx: 'automatic',
        jsxImportSource: '@ubichill/sdk',
        write: false,
        minify: true,
        tsconfig,
    });
    const out = result.outputFiles?.[0];
    if (!out) throw new Error(`esbuild failed for ${entryPath}`);
    return out.text;
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
}

function resolveDirs(options: BuildOptions): { distDir: string; publicDir: string } {
    const distDir = options.distDir ?? join(options.modDir ?? process.cwd(), 'dist');
    const publicDir = options.publicDir ?? distDir;
    return { distDir, publicDir };
}

function readPackageJson(modDir: string): { id: string; name: string; version: string } {
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
    return { id, name, version };
}

/** `index.json`（レジストリ一覧）の1エントリ。World Editor の「レジストリ URL を追加」機能が読む形。 */
export interface ModIndexEntry {
    id: string;
    name: string;
    version: string;
    components: string[];
}

/** @param modDir mod のルートディレクトリへの絶対パス */
export async function buildMod(modDir: string, options: BuildOptions = {}): Promise<ModIndexEntry> {
    const { id, name, version } = readPackageJson(modDir);
    const { distDir, publicDir } = resolveDirs({ ...options, modDir });

    // tsconfig 検索
    const rootTsconfig = join(modDir, 'tsconfig.json');
    const tsconfig = existsSync(rootTsconfig) ? rootTsconfig : undefined;

    // ── ルート index（npm の "latest" pointer 相当） ──────────────────
    // バージョンへのポインタのみ。エンティティ詳細はバージョン付きマニフェストに分離。
    const rootIndex = JSON.stringify({ id, name, version }, null, 2);
    mkdirSync(publicDir, { recursive: true });
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(publicDir, 'mod.json'), rootIndex, 'utf-8');
    writeFileSync(join(distDir, 'mod.json'), rootIndex, 'utf-8');

    const publicVersionDir = join(publicDir, `v${version}`);
    const distVersionDir = join(distDir, `v${version}`);
    mkdirSync(distVersionDir, { recursive: true });
    mkdirSync(publicVersionDir, { recursive: true });

    // ── Worker 自動探索 ───────────────────────────────────────
    const srcDir = join(modDir, 'src');
    const workerFiles = findWorkerFiles(srcDir);

    const versionedComponents: Record<string, unknown> = {};
    const lockComponents: Record<string, unknown> = {};

    for (const workerPath of workerFiles) {
        const relPath = workerPath.replace(srcDir + '/', '');
        const componentName = componentNameFromFile(relPath);
        const componentType = `${id}:${componentName}`;

        // `export const config` を持つファイルのみを処理する
        if (!isWorkerFile(workerPath)) {
            console.log(`📋 [${componentType}] skipped (no export const config)`);
            continue;
        }

        const code = await bundleWorker(workerPath, tsconfig);

        // コンテンツハッシュ（8文字）でキャッシュバスティング
        const hash = createHash('sha256').update(code).digest('hex').slice(0, 8);
        const outFilename = `index.${hash}.js`;

        // dist: バージョン固定
        const distComponentDir = join(distVersionDir, componentName);
        mkdirSync(distComponentDir, { recursive: true });
        cleanOldBundles(distComponentDir, outFilename);
        writeFileSync(join(distComponentDir, outFilename), code, 'utf-8');

        // public: バージョン固定パス（CDN キャッシュバスティング用）
        const publicComponentDir = join(publicVersionDir, componentName);
        mkdirSync(publicComponentDir, { recursive: true });
        cleanOldBundles(publicComponentDir, outFilename);
        writeFileSync(join(publicComponentDir, outFilename), code, 'utf-8');

        // config からメタデータを取得
        const srcCode = readFileSync(workerPath, 'utf-8');
        const config = extractConfigFromCode(srcCode);

        // capability をコードから自動検出。
        // `export default`（ui:render の自動マウント対象）は globalName バンドル後には
        // 文字列として残らないため、生ソース（srcCode）も検出対象に含める。
        const detected = detectCapabilities(`${code}\n${srcCode}`);
        const declaredCapabilities = Array.isArray(config?.capabilities)
            ? (config.capabilities as string[])
            : [];

        // 宣言された capability と検出結果を突き合わせて警告
        const undetected = declaredCapabilities.filter((cap) => !detected.includes(cap));
        const excess = detected.filter((cap) => !declaredCapabilities.includes(cap));
        if (undetected.length > 0) {
            console.warn(
                `⚠️  [${componentType}] 検出されない宣言: ${undetected.join(', ')} (静的解析では検出されず。動的アクセス等の可能性)`,
            );
        }
        if (excess.length > 0) {
            console.warn(
                `⚠️  [${componentType}] 過剰検出: ${excess.join(', ')} (config.capabilities に宣言なし)`,
            );
        }

        // マニフェスト用: 検出結果と宣言の和集合（セキュリティ的に過剰許可より安全）
        const capabilitySet = new Set<string>();
        for (const cap of detected) capabilitySet.add(cap);
        for (const cap of declaredCapabilities) capabilitySet.add(cap);
        const capabilities = Array.from(capabilitySet).sort();

        const workerUrl = `./${componentName}/${outFilename}`;
        const { capabilities: _ignoredCaps, workerUrl: _ignoredUrl, ...restConfig } = config ?? {};
        versionedComponents[componentType] = {
            ...restConfig,
            capabilities,
            workerUrl,
        };

        // lock: worker バイト列のフル sha256 + capability 天井を固定する。
        lockComponents[componentType] = {
            workerUrl,
            integrity: sriOf(code),
            capabilities,
        };

        console.log(
            `✅ [${componentType}] ${componentName}/${outFilename}` +
                ` [caps: ${capabilities.join(', ') || 'none'}]`,
        );
    }

    // assets/ をバージョン固定パスにコピー（Worker は Ubi.modBase で参照）
    const assetsSrcDir = join(modDir, 'assets');
    let assetFiles: string[] = [];
    if (existsSync(assetsSrcDir)) {
        copyDirRecursive(assetsSrcDir, publicVersionDir);
        copyDirRecursive(assetsSrcDir, distVersionDir);
        assetFiles = listFilesRecursive(assetsSrcDir).map((p) => p.replace(assetsSrcDir + '/', ''));
        console.log(`✅ [${id}] assets → v${version}/ (${assetFiles.length} files)`);
    }

    const versionedManifest = JSON.stringify(
        {
            id,
            name,
            version,
            components: versionedComponents,
            assets: assetFiles,
        },
        null,
        2,
    );
    writeFileSync(join(distVersionDir, 'manifest.json'), versionedManifest, 'utf-8');
    writeFileSync(join(publicVersionDir, 'manifest.json'), versionedManifest, 'utf-8');

    // ── lock.json（ModLockEntry 形状）─────────────────────────────
    const lock = JSON.stringify(
        {
            id,
            version,
            manifestIntegrity: sriOf(versionedManifest),
            components: lockComponents,
        },
        null,
        2,
    );
    writeFileSync(join(distVersionDir, 'lock.json'), lock, 'utf-8');
    writeFileSync(join(publicVersionDir, 'lock.json'), lock, 'utf-8');
    console.log(`🔒 [${id}] lock.json (${Object.keys(lockComponents).length} components)`);

    // ── index.json（この mod 単体をレジストリとして公開する）────────────
    // World Editor の「レジストリ URL を追加」機能は index.json（一覧）を期待する。
    // 外部 mod は単体でも「1件だけのレジストリ」として同じ形で公開できるようにする。
    const indexEntry: ModIndexEntry = { id, name, version, components: Object.keys(versionedComponents) };
    const indexJson = JSON.stringify([indexEntry], null, 2);
    writeFileSync(join(distDir, 'index.json'), indexJson, 'utf-8');
    writeFileSync(join(publicDir, 'index.json'), indexJson, 'utf-8');

    return indexEntry;
}

/**
 * 複数 mod を一括ビルド（モノレポ用）。`modsDir` 配下の各サブディレクトリを
 * 個別の mod として扱い、それぞれ `buildMod` する。
 */
async function runBatchBuild(modsDirArg: string, args: string[]): Promise<void> {
    const argValue = (flag: string): string | undefined =>
        args.find((a) => a.startsWith(flag))?.slice(flag.length);

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
    const argValue = (flag: string): string | undefined =>
        args.find((a) => a.startsWith(flag))?.slice(flag.length);

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

    console.log(`🔨 [${basename(modDir)}] building...`);
    await buildMod(modDir, { distDir, publicDir });
}
