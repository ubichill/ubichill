/**
 * danmaku:player Worker — 自機。
 *
 * クリックで乗り、矢印キー（Shift で低速）で動く。自機は遊ぶ範囲（danmaku:canvas の矩形）から出られない。
 * 弾は Z キーか自動連射で撃ち、範囲へ emit し、部屋のほかの人へ broadcast する（見た目のため）。
 * 敵の弾との当たりは範囲が自分の画面でだけ判定して知らせてくる。HP・無敵・やられは乗っている人が書き、
 * この Component の data として部屋に共有する（乗っている人しか書けないので取り合いにならない）。
 */

import type { ComponentConfig, ComponentInstance } from 'ubichill';
import { DanmakuEvents } from './events';
import { areaFor, areaOf } from './game/area';
import { type Rect, rectCenter } from './game/geometry';
import {
    canBeHit,
    freshShip,
    isDown,
    moveInput,
    moveShip,
    respawnBox,
    respawnCountdown,
    respawned,
    type ShipStatus,
    shipControlsOf,
    shipRulesOf,
    shipStatusOf,
    shipVisible,
    shouldRespawn,
    takeHit,
} from './game/ship';
import { pullTrigger, shotFrom } from './game/shots';

export const config: ComponentConfig = {
    // 自分の data と、遊ぶ範囲（danmaku:canvas）の矩形を読む。
    watchScope: 'world',
    watchEntityTypes: ['danmaku:player', 'danmaku:canvas'],
    // x/y は指定しない（Entity の位置を継承）。w/h/z だけ上書きする。
    defaultTransform: { z: 10, w: 32, h: 32 },
    thumbnail: 'previews/player.svg',
    dataFields: {
        speed: { type: 'number', default: 200, min: 20, max: 600, step: 10, label: '移動速度 (px/秒)' },
        fireRate: { type: 'number', default: 8, min: 1, max: 30, step: 1, label: '発射レート (発/秒)' },
        bulletSpeed: { type: 'number', default: 420, min: 50, max: 1000, step: 10, label: '弾速 (px/秒)' },
        autoFire: { type: 'boolean', default: true, label: '自動連射' },
        maxHp: { type: 'number', default: 5, min: 1, max: 20, step: 1, label: 'HP' },
        invincibleSeconds: { type: 'number', default: 2, min: 0, max: 10, step: 0.5, label: '被弾後の無敵 (秒)' },
        respawnSeconds: { type: 'number', default: 3, min: 0.5, max: 30, step: 0.5, label: '復活までの時間 (秒)' },
        hitRadius: { type: 'number', default: 4, min: 1, max: 16, step: 1, label: '当たり判定の半径 (px)' },
    },
    capabilities: ['scene:read', 'scene:update', 'ui:render', 'event:emit', 'event:broadcast'],
    description:
        'クリックで搭乗。矢印キーで移動（Shift で低速）、Zキーか自動連射で撃つ。敵の弾に当たると HP が減り、0 で撃墜されて少しあと復活する。Escapeで降りる。',
};

const player = Ubi.state.define({
    speed: Ubi.state.sync(200, { type: 'number', min: 20, max: 600, step: 10, label: '移動速度 (px/秒)' }),
    fireRate: Ubi.state.sync(8, { type: 'number', min: 1, max: 30, step: 1, label: '発射レート (発/秒)' }),
    bulletSpeed: Ubi.state.sync(420, { type: 'number', min: 50, max: 1000, step: 10, label: '弾速 (px/秒)' }),
    autoFire: Ubi.state.sync(true, { type: 'boolean', label: '自動連射' }),
    maxHp: Ubi.state.sync(5, { type: 'number', min: 1, max: 20, step: 1, label: 'HP' }),
    invincibleSeconds: Ubi.state.sync(2, { type: 'number', min: 0, max: 10, step: 0.5, label: '被弾後の無敵 (秒)' }),
    respawnSeconds: Ubi.state.sync(3, { type: 'number', min: 0.5, max: 30, step: 0.5, label: '復活までの時間 (秒)' }),
    hitRadius: Ubi.state.sync(4, { type: 'number', min: 1, max: 16, step: 1, label: '当たり判定の半径 (px)' }),
    hp: Ubi.state.sync<unknown>(5, { editable: false }),
    hitAt: Ubi.state.sync<unknown>(0, { editable: false }),
    downAt: Ubi.state.sync<unknown>(0, { editable: false }),
    // 見た目（この画面だけ）。値が変わったときだけ描き直す。
    shownHp: 0,
    shownDown: false,
    shown: true,
    countdown: 0,
});
const ride = Ubi.ride.exclusive();

// 入力元ごとに別の Set で持つ。同じ Set を共有すると、キーボードで押しっぱなしの間に
// 仮想パッドの同じボタンを押して離しただけでキーボード側の入力まで消えてしまう。
const keyboardPressed = new Set<string>();
const padPressed = new Set<string>();
const isPressed = (code: string): boolean => keyboardPressed.has(code) || padPressed.has(code);

