/**
 * danmaku:canvas — 遊ぶ範囲。Entity の矩形が範囲になり、自機はここから出られない（壁の代わり）。
 *
 * 範囲の中に置いた danmaku:enemy をステージとして動かす。部屋で共有するのは「ラウンド」「始まった時刻」
 * 「各自のダメージ」だけで、敵の位置と弾はそこから各クライアントが同じように計算する（game/）。
 * 弾は Entity にしない（毎フレームの位置を部屋に送らない）。
 */

import type { ComponentConfig, ComponentInstance } from 'ubichill';
import { DanmakuEvents } from './events';
import { areaOf } from './game/area';
import { type EnemySpec, enemySpecOf } from './game/enemy';
import { stepFrame } from './game/frame';
import { type Rect, rectCenter, rectContains, type Vec } from './game/geometry';
import { rememberAims } from './game/patterns';
import { ageEffects, type Effect, impactEffects, sceneCursors, shipEffects } from './game/render';
import { type ShipMarks, shipMarksOf } from './game/ship';
import { addShot, type Shot, shotFrom } from './game/shots';
import {
    addHits,
    clearCountdown,
    clearDelayPassed,
    type Hits,
    nextRoundStart,
    othersDamage,
    parseDamageEntry,
    playingSeconds,
    readClock,
    remainingHp,
    type StageStatus,
    stageStatus,
    startsOnBoard,
    totalHits,
} from './game/stage';

export const config: ComponentConfig = {
    canvasTargets: ['field'],
    watchScope: 'world',
    watchEntityTypes: ['danmaku:canvas', 'danmaku:enemy', 'danmaku:player'],
    // 描く canvas はワールド全体を覆う。w/h は遊ぶ範囲（エディタで広げた通りに働く）。
    defaultTransform: { z: 5000, w: 800, h: 600 },
    capabilities: ['canvas:draw', 'event:emit', 'scene:read', 'scene:update', 'ui:render'],
    description:
        '遊ぶ範囲。中に置いた敵（danmaku:enemy）が時間どおりに現れて弾を撃つ。自機はこの範囲から出られない。全部倒すか去ると次のラウンドが始まる。',
    thumbnail: 'previews/canvas.svg',
};

const CANVAS_TARGET = 'field';
/** 自機からの位置が届かなくなったら、乗るのをやめたとみなす。 */
const SHIP_STALE_MS = 250;
/** 当たりを知らせた後、自機の無敵が届くまで同じ当たりを送り続けない。 */
const HIT_RESEND_MS = 250;
const FLASH_MS = 70;

type HudKind = StageStatus['kind'];

const stage = Ubi.state.define({
    round: Ubi.state.sync(0, { editable: false }),
    startedAt: Ubi.state.sync(0, { editable: false }),
    // perUser なので data には `damage:<userId>` で入る（ほかの人の分は game/stage.ts の othersDamage が読む）
    damage: Ubi.state.sync<unknown>(null, { perUser: true, editable: false }),
    hudKind: 'idle' as HudKind,
    hudRound: 0,
    hudDefeated: 0,
    hudTotal: 0,
    hudRiders: 0,
    hudNextIn: 0,
    hudX: 0,
    hudY: 0,
    hudW: 800,
    hudH: 600,
});

interface ShipInfo {
    readonly id: string;
    readonly box: Rect;
    readonly holder: string | null;
}

interface LocalShip {
    readonly shipId: string;
    readonly center: Vec;
    readonly hitRadius: number;
    readonly vulnerable: boolean;
    readonly at: number;
}

/** この画面だけの入力と見た目。ゲームの規則は game/ の純粋関数にある。 */
const sim = {
    area: areaOf(undefined),
    canvasData: {} as Readonly<Record<string, unknown>>,
    enemies: new Map<string, EnemySpec>(),
    ships: new Map<string, ShipInfo>(),
    shipMarks: new Map<string, ShipMarks>(),
    localShip: null as LocalShip | null,
    shots: [] as Shot[],
    effects: [] as Effect[],
    aims: new Map<string, number>(),
    alive: new Set<string>() as ReadonlySet<string>,
    flashUntil: new Map<string, number>(),
    clearedSince: null as number | null,
    seenRound: -1,
    hitSentAt: 0,
    /**
     * 自分のダメージはこの画面が正（書くのは自分だけ）。同期された値はほかの人の書き込みと行き違うと
     * 書く前の値が一瞬返ってくるので読み戻さない。起動時だけ、部屋に残っている値から始める。
     */
    damage: parseDamageEntry(stage.local.damage),
};

function acceptCanvas(entity: ComponentInstance): void {
    if (entity.id !== Ubi.componentInstanceId) return;
    sim.area = areaOf(entity.transform);
    sim.canvasData =
        typeof entity.data === 'object' && entity.data !== null ? (entity.data as Record<string, unknown>) : {};
}

