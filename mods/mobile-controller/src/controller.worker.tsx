/**
 * mobile-controller:controller Worker — タッチ/ペン環境向けの仮想パッド。
 *
 * **責務:** 矢印キー/Zキー相当のボタンUIを描画し、押下/解放を同じEntity上の
 * 他コンポーネント（danmaku:player 等）へ `mobile:key_down` / `mobile:key_up`
 * として通知するだけ。自機の移動ロジックやcollider判定は一切持たない。
 *
 * `config.overlay: true` により transform.x/y はワールド座標ではなく画面（ビューポート）座標
 * として解釈される（Host: EntityRenderer + InstanceRenderer の overlay レイヤー）。
 * 自機がワールド内を移動してもパッドは画面上の同じ位置に留まる。
 * y（および x）が負値の場合は画面下端（右端）からの距離として解釈されるので、
 * 縦の低い横画面でも画面外に出ないよう既定値は下端基準にしている。
 *
 * 使い方: World Editor で danmaku:player と同じ Entity にこのコンポーネントを
 * 追加する（scope: 'subtree' で同Entity上のComponentへ配送するため）。
 * `Ubi.hasCoarsePointer` が false（マウス/トラックパッド環境）のときは何も描画しない。
 */
import type { ComponentConfig } from '@ubichill/sdk';
import { MobileControllerEvents } from './events';

export const config: ComponentConfig = {
    defaultTransform: { x: 24, y: -160, z: 2000, w: 240, h: 140 },
    capabilities: ['event:emit', 'ui:render', 'scene:read', 'scene:update'],
    overlay: true,
    description: 'タッチ/ペン環境で自機を操作する画面固定の仮想パッド（矢印キー + 射撃ボタン相当）。',
};

const controller = Ubi.state.define({
    // 送信先Component型。Inspectorで変更可能（同じEntity上に配置し、scope: 'subtree'で届く相手を指定する）。
    targetType: Ubi.state.sync('danmaku:player', {
        label: '操作対象のComponent型',
        help: '矢印キー相当のイベントを送る先 (例: danmaku:player)。同じEntity上に配置すること。',
    }),
});

/**
 * ボタンごとに「今押されている pointerId」を覚えておく。
 * 同じボタンを複数の指で触ったり、キーボード側とは別チャネルであることを保証するために、
 * 押下数(参照カウント)ではなく pointerId の集合で管理する。
 * 最初の1本で press、最後の1本が離れたときだけ release を送る。
 */
const activePointers = new Map<string, Set<number>>();

function press(code: string, pointerId: number): void {
    const set = activePointers.get(code) ?? new Set<number>();
    const wasEmpty = set.size === 0;
    set.add(pointerId);
    activePointers.set(code, set);
    if (!wasEmpty) return;
    MobileControllerEvents.emit(
        'mobile:key_down',
        { code },
        { scope: 'subtree', targetType: controller.local.targetType },
    );
}
function release(code: string, pointerId: number): void {
    const set = activePointers.get(code);
    if (!set?.delete(pointerId) || set.size > 0) return;
    MobileControllerEvents.emit(
        'mobile:key_up',
        { code },
        { scope: 'subtree', targetType: controller.local.targetType },
    );
}

const BUTTON_BASE_STYLE = {
    position: 'absolute' as const,
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(30,30,34,0.55)',
    color: 'rgba(255,255,255,0.95)',
    fontSize: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    userSelect: 'none' as const,
    touchAction: 'none' as const,
    pointerEvents: 'auto' as const,
};

type DirectionButtonProps = {
    code: string;
    label: string;
    style: Record<string, string | number>;
};

/** VNodeRenderer が onUbiPointerDown/Up 等に渡す detail の型（PointerEvent由来）。 */
function pointerIdOf(detail: unknown): number {
    return typeof detail === 'object' && detail !== null && 'pointerId' in detail
        ? Number((detail as { pointerId: unknown }).pointerId)
        : 0;
}

function DirectionButton({ code, label, style }: DirectionButtonProps) {
    return (
        <button
            type="button"
            onUbiPointerDown={(detail: unknown) => press(code, pointerIdOf(detail))}
            onUbiPointerUp={(detail: unknown) => release(code, pointerIdOf(detail))}
            onUbiPointerCancel={(detail: unknown) => release(code, pointerIdOf(detail))}
            onUbiPointerLeave={(detail: unknown) => release(code, pointerIdOf(detail))}
            style={{ ...BUTTON_BASE_STYLE, ...style }}
        >
            {label}
        </button>
    );
}

export default function MobileControllerView() {
    if (!Ubi.hasCoarsePointer) return null;

    return (
        <div style={{ position: 'absolute', inset: '0', pointerEvents: 'none' }}>
            {/* D-pad: 左側に十字配置 */}
            <DirectionButton code="ArrowUp" label="▲" style={{ left: '48px', top: '0px' }} />
            <DirectionButton code="ArrowDown" label="▼" style={{ left: '48px', top: '96px' }} />
            <DirectionButton code="ArrowLeft" label="◀" style={{ left: '0px', top: '48px' }} />
            <DirectionButton code="ArrowRight" label="▶" style={{ left: '96px', top: '48px' }} />

            {/* 射撃ボタン: 右側 */}
            <DirectionButton
                code="KeyZ"
                label="Z"
                style={{ left: '176px', top: '48px', width: '56px', height: '56px' }}
            />
        </div>
    );
}
