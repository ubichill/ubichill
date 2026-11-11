import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
    buildWorldLock,
    createDependencyAwareLockEntryGetter,
    createHttpLockEntryGetter,
    packageJson,
    resolvePackage,
} from '@ubichill/loader';
import { writeWorldFiles } from '@ubichill/loader/world-files';
import {
    assertCapabilityUpdate,
    assertPackageReplacement,
    lockedMods,
    ModLockSchema,
    PackageIdSchema,
    parsePackageRef,
    requiredLockModIds,
    WorldDefinitionSchema,
} from '@ubichill/shared';
import type { Logger } from '@ubichill/terminal';
import yaml from 'yaml';

export function targetWorld(args: string[]): string {
    const explicit =
        args.find((a) => a.startsWith('--world='))?.slice(8) ??
        (args.includes('--world') ? args[args.indexOf('--world') + 1] : undefined);
    if (explicit) return resolve(explicit);
    if (existsSync('world.yaml')) return resolve('world.yaml');
    const candidates = ['.', 'worlds'].flatMap((dir) =>
        existsSync(dir)
            ? readdirSync(dir)
                  .filter((f) => /\.ya?ml$/.test(f))
                  .map((f) => join(dir, f))
            : [],
    );
    if (candidates.length === 1) return resolve(candidates[0]);
    throw new Error('対象のワールドを --world=world.yaml で指定してください');
}

export async function installPackage(args: string[], log: Logger): Promise<void> {
    const ref = parsePackageRef(args[0]);
    if (!ref) throw new Error('作者参照は @handle@server/mod または作品ページ URL で指定してください');
    const path = targetWorld(args);
    const raw = readFileSync(path, 'utf8');
    const doc = yaml.parseDocument(raw);
    const world = WorldDefinitionSchema.parse(doc.toJS());
    const lockPath = path.replace(/\.ya?ml$/i, '.lock.json');
    const oldText = existsSync(lockPath) ? readFileSync(lockPath, 'utf8') : null;
    const old = oldText ? ModLockSchema.parse(JSON.parse(oldText)) : undefined;
    const found = await resolvePackage(ref);
    assertPackageReplacement(lockedMods(old)[ref.id], found.entry);
    const dependencies = world.spec.dependencies ?? [];
    const previous = dependencies.find((d) => d.name === ref.id);
    if (previous && previous.source.author !== ref.author)
        throw new Error(`同名の mod が入っています: ${ref.id}。別作者の mod へ置き換えません`);
    const next = [
        ...dependencies.filter((d) => d.name !== ref.id),
        { name: ref.id, source: { author: ref.author, url: found.entry.baseUrl, version: found.entry.version } },
    ];
    const get = createDependencyAwareLockEntryGetter(next, createHttpLockEntryGetter(''), undefined, old);
    const ids = requiredLockModIds({ ...world.spec, dependencies: next });
    const lock = await buildWorldLock(ids, (id) => (id === ref.id ? Promise.resolve(found.entry) : get(id)));
    if (ids.some((id) => !lockedMods(lock)[id])) throw new Error('ほかの依存を取得できません。変更せず終了しました');
    assertCapabilityUpdate(old, lock, args.includes('--accept-capabilities'));
    doc.setIn(['spec', 'dependencies'], next);
    writeWorldFiles([
        { path, text: String(doc), expected: raw },
        { path: lockPath, text: `${JSON.stringify(lock, null, 2)}\n`, expected: oldText },
    ]);
    log.success(
        `@${ref.author}/${ref.id}@${found.entry.version} を追加しました`,
        `${Object.keys(found.manifest.prefabs ?? {}).length} 個のプレハブ。公開時に署名し直してください`,
    );
}

/** ネットワークへの列挙は指定サーバー 1 台だけ。配布物は取得しない。 */
export async function searchPackages(args: string[], log: Logger): Promise<void> {
    const server = args.find((a) => a.startsWith('--server='))?.slice(9) ?? 'https://ubichill.com';
    const query = args.find((a) => !a.startsWith('--')) ?? '';
    const page = (await packageJson(`${server.replace(/\/$/, '')}/api/v1/mods?q=${encodeURIComponent(query)}`)) as {
        items?: Array<{ author: string; id: string; version: string }>;
        nextOffset?: number | null;
    };
    if (!Array.isArray(page.items)) throw new Error('このサーバーは package 検索に対応していません');
    for (const p of page.items) log.info(`@${p.author}/${p.id}@${p.version}`);
    if (!page.items.length) log.info('見つかりませんでした。完全な作者参照は検索への登録なしで install できます');
}

export function initProject(args: string[], log: Logger): void {
    const [kind, name] = args;
    if (kind !== 'mod' && kind !== 'world') throw new Error('使い方: ubichill init mod|world <名前>');
    PackageIdSchema.parse(name);
    const dir = resolve(name);
    if (existsSync(dir)) throw new Error(`${name} は既に存在します。上書きしません`);
    mkdirSync(dir);
    const entity = {
        id: 'welcome',
        transform: { x: 40, y: 40, w: 320, h: 100 },
        components: [{ id: 'label', type: 'core:ui', data: { markup: '<div>ようこそ</div>' } }],
    };
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist/\n.ubichill/\n');
    if (kind === 'mod') {
        mkdirSync(join(dir, 'src'));
        mkdirSync(join(dir, 'prefabs'));
        writeFileSync(
            join(dir, 'src', 'hello.worker.tsx'),
            "import type { ComponentConfig } from 'ubichill';\nexport const config: ComponentConfig = { defaultTransform: { x: 40, y: 160, w: 320, h: 100 } };\nexport default function Hello() { return <div>Hello!</div>; }\n",
        );
        writeFileSync(
            join(dir, 'prefabs', 'welcome.json'),
            JSON.stringify({ name: 'ようこそ', entities: [entity] }, null, 2),
        );
        writeFileSync(
            join(dir, 'tsconfig.json'),
            JSON.stringify(
                {
                    compilerOptions: {
                        target: 'ES2022',
                        lib: ['ES2022', 'WebWorker'],
                        module: 'ESNext',
                        moduleResolution: 'Bundler',
                        strict: true,
                        noEmit: true,
                        jsx: 'react-jsx',
                        jsxImportSource: 'ubichill',
                        types: ['ubichill'],
                    },
                    include: ['src'],
                },
                null,
                2,
            ),
        );
    } else
        writeFileSync(
            join(dir, 'world.yaml'),
            yaml.stringify({
                apiVersion: 'ubichill.com/v1alpha1',
                kind: 'World',
                metadata: { name, version: '1.0.0' },
                spec: { displayName: name, dependencies: [], initialEntities: [entity] },
            }),
        );
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
            {
                name,
                version: '1.0.0',
                private: true,
                type: 'module',
                scripts: {
                    dev: 'ubichill dev',
                    ...(kind === 'mod' ? { build: 'tsc --noEmit && ubichill build --layout=registry' } : {}),
                },
                ...(kind === 'mod' ? { dependencies: { ubichill: '^4' } } : {}),
                devDependencies: { '@ubichill/cli': '^1', ...(kind === 'mod' ? { typescript: '^5' } : {}) },
            },
            null,
            2,
        ),
    );
    log.success(`${name} を作りました`, `cd ${name} → npm install → npm run dev`);
}