function acceptEnemy(entity: ComponentInstance): void {
    sim.enemies.set(entity.id, enemySpecOf(entity));
}

function acceptShip(entity: ComponentInstance): void {
    const marks = shipMarksOf(entity.data);
    const center = rectCenter(entity.transform);
    if (inArea(center)) sim.effects = [...sim.effects, ...shipEffects(sim.shipMarks.get(entity.id), marks, center)];
    sim.shipMarks.set(entity.id, marks);
    sim.ships.set(entity.id, { id: entity.id, box: entity.transform, holder: entity.lockedBy ?? null });
}

DanmakuEvents.on('entity:danmaku:canvas', acceptCanvas);
DanmakuEvents.on('entity:danmaku:enemy', acceptEnemy);
DanmakuEvents.on('entity:danmaku:player', acceptShip);

Promise.all([
    Ubi.entity.query('danmaku:enemy'),
    Ubi.entity.query('danmaku:player'),
    Ubi.componentInstanceId ? Ubi.entity.get(Ubi.componentInstanceId) : Promise.resolve(null),
])
    .then(([enemies, ships, self]) => {
        for (const enemy of enemies) acceptEnemy(enemy);
        for (const ship of ships) acceptShip(ship);
        if (self) acceptCanvas(self);
    })
    .catch((err: unknown) => Ubi.log(`[danmaku:canvas] ステージの取得に失敗: ${String(err)}`, 'warn'));

const inArea = (point: Vec): boolean => rectContains(sim.area, point);
const shipsInArea = (): ShipInfo[] => [...sim.ships.values()].filter((ship) => inArea(rectCenter(ship.box)));
const enemiesInArea = (): EnemySpec[] => [...sim.enemies.values()].filter((spec) => inArea(spec.home));
const currentClock = () => readClock(stage.local.round, stage.local.startedAt);

function knownHits(round: number): Hits {
    return totalHits([...othersDamage(sim.canvasData, Ubi.myUserId), ...(sim.damage ? [sim.damage] : [])], round);
}

function startRound(now: number): void {
    stage.local.round = currentClock().round + 1;
    stage.local.startedAt = nextRoundStart(now);
}

DanmakuEvents.on('danmaku:shoot', (message) => {
    const shot = shotFrom(message, message.mine === true);
    if (shot && inArea(shot)) sim.shots = addShot(sim.shots, shot);
});

DanmakuEvents.on('danmaku:ship', (message) => {
    const center = { x: message.x, y: message.y };
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !inArea(center)) return;
    sim.localShip = {
        shipId: message.shipId,
        center,
        hitRadius: Math.max(1, Math.min(message.hitRadius, 16)),
        vulnerable: message.vulnerable,
        at: Date.now(),
    };
});

DanmakuEvents.on('danmaku:board', ({ shipId }) => {
    const ship = sim.ships.get(shipId);
    if (ship && !inArea(rectCenter(ship.box))) return;
    const othersRiding = shipsInArea().some((other) => other.id !== shipId && other.holder !== null);
    const now = Date.now();
    const clock = currentClock();
    if (startsOnBoard(stageStatus(clock, now, enemiesInArea(), knownHits(clock.round)), othersRiding)) startRound(now);
});

function updateHud(status: StageStatus, round: number, riders: number, now: number): void {
    const hud = stage.local;
    hud.hudX = sim.area.x;
    hud.hudY = sim.area.y;
    hud.hudW = sim.area.w;
    hud.hudH = sim.area.h;
    hud.hudKind = status.kind;
    hud.hudRound = round;
    hud.hudRiders = riders;
    hud.hudDefeated = status.kind === 'idle' ? 0 : status.defeated;
    hud.hudTotal = status.kind === 'idle' ? 0 : status.total;
    hud.hudNextIn = status.kind === 'cleared' ? clearCountdown(sim.clearedSince, now) : 0;
}

