/**
 * 仮想スティックの純計算。`Ubi` グローバルに触れないので単体テストできる。
 *
 * 入力は「スティック要素のローカル座標 + 要素サイズ」だけ。要素の画面上の位置や
 * ビューポートサイズを知らなくても完結するので、画面サイズや向きに依存しない。
 */

/** 中心からこの割合まではニュートラル扱い（置いた指のわずかなズレで動き出さないように）。 */
export const DEAD_ZONE = 0.28;
/** 8方向の境界。cos(67.5°)。軸成分がこれを超えた向きだけキーを立てる。 */
export const AXIS_THRESHOLD = 0.383;

export type StickInput = {
    /** 要素の左上を原点とするローカル座標。 */
    x: number;
    y: number;
    /** スティック要素の実サイズ。 */
    width: number;
    height: number;
};

export type StickState = {
    /** 中心からのノブ表示オフセット (px)。要素の縁で止める。 */
    knobX: number;
    knobY: number;
    /** 押されている方向キー。斜めは2キー同時（8方向）。 */
    codes: ReadonlySet<string>;
};

const NEUTRAL: StickState = { knobX: 0, knobY: 0, codes: new Set() };

/**
 * スティックのベクトル（半径で正規化した -1..1）から、押されている方向キーの集合を返す。
 * 軸ごとに閾値判定するので斜めは自然に2キー同時になる。
 */
export function directionsFor(nx: number, ny: number): ReadonlySet<string> {
    const codes = new Set<string>();
    if (Math.hypot(nx, ny) < DEAD_ZONE) return codes;
    if (nx > AXIS_THRESHOLD) codes.add('ArrowRight');
    if (nx < -AXIS_THRESHOLD) codes.add('ArrowLeft');
    if (ny > AXIS_THRESHOLD) codes.add('ArrowDown');
    if (ny < -AXIS_THRESHOLD) codes.add('ArrowUp');
    return codes;
}

/** ローカル座標からノブ位置と方向キーを求める。サイズ 0（レイアウト前）はニュートラル。 */
export function resolveStick(input: StickInput): StickState {
    const radius = Math.min(input.width, input.height) / 2;
    if (!(radius > 0)) return NEUTRAL;
    const dx = input.x - input.width / 2;
    const dy = input.y - input.height / 2;
    const distance = Math.hypot(dx, dy);
    // 指が枠外へ出てもノブは縁で止める（方向は維持されるので操作が途切れない）。
    const clamp = distance > radius ? radius / distance : 1;
    return {
        knobX: Math.round(dx * clamp),
        knobY: Math.round(dy * clamp),
        codes: directionsFor(dx / radius, dy / radius),
    };
}

/**
 * 直前に送ったキー集合との差分を求める。押し直し・離し漏れを防ぐため、
 * 送信は必ずこの差分だけに絞る。
 */
export function diffDirections(
    prev: ReadonlySet<string>,
    next: ReadonlySet<string>,
): { pressed: string[]; released: string[] } {
    return {
        pressed: [...next].filter((code) => !prev.has(code)),
        released: [...prev].filter((code) => !next.has(code)),
    };
}
