import { createModLock, type ModLockEntry } from '@ubichill/shared';
import { describe, expect, it } from 'vitest';
import yaml from 'yaml';
import { pinWorldYaml } from './worldPins.ts';

const entry = (id: string, version: string): ModLockEntry => ({
    id,
    version,
    manifestIntegrity: `sha256-${'A'.repeat(43)}=`,
    components: {},
});

const lock = createModLock({ pen: entry('pen', '2.1.0'), danmaku: entry('danmaku', '1.0.2') });

const world = (spec: string) => `apiVersion: ubichill.com/v1alpha1
kind: World
metadata:
  name: room
  version: 1.0.0
spec:
  displayName: Room
${spec}`;

describe('pinWorldYaml', () => {
    it('latest と省略した版を lock の版にし、ubichill の版を依存の後に足す', () => {
        const raw = world(`  dependencies:
    - name: pen
      source:
        version: latest
    - name: danmaku
      source: {}
  initialEntities: []
`);
        const pinned = yaml.parse(pinWorldYaml(raw, lock, 7));
        expect(pinned.spec.dependencies.map((d: { source: { version: string } }) => d.source.version)).toEqual([
            '2.1.0',
            '1.0.2',
        ]);
        expect(pinned.spec.requires).toEqual({ protocol: 7 });
        expect(Object.keys(pinned.spec)).toEqual(['displayName', 'dependencies', 'requires', 'initialEntities']);
    });

    it('固定した版は lock と違っても変えない（版を変えるのは作者が選んだときだけ）', () => {
        const raw = world(`  dependencies:
    - name: pen
      source:
        version: 2.0.0
  requires:
    protocol: 5
  initialEntities: []
`);
        expect(pinWorldYaml(raw, lock, 7)).toBe(raw);
    });

    it('書かれている ubichill の版は上げない', () => {
        const raw = world(`  requires:
    protocol: 5
  initialEntities: []
`);
        expect(pinWorldYaml(raw, lock, 7)).toBe(raw);
    });

    it('lock に無い依存は latest のまま残す（取れていない版を推測で書かない）', () => {
        const raw = world(`  dependencies:
    - name: other
      source:
        version: latest
  requires:
    protocol: 7
  initialEntities: []
`);
        expect(pinWorldYaml(raw, lock, 7)).toBe(raw);
    });

    it('コメントを残す', () => {
        const raw = world(`  # ペンを使う
  dependencies:
    - name: pen # 公式
      source:
        version: latest
  initialEntities: []
`);
        const pinned = pinWorldYaml(raw, lock, 7);
        expect(pinned).toContain('# ペンを使う');
        expect(pinned).toContain('# 公式');
    });

    it('依存の無いワールドは表示名などの後に ubichill の版を足す', () => {
        const pinned = yaml.parse(pinWorldYaml(world('  initialEntities: []\n'), lock, 7));
        expect(Object.keys(pinned.spec)).toEqual(['displayName', 'requires', 'initialEntities']);
    });

    it('書き換える所のほかは、整形を元のまま残す', () => {
        const raw = world(`  dependencies:
    - name: pen
      source:
        version: 'latest'
  initialEntities:
    - id: a
      tags: []
      children: []
      transform: { x: 0, y: 0 }
      components:
        - type: core:collider
          data:
            mask: [wall]
`);
        const pinned = pinWorldYaml(raw, lock, 7);
        expect(pinned).toBe(
            raw
                .replace("version: 'latest'", 'version: 2.1.0')
                .replace('  initialEntities:', '  requires:\n    protocol: 7\n  initialEntities:'),
        );
    });

    it('改行で終わらない YAML の末尾にも足せる', () => {
        const raw =
            'apiVersion: ubichill.com/v1alpha1\nkind: World\nmetadata:\n  name: room\n  version: 1.0.0\nspec:\n  initialEntities: []\n  displayName: Room';
        const pinned = pinWorldYaml(raw, lock, 7);
        expect(pinned).toBe(`${raw}\n  requires:\n    protocol: 7\n`);
        expect(yaml.parse(pinned).spec.requires).toEqual({ protocol: 7 });
    });

    it('版を書く所の無い source: {} は、YAML として書き直して固定する', () => {
        const raw = world(`  dependencies:
    - name: pen
      source: {}
  initialEntities: []
`);
        const pinned = yaml.parse(pinWorldYaml(raw, lock, 7));
        expect(pinned.spec.dependencies[0].source.version).toBe('2.1.0');
        expect(pinned.spec.requires).toEqual({ protocol: 7 });
    });
});