Ubi.registerSystem((_entities, deltaTime) => {
    const now = Date.now();
    const seconds = deltaTime / 1000;
    const clock = currentClock();
    if (clock.round !== sim.seenRound) {
        sim.seenRound = clock.round;
        sim.aims.clear();
        sim.alive = new Set();
        sim.clearedSince = null;
    }
    const specs = enemiesInArea();
    const hits = knownHits(clock.round);
    const t = playingSeconds(clock, now, specs, hits);
    const ships = shipsInArea();
    const localShip = sim.localShip && now - sim.localShip.at < SHIP_STALE_MS ? sim.localShip : null;
    const aims = rememberAims(
        sim.aims,
        [
            ...ships
                .filter((ship) => ship.holder !== null && ship.id !== localShip?.shipId)
                .map((ship) => rectCenter(ship.box)),
            ...(localShip ? [localShip.center] : []),
        ],
        t ?? 0,
    );
    const frame = stepFrame({
        stageTime: t,
        seconds,
        area: sim.area,
        enemies: specs,
        hits,
        ship: localShip,
        shots: sim.shots,
        aim: aims.aim,
        wasAlive: sim.alive,
    });
    aims.forgetUnused();

    if (frame.shipHit && localShip && now - sim.hitSentAt >= HIT_RESEND_MS) {
        sim.hitSentAt = now;
        DanmakuEvents.emit(
            'danmaku:hit',
            { shipId: localShip.shipId },
            { scope: 'world', targetType: 'danmaku:player' },
        );
    }
    if (t !== null && Object.keys(frame.myHits).length > 0) {
        sim.damage = addHits(sim.damage, clock.round, frame.myHits);
        stage.local.damage = sim.damage;
    }
    sim.shots = frame.shots;
    sim.alive = frame.alive;
    sim.effects = [...ageEffects(sim.effects, seconds), ...impactEffects(frame.impacts, frame.defeated)];
    for (const impact of frame.impacts) sim.flashUntil.set(impact.targetId, now + FLASH_MS);

    const status = stageStatus(clock, now, specs, frame.hits);
    sim.clearedSince = status.kind === 'cleared' ? (sim.clearedSince ?? now) : null;
    const iRide = ships.some((ship) => ship.holder !== null && ship.holder === Ubi.myUserId);
    if (status.kind === 'cleared' && iRide && clearDelayPassed(sim.clearedSince, now)) startRound(now);
    updateHud(status, clock.round, ships.filter((ship) => ship.holder !== null).length, now);

    Ubi.canvas.frame(CANVAS_TARGET, {
        activeStroke: null,
        cursors: sceneCursors({
            area: sim.area,
            clock: now / 1000,
            enemies: frame.enemies.map(({ spec, position }) => ({
                spec,
                position,
                hpRatio: remainingHp(spec, frame.hits) / spec.hp,
                flash: (sim.flashUntil.get(spec.id) ?? 0) > now,
            })),
            bullets: frame.bullets,
            shots: sim.shots,
            effects: sim.effects,
            hitbox: localShip ? { center: localShip.center, radius: localShip.hitRadius } : null,
        }),
    });
});

const hudText = {
    color: '#e0f2fe',
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
    fontFamily: 'system-ui, -apple-system, "Hiragino Sans", sans-serif',
};

function Banner(props: { title: string; lines: readonly string[] }) {
    return (
        <div
            style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                padding: '16px 28px',
                borderRadius: '10px',
                background: 'rgba(11, 16, 32, 0.78)',
                border: '1px solid rgba(125, 211, 252, 0.45)',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                ...hudText,
            }}
        >
            <div style={{ fontSize: '22px', fontWeight: '700', letterSpacing: '0.04em' }}>{props.title}</div>
            {props.lines.map((line) => (
                <div key={line} style={{ marginTop: '6px', fontSize: '13px', opacity: '0.85' }}>
                    {line}
                </div>
            ))}
        </div>
    );
}

function StageBanner(props: { kind: HudKind; riders: number; defeated: number; total: number; nextIn: number }) {
    if (props.kind === 'cleared') {
        return (
            <Banner
                title={props.defeated === props.total ? 'ステージクリア' : 'ラウンド終了'}
                lines={[
                    `撃破 ${props.defeated} / ${props.total}`,
                    props.riders > 0 ? `次のラウンドまで ${props.nextIn}` : '自機をクリックして出撃',
                ]}
            />
        );
    }
    if (props.riders > 0) return null;
    return (
        <Banner
            title="自機をクリックして出撃"
            lines={['矢印キーで移動・Shift で低速・Esc で降りる', '弾をよけて敵を撃ち落とそう']}
        />
    );
}

export default function StageHud() {
    const hud = stage.local;
    return (
        <div
            style={{
                position: 'absolute',
                left: `${hud.hudX}px`,
                top: `${hud.hudY}px`,
                width: `${hud.hudW}px`,
                height: `${hud.hudH}px`,
                pointerEvents: 'none',
            }}
        >
            {hud.hudKind !== 'idle' && (
                <div
                    style={{
                        position: 'absolute',
                        left: '12px',
                        right: '12px',
                        top: '10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '13px',
                        fontWeight: '600',
                        ...hudText,
                    }}
                >
                    <span>ラウンド {hud.hudRound}</span>
                    <span>
                        撃破 {hud.hudDefeated} / {hud.hudTotal}
                    </span>
                </div>
            )}
            <StageBanner
                kind={hud.hudKind}
                riders={hud.hudRiders}
                defeated={hud.hudDefeated}
                total={hud.hudTotal}
                nextIn={hud.hudNextIn}
            />
        </div>
    );
}
