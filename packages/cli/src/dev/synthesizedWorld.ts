/**
 * `world.yaml` が無いときのワールド。手元の mod を、開いた画面にそのまま見えるように置く。
 *
 * - 実際のワールド（World Editor・chillwa）と同じ形にする: mod ごとに親の GameObject を 1 つ作り、その子に Component を 1 つずつ置く。
 *   Component どうしの `Ubi.event.emit(…, { scope: 'siblings' })` は「同じ親の下の別の Entity」に届くので、1 つの Entity に
 *   まとめると兄弟が無く、イベントが届かない（videoplayer の search → playlist で起きた）。
 * - 親は左上から横に並べる（右上の dev の表示を避ける）。子は mod が `export const config` に書いた `defaultTransform`
 *   （World Editor が Component を置くときと同じ値）を親からの位置として使う。
 * - `defaultTransform` の無い Component は、宣言のある Component の下に横に並べる。
 * - 画面固定（`overlay`）の Component は、宣言どおり画面の座標に置く（Component の transform で親の位置を上書きする。
 *   x/y を書かないと親のワールド座標を継いでしまうので、無ければ 0）。
 * - entity の id はワールドの中で一意にする。親は mod の id、子は `<mod>--<Component 名>`（kebab-case は `--` を作らないので、
 *   別の mod の親と重ならない）。それでも重なる・長すぎるときは詰めて番号を付ける。
 * - 型を宣言した参照フィールド（`entityRef` の `component`）は、その型を置いた Entity に配線しておく
 *   （mod の開発者が world.yaml を書かずにすぐ動かせるように）。entityRef は 1 つ目、entityRefArray は全部。
 *
 * 戻り値は YAML をパースしたのと同じ生の定義（`definitionToResolved` に渡す）。
 */
import type { FieldsOf } from './references.ts';

export interface SynthesizedComponent {
    /** Component 型（`<id>:<name>`）。 */
    type: string;
    defaultTransform?: {
        x?: number;
        y?: number;
        z?: number;
        w?: number;
        h?: number;
        scale?: number;
        rotation?: number;
    };
    overlay?: unknown;
}

export interface SynthesizedMod {
    id: string;
    components: readonly SynthesizedComponent[];
}

const WORLD = { width: 2000, height: 1500 };
/** 最初の mod の左上。 */
const ORIGIN = { x: 48, y: 48 };
/** mod の間・置き場所の無い Component の間の余白。 */
const GAP = 48;
/** 大きさの分からない Component の仮の大きさ（配置にだけ使う。w/h は書かない）。 */
const FALLBACK = { w: 240, h: 160 };

const kebab = (value: string): string =>
    value
        .replace(/[^a-z0-9]+/gi, '-')
        .replace(/^-|-$/g, '')
        .toLowerCase();

/** entity の id の上限（KebabCaseId）。 */
const MAX_ID = 50;

/** ワールドの中で一意な id を配る。 */
function idAllocator(): (base: string) => string {
    const used = new Set<string>();
    return (base) => {
        const stem = (base || 'entity').slice(0, MAX_ID - 4);
        const id =
            [stem, ...Array.from({ length: 999 }, (_, i) => `${stem}-${i + 2}`)].find((c) => !used.has(c)) ?? stem;
        used.add(id);
        return id;
    };
}

interface Child {
    entity: Record<string, unknown>;
    right: number;
    bottom: number;
}

/** 1 つの mod の Component を、親（mod）の左上を (0, 0) とする子の GameObject にする。 */
function modChildren(
    mod: SynthesizedMod,
    modKey: string,
    allocate: (base: string) => string,
): { children: Record<string, unknown>[]; width: number; height: number } {
    const childId = (type: string) => allocate(`${modKey}--${kebab(type.slice(type.indexOf(':') + 1)) || 'component'}`);
    const declared: Child[] = mod.components
        .filter((c) => c.defaultTransform && !c.overlay)
        .map((c) => {
            const t = c.defaultTransform ?? {};
            const x = t.x ?? 0;
            const y = t.y ?? 0;
            return {
                entity: { id: childId(c.type), transform: { ...t, x, y }, components: [{ type: c.type }] },
                right: x + (t.w ?? FALLBACK.w),
                bottom: y + (t.h ?? FALLBACK.h),
            };
        });
    const rowTop = declared.length > 0 ? Math.max(...declared.map((c) => c.bottom)) + GAP : 0;
    const rest: Child[] = mod.components
        .filter((c) => !c.defaultTransform && !c.overlay)
        .map((c, index) => {
            const x = index * (FALLBACK.w + GAP);
            return {
                entity: { id: childId(c.type), transform: { x, y: rowTop }, components: [{ type: c.type }] },
                right: x + FALLBACK.w,
                bottom: rowTop + FALLBACK.h,
            };
        });
    const overlays = mod.components
        .filter((c) => c.overlay)
        .map((c) => ({
            id: childId(c.type),
            transform: { x: 0, y: 0 },
            components: [
                {
                    type: c.type,
                    overlay: c.overlay,
                    transform: { ...c.defaultTransform, x: c.defaultTransform?.x ?? 0, y: c.defaultTransform?.y ?? 0 },
                },
            ],
        }));
    const placed = [...declared, ...rest];
    return {
        children: [...placed.map((c) => c.entity), ...overlays],
        width: Math.max(FALLBACK.w, ...placed.map((c) => c.right)),
        height: Math.max(FALLBACK.h, ...placed.map((c) => c.bottom)),
    };
}

