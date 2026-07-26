import { WorldSourceKind } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import { definitionToResolved, normalizeWorldUrl, resolveWorldFromYaml, toRawGitHubUrl } from './worldResolver';

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
        // dependency 由来の avatar は version 宣言が無いので undefined
        expect(resolved.mods.find((m) => m.id === 'avatar')?.version).toBeUndefined();
    });
});