type Transform = ComponentInstance['transform'];

const ship = {
    box: null as Transform | null,
    areas: new Map<string, Rect>(),
    cooldown: 0,
    /**
     * 乗っている間の HP などはこの画面が正。同期された値は、毎フレームの移動の書き込みと行き違うと
     * 書く前の値が一瞬返ってくるので、規則の判定には使わない（ほかの人の画面の表示にだけ使う）。
     */
    status: null as ShipStatus | null,
};

const rules = () => shipRulesOf(player.local);
const controls = () => shipControlsOf(player.local);
const status = (): ShipStatus =>
    ride.isMine && ship.status
        ? ship.status
        : shipStatusOf(player.local.hp, player.local.hitAt, player.local.downAt, rules());

function writeStatus(next: ShipStatus): void {
    ship.status = next;
    player.local.hp = next.hp;
    player.local.hitAt = next.hitAt;
    player.local.downAt = next.downAt;
}

function currentArea(box: Rect): Rect {
    return (
        areaFor(
            rectCenter(box),
            [...ship.areas.values()].map((area) => ({ area })),
        )?.area ?? areaOf(undefined)
    );
}

function moveTo(box: Transform): void {
    ship.box = box;
    Ubi.entity()
        .update({ transform: box })
        .catch((err: unknown) => Ubi.log(`[danmaku:player] 移動の反映に失敗: ${String(err)}`, 'warn'));
}

function acceptArea(entity: ComponentInstance): void {
    ship.areas.set(entity.id, areaOf(entity.transform));
}

function acceptSelf(entity: ComponentInstance): void {
    // 自分が動かしている間は、遅れて届いた自分の位置で戻さない
    if (entity.id === Ubi.componentInstanceId && !ride.isMine) ship.box = { ...entity.transform };
}

DanmakuEvents.on('entity:danmaku:canvas', acceptArea);
DanmakuEvents.on('entity:danmaku:player', acceptSelf);

Promise.all([
    Ubi.entity.query('danmaku:canvas'),
    Ubi.componentInstanceId ? Ubi.entity.get(Ubi.componentInstanceId) : Promise.resolve(null),
])
    .then(([areas, self]) => {
        for (const area of areas) acceptArea(area);
        if (self && !ship.box) ship.box = { ...self.transform };
    })
    .catch((err: unknown) => Ubi.log(`[danmaku:player] 初期状態の取得に失敗: ${String(err)}`, 'warn'));

// 乗った tick では transform を直接書かない。lockedBy の書き込み（tick の終わり）より先に届くと、
// 古い lockedBy の Entity が返ってきて「降りた」と扱われる。範囲の中へ戻すのは次の tick の移動が行う。
ride.onChange((next) => {
    keyboardPressed.clear();
    padPressed.clear();
    if (next === null || next !== Ubi.myUserId) {
        ship.status = null;
        return;
    }
    writeStatus(freshShip(rules()));
    if (Ubi.componentInstanceId) {
        DanmakuEvents.emit(
            'danmaku:board',
            { shipId: Ubi.componentInstanceId },
            { scope: 'world', targetType: 'danmaku:canvas' },
        );
    }
});

DanmakuEvents.on('input:key_down', ({ code }) => {
    if (code === 'Escape' && ride.isMine) {
        ride.release();
        return;
    }
    keyboardPressed.add(code);
});
DanmakuEvents.on('input:key_up', ({ code }) => keyboardPressed.delete(code));

// mobile-controller:controller（同Entity上の仮想パッド）からのボタン押下/解放。
DanmakuEvents.on('mobile:key_down', ({ code }) => padPressed.add(code));
DanmakuEvents.on('mobile:key_up', ({ code }) => padPressed.delete(code));

DanmakuEvents.on('danmaku:hit', ({ shipId }) => {
    if (shipId !== Ubi.componentInstanceId || !ride.isMine) return;
    const before = status();
    const after = takeHit(before, rules(), Date.now());
    if (after !== before) writeStatus(after);
});

// ほかの人の画面で撃たれた弾。今乗っている人からのものだけを、自分の画面の範囲へ渡す。
DanmakuEvents.onBroadcast('danmaku:shot', (userId, data) => {
    if (userId !== ride.holder) return;
    const shot = shotFrom(data, false);
    if (!shot) return;
    DanmakuEvents.emit(
        'danmaku:shoot',
        { x: shot.x, y: shot.y, speed: -shot.vy, mine: false },
        { scope: 'world', targetType: 'danmaku:canvas' },
    );
});

function fire(box: Transform, speed: number): void {
    const shot = { x: box.x + box.w / 2, y: box.y, speed };
    DanmakuEvents.emit('danmaku:shoot', { ...shot, mine: true }, { scope: 'world', targetType: 'danmaku:canvas' });
    DanmakuEvents.broadcast('danmaku:shot', shot);
}