type RawEntity = {
    id: string;
    components: Array<{ type: string; data?: Record<string, unknown> }>;
    children?: RawEntity[];
};

/** 型を宣言した参照フィールドを、その型の Component を置いた Entity に向ける（配置の後に付ける）。 */
function wireTypedRefs(entities: readonly RawEntity[], fieldsOf: FieldsOf): RawEntity[] {
    const all = (list: readonly RawEntity[]): RawEntity[] => list.flatMap((e) => [e, ...all(e.children ?? [])]);
    const idsOfType = (type: string): string[] =>
        all(entities)
            .filter((e) => e.components.some((c) => c.type === type))
            .map((e) => e.id);
    const wire = (component: RawEntity['components'][number]): RawEntity['components'][number] => {
        const wired = Object.entries(fieldsOf(component.type) ?? {}).flatMap(
            ([field, spec]): Array<[string, unknown]> => {
                const targets = spec.component ? idsOfType(spec.component) : [];
                if (targets.length === 0) return [];
                if (spec.type === 'entityRef') return [[field, targets[0]]];
                if (spec.type === 'entityRefArray') return [[field, targets]];
                return [];
            },
        );
        return wired.length > 0
            ? { ...component, data: { ...component.data, ...Object.fromEntries(wired) } }
            : component;
    };
    const walk = (list: readonly RawEntity[]): RawEntity[] =>
        list.map((e) => ({
            ...e,
            components: e.components.map(wire),
            ...(e.children ? { children: walk(e.children) } : {}),
        }));
    return walk(entities);
}

export function synthesizeWorld(
    mods: readonly SynthesizedMod[],
    fieldsOf: FieldsOf = () => undefined,
): Record<string, unknown> {
    const allocate = idAllocator();
    // 親の id を先に配る（子の id は親と重ならない形だが、念のため後から配る側が番号を付ける）
    const keys = mods.map((mod, i) => allocate(kebab(mod.id) || `mod-${i}`));
    const laid = mods.map((mod, i) => modChildren(mod, keys[i] as string, allocate));
    const origins = laid.reduce<{ x: number; list: number[] }>(
        (acc, mod) => ({ x: acc.x + mod.width + GAP, list: [...acc.list, acc.x] }),
        { x: ORIGIN.x, list: [] },
    ).list;
    const width = Math.max(WORLD.width, ...laid.map((mod, i) => (origins[i] ?? 0) + mod.width + GAP));
    const height = Math.max(WORLD.height, ...laid.map((mod) => ORIGIN.y + mod.height + GAP));
    return {
        apiVersion: 'ubichill.com/v1alpha1',
        kind: 'World',
        metadata: { name: 'dev', version: '0.0.0' },
        spec: {
            displayName: 'ubichill dev',
            capacity: { default: 10, max: 20 },
            environment: { backgroundColor: '#F0F8FF', worldSize: { width, height } },
            dependencies: mods.map((mod) => ({ name: mod.id, source: { version: 'latest' } })),
            initialEntities: wireTypedRefs(
                mods.map((_, i) => ({
                    id: keys[i] as string,
                    transform: { x: origins[i] ?? ORIGIN.x, y: ORIGIN.y },
                    components: [],
                    children: (laid[i]?.children ?? []) as RawEntity[],
                })),
                fieldsOf,
            ),
        },
    };
}

/** 成果物の manifest.json から、合成に使う Component の宣言を読む。 */
export function componentsFromManifest(
    types: readonly string[],
    manifestBytes: Uint8Array | undefined,
): SynthesizedComponent[] {
    const manifest = (() => {
        try {
            return manifestBytes
                ? (JSON.parse(new TextDecoder().decode(manifestBytes)) as {
                      components?: Record<
                          string,
                          { defaultTransform?: SynthesizedComponent['defaultTransform']; overlay?: unknown }
                      >;
                  })
                : undefined;
        } catch {
            return undefined;
        }
    })();
    return types.map((type) => {
        const entry = manifest?.components?.[type];
        return {
            type,
            ...(entry?.defaultTransform ? { defaultTransform: entry.defaultTransform } : {}),
            ...(entry?.overlay ? { overlay: entry.overlay } : {}),
        };
    });
}
