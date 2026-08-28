import { WorldSourceKind } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import {
    definitionToResolved,
    lockUrlFor,
    normalizeWorldUrl,
    resolveWorldFromYaml,
    toRawGitHubUrl,
} from './worldResolver';

const VALID_YAML = `
apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: test-world
  version: 1.2.3
  author:
    name: Alice
spec:
  displayName: テストワールド
  description: 説明
  capacity:
    default: 8
    max: 16
  initialEntities: []
`;

describe('toRawGitHubUrl', () => {
    it('GitHub blob URL を raw へ変換する', () => {
        expect(toRawGitHubUrl('https://github.com/o/r/blob/main/worlds/a.yaml')).toBe(
            'https://raw.githubusercontent.com/o/r/main/worlds/a.yaml',
        );
    });

    it('blob 以外の URL はそのまま返す', () => {
        const url = 'https://example.com/world.yaml';
        expect(toRawGitHubUrl(url)).toBe(url);
    });
});

describe('normalizeWorldUrl', () => {
    it('共有 URL(.../world/:id) を機械 URL に正規化する', () => {
        expect(normalizeWorldUrl('https://h.example/world/abc')).toBe('https://h.example/api/v1/worlds/abc');
    });
    it('機械 URL はそのまま、/yaml は除去する', () => {
        expect(normalizeWorldUrl('https://h.example/api/v1/worlds/abc')).toBe('https://h.example/api/v1/worlds/abc');
        expect(normalizeWorldUrl('https://h.example/api/v1/worlds/abc/yaml')).toBe(
            'https://h.example/api/v1/worlds/abc',
        );
    });
    it('ワールド一覧(.../api/v1/worlds) やその他 URL は変えない', () => {
        expect(normalizeWorldUrl('https://h.example/api/v1/worlds')).toBe('https://h.example/api/v1/worlds');
        const raw = 'https://raw.githubusercontent.com/o/r/main/worlds/x.yaml';
        expect(normalizeWorldUrl(raw)).toBe(raw);
    });
    it('不正な文字列は入力を返す', () => {
        expect(normalizeWorldUrl('not a url')).toBe('not a url');
    });
});

describe('lockUrlFor（mod ロックの兄弟 URL 導出）', () => {
    it('機械 URL(.../api/v1/worlds/:id) → .../lock', () => {
        expect(lockUrlFor('https://h.example/api/v1/worlds/abc')).toBe('https://h.example/api/v1/worlds/abc/lock');
    });
    it('/yaml サフィックス付きでも同じ lock URL を導出する', () => {
        expect(lockUrlFor('https://h.example/api/v1/worlds/abc/yaml')).toBe('https://h.example/api/v1/worlds/abc/lock');
    });
    it('直 YAML URL は拡張子を .lock.json に置換（GitHub raw 等）', () => {
        expect(lockUrlFor('https://raw.githubusercontent.com/o/r/main/worlds/x.yaml')).toBe(
            'https://raw.githubusercontent.com/o/r/main/worlds/x.lock.json',
        );
        expect(lockUrlFor('https://cdn.example/foo.yml')).toBe('https://cdn.example/foo.lock.json');
    });
    it('ワールド一覧や兄弟を導出できない URL は null（埋め込みフォールバックに委ねる）', () => {
        expect(lockUrlFor('https://h.example/api/v1/worlds')).toBeNull();
        expect(lockUrlFor('https://example.com/some/page')).toBeNull();
        expect(lockUrlFor('not a url')).toBeNull();
    });
});

describe('definitionToResolved / resolveWorldFromYaml', () => {
    const url = 'https://example.com/w.yaml';
    const source = { kind: WorldSourceKind.Url, url } as const;

    it('YAML を url/source 付きの ResolvedWorld に写像する', () => {
        const resolved = resolveWorldFromYaml(VALID_YAML, url, source);
        expect(resolved.url).toBe(url);
        expect(resolved.source).toEqual(source);
        expect(resolved.id).toBe('test-world');
        expect(resolved.version).toBe('1.2.3');
        expect(resolved.displayName).toBe('テストワールド');
        expect(resolved.authorName).toBe('Alice');
        expect(resolved.capacity).toEqual({ default: 8, max: 16 });
    });

    it('extra.authorId を反映する', () => {
        const resolved = resolveWorldFromYaml(VALID_YAML, url, source, { authorId: 'user-1' });
        expect(resolved.authorId).toBe('user-1');
    });

    it('不正な定義は例外を投げる', () => {
        expect(() => definitionToResolved({ kind: 'World' }, url, source)).toThrow();
    });

    it('initialEntities の component 型と dependencies から mods を重複なく算出する', () => {
        const yaml = `
apiVersion: ubichill.com/v1alpha1
kind: World
metadata: { name: mod-world, version: 1.0.0 }
spec:
  displayName: mod
  dependencies:
    - { name: avatar, source: { type: url, url: "https://x/avatar" } }
  initialEntities:
    - id: a
      transform: { x: 0, y: 0 }
      components:
        - { type: "pen:tray" }
        - { type: "pen:pen" }
      children:
        - id: b
          transform: { x: 0, y: 0 }
          components:
            - { type: "video-player:screen" }
`;
        const resolved = resolveWorldFromYaml(yaml, url, source);
        expect(
            resolved.mods
                .map((m) => m.id)
                .slice()
                .sort(),
        ).toEqual(['avatar', 'pen', 'video-player']);
        // dependency 由来の avatar は version 宣言が無いので既定の 'latest'（常に最新を追う）になる
        expect(resolved.mods.find((m) => m.id === 'avatar')?.version).toBe('latest');
    });

    // 正規化(normalizeEntity)がフィールドを列挙して組み直していると、スキーマに増えた
    // Component の項目を黙って落としてしまう。実際に overlay がここで消え、YAML に書いても
    // HUD が画面固定にならないバグが出たので、代表的な省略可能フィールドを回帰テストで守る。
    it('Component の省略可能フィールド(id / transform 上書き / overlay)を正規化で落とさない', () => {
        const yaml = `
apiVersion: ubichill.com/v1alpha1
kind: World
metadata: { name: overlay-world, version: 1.0.0 }
spec:
  displayName: overlay
  initialEntities:
    - id: ship
      transform: { x: 0, y: 0 }
      components:
        - id: pad
          type: "mobile-controller:controller"
          overlay: bottom-left
          transform: { x: 24, y: 24, w: 240, h: 140 }
        - { type: "pen:tray", overlay: true }
        - { type: "video-player:screen", overlay: fill }
        - { type: "danmaku:wall" }
      children:
        - id: child
          transform: { x: 0, y: 0 }
          components:
            - { type: "pen:pen", overlay: top-right }
`;
        const [ship] = resolveWorldFromYaml(yaml, url, source).initialEntities;
        expect(ship.components[0].id).toBe('pad');
        expect(ship.components[0].overlay).toBe('bottom-left');
        expect(ship.components[0].transform).toMatchObject({ x: 24, y: 24, w: 240, h: 140 });
        expect(ship.components[1].overlay).toBe(true);
        expect(ship.components[2].overlay).toBe('fill');
        expect(ship.components[3].overlay).toBeUndefined();
        // 子 Entity も同じ正規化を再帰的に通るので、そこでも落ちないこと
        expect(ship.children[0].components[0].overlay).toBe('top-right');
    });
});
