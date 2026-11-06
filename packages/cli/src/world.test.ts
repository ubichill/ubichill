import { describe, expect, it } from 'vitest';
import { buildInstanceDefinition } from './world.ts';

const worldText = `
apiVersion: ubichill.com/v1alpha1
kind: World
metadata: { name: home, version: 1.0.0 }
spec:
  displayName: Home
  capacity: { default: 4, max: 8 }
  dependencies:
    - { name: pen, source: { version: latest } }
  initialEntities:
    - id: tray
      transform: { x: 10, y: 20 }
      components:
        - { type: "pen:tray" }
      children:
        - id: pen
          transform: { x: 1, y: 2 }
          components:
            - { type: "pen:pen", data: { color: "#fff" } }
`;
const lockText = JSON.stringify({
    lockVersion: 1,
    mods: { pen: { id: 'pen', version: '2.0.0', manifestIntegrity: `sha256-${'A'.repeat(43)}=`, components: {} } },
});

describe('buildInstanceDefinition', () => {
    it('world.yaml と兄弟の lock から Go の定義を作る（id は metadata.name、maxUsers は定員の上限）', () => {
        const def = buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText, lockText });
        expect(def.id).toBe('home');
        expect(def.name).toBe('Home');
        expect(def.maxUsers).toBe(8);
        expect(def.snapshot.activeMods).toEqual(['pen']);
        expect(def.snapshot.entities.map((e) => e.id)).toEqual(['tray::0', 'pen::0']);
        expect(def.snapshot.entities[1]?.transform).toMatchObject({ x: 11, y: 22 });
        expect(def.snapshot.lock).toEqual(JSON.parse(lockText));
        expect(def.snapshot.sourceKind).toBe('local');
    });

    it('lock に無い mod を参照していれば、ubichill install への案内つきで失敗する', () => {
        expect(() => buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText })).toThrow(
            /lock に固定されていない mod があります: pen.*ubichill install \/w\/home\.yaml/,
        );
    });

    it('mod を使わないワールドは lock が無くても作れる', () => {
        const empty = worldText.replace(/ {2}dependencies:[\s\S]*$/, '  initialEntities: []\n');
        expect(buildInstanceDefinition({ worldPath: '/w/e.yaml', worldText: empty }).snapshot.entities).toEqual([]);
    });

    it('--id と --max-users を反映し、定員の上限と Go の上限を超える値は断る', () => {
        const def = buildInstanceDefinition({
            worldPath: '/w/home.yaml',
            worldText,
            lockText,
            id: 'room-1',
            maxUsers: 3,
        });
        expect(def.id).toBe('room-1');
        expect(def.maxUsers).toBe(3);
        expect(() => buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText, lockText, maxUsers: 9 })).toThrow(
            /定員の上限/,
        );
        expect(() => buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText, lockText, maxUsers: 0 })).toThrow(
            /1〜1000/,
        );
        expect(() =>
            buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText, lockText, maxUsers: 2.5 }),
        ).toThrow(/1〜1000/);
        expect(() => buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText, lockText, id: '' })).toThrow(
            /1〜200/,
        );
    });

    it('壊れた lock・不正な定義は失敗する', () => {
        expect(() =>
            buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText, lockText: '{"mods":{}}' }),
        ).toThrow();
        expect(() =>
            buildInstanceDefinition({ worldPath: '/w/home.yaml', worldText: 'kind: World\n', lockText }),
        ).toThrow(/無効/);
    });
});
