import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { config as enemyConfig } from '../../../mods/danmaku/src/enemy.worker';
import { areaOf } from '../../../mods/danmaku/src/game/area';
import { BULLET_PATTERNS, enemySpecOf } from '../../../mods/danmaku/src/game/enemy';
import { stepFrame } from '../../../mods/danmaku/src/game/frame';
import { rectCenter, rectContains } from '../../../mods/danmaku/src/game/geometry';
import { DOWNWARD } from '../../../mods/danmaku/src/game/patterns';
import { stageStatus } from '../../../mods/danmaku/src/game/stage';

interface WorldEntityFixture {
    id: string;
    transform: { x: number; y: number; w?: number; h?: number };
    components: Array<{ id?: string; type: string; data: Record<string, unknown> }>;
}

const world = parse(readFileSync(resolve(process.cwd(), 'worlds/danmaku.yaml'), 'utf8')) as {
    spec: { initialEntities: WorldEntityFixture[] };
};
const entities = world.spec.initialEntities;
const withComponent = (type: string) => entities.filter((e) => e.components.some((c) => c.type === type));
const dataOf = (entity: WorldEntityFixture, type: string) => entity.components.find((c) => c.type === type)?.data ?? {};

const area = areaOf(withComponent('danmaku:canvas')[0]?.transform);
const enemies = withComponent('danmaku:enemy').map((e) =>
    enemySpecOf({ id: e.id, transform: e.transform, data: dataOf(e, 'danmaku:enemy') }),
);

describe('worlds/danmaku.yaml（公式のステージ）', () => {
    it('壁は無く、遊ぶ範囲が 1 つと自機が 1 機あり、自機は範囲の中にいる', () => {
        expect(entities.flatMap((e) => e.components.map((c) => c.type))).not.toContain('core:collider');
        expect(withComponent('danmaku:canvas')).toHaveLength(1);
        const ships = withComponent('danmaku:player');
        expect(ships).toHaveLength(1);
        expect(rectContains(area, rectCenter({ w: 0, h: 0, ...ships[0].transform }))).toBe(true);
    });

    it('敵の設定は設定欄に宣言した項目だけで、範囲に収める補正が要らない値になっている', () => {
        const declared = Object.keys(enemyConfig.dataFields ?? {});
        for (const entity of withComponent('danmaku:enemy')) {
            const data = dataOf(entity, 'danmaku:enemy');
            expect(Object.keys(data).filter((key) => !declared.includes(key))).toEqual([]);
            const spec = enemySpecOf({ id: entity.id, transform: entity.transform, data });
            expect(spec).toMatchObject({
                hp: data.hp,
                count: data.count,
                interval: data.interval,
                pattern: data.pattern,
            });
            expect(rectContains(area, spec.home)).toBe(true);
        }
    });

    it('90 秒くらいまでに全種類の撃ち方が出てきて、だんだん敵の HP が上がる', () => {
        expect(new Set(enemies.map((e) => e.pattern))).toEqual(new Set(BULLET_PATTERNS));
        expect(Math.max(...enemies.map((e) => e.appearAt))).toBeLessThanOrEqual(90);
        const byAppearance = [...enemies].sort((a, b) => a.appearAt - b.appearAt);
        expect(byAppearance[byAppearance.length - 1].hp).toBe(Math.max(...enemies.map((e) => e.hp)));
        expect(enemies.every((e) => e.leaveAt !== null)).toBe(true);
    });

    it('誰も倒さなくてもラウンドは終わり、その間の弾の数は 1 フレームで描ける量に収まる', () => {
        const times = Array.from({ length: 1100 }, (_, i) => i * 0.1);
        const bulletCounts = times.map(
            (t) =>
                stepFrame({
                    stageTime: t,
                    previousTime: t - 0.1,
                    seconds: 0.1,
                    area,
                    enemies,
                    hits: {},
                    ship: null,
                    shots: [],
                    aim: () => DOWNWARD,
                    wasAlive: new Set(),
                }).bullets.length,
        );
        expect(Math.max(...bulletCounts)).toBeGreaterThan(20);
        expect(Math.max(...bulletCounts)).toBeLessThan(800);
        const last = Math.max(...enemies.map((e) => e.leaveAt ?? 0));
        expect(stageStatus({ round: 1, startedAt: 1 }, 1 + (last + 2) * 1000, enemies, {}).kind).toBe('cleared');
    });

    it('自機の初期位置でじっとしていると、いつかは当たる（よけないと HP が減る）', () => {
        const ship = withComponent('danmaku:player')[0].transform;
        const center = rectCenter({ w: 32, h: 32, ...ship });
        const hitAt = Array.from({ length: 900 }, (_, i) => i * 0.1).find(
            (t) =>
                stepFrame({
                    stageTime: t,
                    previousTime: t - 0.1,
                    seconds: 0.1,
                    area,
                    enemies,
                    hits: {},
                    ship: { center, hitRadius: 4, vulnerable: true },
                    shots: [],
                    aim: (_key, origin) => Math.atan2(center.y - origin.y, center.x - origin.x),
                    wasAlive: new Set(),
                }).shipHit,
        );
        expect(hitAt).toBeDefined();
    });
});
