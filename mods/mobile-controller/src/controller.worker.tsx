/**
 * mobile-controller:controller Worker — タッチ/ペン環境向けの画面固定コントローラ。
 *
 * **責務:** 仮想スティック（左下）とアクションボタン（右下）を描画し、押下/解放を同じ Entity 上の
 * 他コンポーネント（danmaku:player 等）へ `mobile:key_down` / `mobile:key_up` として通知するだけ。
 * 移動ロジックや collider 判定は一切持たない。
 *
 * **キー入力として送る理由:** 受け手は既にキーボード操作を実装しているので、スティックの向きを
 * 8方向のキー（Arrow*）に変換して送れば、受け手側は改修なしでタッチ操作に対応できる。
 *
 * `config.overlay: 'fill'` により、Host は画面全体を覆う HUD レイヤーとして描画する。
 * そのため 1 Component で「左下にスティック・右下にボタン」のように画面の複数箇所へ配置でき、
 * 画面サイズ（縦/横/タブレット）にも依存しない。
 *
 * 使い方: World Editor で操作したい Component と同じ Entity にこれを追加する
 * （`scope: 'subtree'` で同 Entity 上の Component へ配送するため）。
 * `Ubi.hasCoarsePointer` が false（マウス/トラックパッド環境）のときは何も描画しない。
 */
import type { ComponentConfig, UiPointerActionDetail } from 'ubichill';
import { MobileControllerEvents } from './events';
import { diffDirections, resolveStick } from './stick';

export const config: ComponentConfig = {
    defaultTransform: { x: 0, y: 0, z: 2000 },
    capabilities: ['event:emit', 'ui:render', 'scene:read', 'scene:update'],
    // 画面全体を覆う HUD レイヤー（スティックは左下・ボタンは右下に自前で配置する）。
    overlay: 'fill',
    description: 'タッチ/ペン環境で操作する画面固定コントローラ（仮想スティック + アクションボタン）。',
};

const STICK_SIZE = 132;
const KNOB_SIZE = 56;
const ACTION_CODE = 'KeyZ';

const controller = Ubi.state.define({
    // 送信先Component型。Inspectorで変更可能（同じEntity上に配置し、scope: 'subtree'で届く相手を指定する）。
    targetType: Ubi.state.sync('danmaku:player', {
        label: '操作対象のComponent型',
        help: '矢印キー相当のイベントを送る先 (例: danmaku:player)。同じEntity上に配置すること。',
    }),
    // ノブの表示位置（中心からのオフセット px）。同期不要なローカル状態にすることで、
    // ドラッグ中の再描画がネットワークに漏れない（素の値を渡すと local スコープになる）。
    knobX: 0,
    knobY: 0,
});

function emitDown(code: string): void {
    MobileControllerEvents.emit(
        'mobile:key_down',
        { code },
        { scope: 'subtree', targetType: controller.local.targetType },
    );
}
function emitUp(code: string): void {
    MobileControllerEvents.emit(
        'mobile:key_up',
        { code },
        { scope: 'subtree', targetType: controller.local.targetType },
    );
}

/** 直前に送ったキー集合との差分だけを key_down / key_up として送る。 */
function syncDirections(next: ReadonlySet<string>): void {
    const { pressed, released } = diffDirections(activeDirections, next);
    for (const code of released) emitUp(code);
    for (const code of pressed) emitDown(code);
    activeDirections = next;
}

let activeDirections: ReadonlySet<string> = new Set();
/** スティックを操作している指。別の指が触れても取り違えないよう固定する。 */
let stickPointerId: number | null = null;
/** アクションボタンに触れている指（複数タッチでも最後の1本が離れるまで押下扱い）。 */
const actionPointers = new Set<number>();

function releaseStick(): void {
    stickPointerId = null;
    controller.local.knobX = 0;
    controller.local.knobY = 0;
    syncDirections(new Set());
}

/** スティック領域内のローカル座標から、ノブ位置と方向キーを更新する。 */
function updateStick(detail: UiPointerActionDetail): void {
    const next = resolveStick(detail);
    controller.local.knobX = next.knobX;
    controller.local.knobY = next.knobY;
    syncDirections(next.codes);
}

function Stick() {
    return (
        <div
            onUbiPointerDown={(detail: UiPointerActionDetail) => {
                if (stickPointerId !== null) return;
                stickPointerId = detail.pointerId;
                updateStick(detail);
            }}
            // タッチ/ペンは pointerdown した要素へ暗黙的にキャプチャされるので、
            // 指が枠外へ出ても move/up はこの要素に届き続ける。
            onUbiPointerMove={(detail: UiPointerActionDetail) => {
                if (stickPointerId !== detail.pointerId) return;
                updateStick(detail);
            }}
            onUbiPointerUp={(detail: UiPointerActionDetail) => {
                if (stickPointerId === detail.pointerId) releaseStick();
            }}
            onUbiPointerCancel={(detail: UiPointerActionDetail) => {
                if (stickPointerId === detail.pointerId) releaseStick();
            }}
            style={{
                position: 'absolute',
                left: '24px',
                bottom: '24px',
                width: `${STICK_SIZE}px`,
                height: `${STICK_SIZE}px`,
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.5)',
                backgroundColor: 'rgba(20,20,26,0.4)',
                boxShadow: 'inset 0 2px 12px rgba(0,0,0,0.45)',
                touchAction: 'none',
                userSelect: 'none',
                pointerEvents: 'auto',
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: `${KNOB_SIZE}px`,
                    height: `${KNOB_SIZE}px`,
                    marginLeft: `${-KNOB_SIZE / 2}px`,
                    marginTop: `${-KNOB_SIZE / 2}px`,
                    // ノブ自身はヒットテスト対象にしない（常に親のスティック領域で座標を取る）。
                    pointerEvents: 'none',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(240,244,255,0.92)',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    transform: `translate(${controller.local.knobX}px, ${controller.local.knobY}px)`,
                }}
            />
        </div>
    );
}

function ActionButton() {
    const release = (detail: UiPointerActionDetail) => {
        if (!actionPointers.delete(detail.pointerId) || actionPointers.size > 0) return;
        emitUp(ACTION_CODE);
    };
    return (
        <button
            type="button"
            onUbiPointerDown={(detail: UiPointerActionDetail) => {
                const wasEmpty = actionPointers.size === 0;
                actionPointers.add(detail.pointerId);
                if (wasEmpty) emitDown(ACTION_CODE);
            }}
            onUbiPointerUp={release}
            onUbiPointerCancel={release}
            onUbiPointerLeave={release}
            style={{
                position: 'absolute',
                right: '32px',
                bottom: '48px',
                width: '76px',
                height: '76px',
                borderRadius: '50%',
                border: '2px solid rgba(255,255,255,0.85)',
                backgroundColor: 'rgba(56,120,220,0.62)',
                color: 'rgba(255,255,255,0.98)',
                fontSize: '22px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: 'none',
                userSelect: 'none',
                pointerEvents: 'auto',
                boxShadow: '0 3px 12px rgba(0,0,0,0.45)',
            }}
        >
            Z
        </button>
    );
}

export default function MobileControllerView() {
    if (!Ubi.hasCoarsePointer) return null;

    return (
        <div style={{ position: 'absolute', inset: '0', pointerEvents: 'none' }}>
            <Stick />
            <ActionButton />
        </div>
    );
}