Ubi.registerSystem((_entities, deltaTime) => {
    const now = Date.now();
    const current = status();
    const shipRules = rules();
    const ridden = ride.holder !== null;
    player.local.shownHp = ridden ? current.hp : 0;
    player.local.shownDown = ridden && isDown(current);
    player.local.shown = !ridden || shipVisible(current, shipRules, now);
    player.local.countdown = ridden ? respawnCountdown(current, shipRules, now) : 0;

    const box = ship.box;
    if (!box || !ride.isMine || !Ubi.componentInstanceId) return;
    const area = currentArea(box);
    const seconds = deltaTime / 1000;

    if (shouldRespawn(current, shipRules, now)) {
        writeStatus(respawned(shipRules, now));
        moveTo(respawnBox(box, area));
        return;
    }
    if (isDown(current)) return;

    const control = controls();
    const moved = moveShip(box, moveInput(isPressed), control.speed, seconds, area);
    if (moved.x !== box.x || moved.y !== box.y) moveTo(moved);

    const trigger = pullTrigger(ship.cooldown, seconds, control.autoFire || isPressed('KeyZ'), control.fireRate);
    ship.cooldown = trigger.cooldown;
    if (trigger.fire) fire(moved, control.bulletSpeed);

    const center = rectCenter(moved);
    DanmakuEvents.emit(
        'danmaku:ship',
        {
            shipId: Ubi.componentInstanceId,
            x: center.x,
            y: center.y,
            hitRadius: control.hitRadius,
            vulnerable: canBeHit(current, shipRules, now),
        },
        { scope: 'world', targetType: 'danmaku:canvas' },
    );
});

function HpPips(props: { hp: number; maxHp: number }) {
    const size = 8;
    const gap = 3;
    const width = props.maxHp * (size + gap) - gap;
    return (
        <svg
            width={`${width}`}
            height={`${size}`}
            viewBox={`0 0 ${width} ${size}`}
            style={{ position: 'absolute', left: '50%', top: '100%', marginTop: '6px', transform: 'translateX(-50%)' }}
        >
            {Array.from({ length: props.maxHp }, (_, i) => (
                <rect
                    key={`${i}`}
                    x={`${i * (size + gap) + 0.75}`}
                    y="0.75"
                    width={`${size - 1.5}`}
                    height={`${size - 1.5}`}
                    rx="1.5"
                    fill={i < props.hp ? '#34d399' : 'rgba(15, 23, 42, 0.7)'}
                    stroke={i < props.hp ? '#a7f3d0' : 'rgba(148, 163, 184, 0.8)'}
                    strokeWidth="1.5"
                />
            ))}
        </svg>
    );
}

function DownLabel(props: { countdown: number }) {
    return (
        <div
            style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                padding: '6px 12px',
                borderRadius: '8px',
                background: 'rgba(76, 5, 25, 0.85)',
                border: '1px solid #fb7185',
                color: '#ffe4e6',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                fontFamily: 'system-ui, -apple-system, "Hiragino Sans", sans-serif',
                boxShadow: '0 0 16px rgba(244, 63, 94, 0.6)',
            }}
        >
            <div style={{ fontSize: '15px', fontWeight: '700' }}>撃墜</div>
            <div style={{ fontSize: '11px', marginTop: '2px' }}>{props.countdown} 秒後に復活</div>
        </div>
    );
}

function ShipShape(props: { mine: boolean }) {
    const glow = props.mine ? '#facc15' : '#38bdf8';
    return (
        <svg viewBox="0 0 32 32" width="100%" height="100%" style={{ overflow: 'visible' }}>
            <path d="M16 1 L19 11 L30 26 L30 30 L19 25 L16 29 L13 25 L2 30 L2 26 L13 11 Z" fill={glow} opacity="0.25" />
            <path d="M16 3 L18.5 12 L28 25 L28 28 L18.5 23.5 L16 27 L13.5 23.5 L4 28 L4 25 L13.5 12 Z" fill="#e2e8f0" />
            <path d="M16 6 L17.6 13 L16 21 L14.4 13 Z" fill={glow} />
            <path d="M13.5 23.5 L16 27 L18.5 23.5 Z" fill="#fb923c" />
        </svg>
    );
}

export default function PlayerView() {
    const ridden = ride.holder !== null;
    const down = player.local.shownDown;
    return (
        <div
            onUbiClick={() => ride.toggle()}
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                pointerEvents: 'auto',
                cursor: ride.isMine ? 'none' : ride.isRiddenByOther ? 'default' : 'pointer',
            }}
        >
            {!ridden && (
                <div
                    style={{
                        position: 'absolute',
                        inset: '-8px',
                        borderRadius: '50%',
                        border: '1.5px dashed rgba(125, 211, 252, 0.8)',
                    }}
                />
            )}
            <div style={{ width: '100%', height: '100%', opacity: down ? '0' : player.local.shown ? '1' : '0.2' }}>
                <ShipShape mine={ride.isMine} />
            </div>
            {ridden && !down && <HpPips hp={player.local.shownHp} maxHp={rules().maxHp} />}
            {down && <DownLabel countdown={player.local.countdown} />}
        </div>
    );
}
