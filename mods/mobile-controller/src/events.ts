/**
 * mobile-controller mod が送信するイベントのスキーマ。
 *
 * 受信側 (danmaku:player 等) は import せず、同じ shape ('code: string') の
 * イベントを自分の events.ts に定義して `.on()` する（zero-trust: mod は
 * @ubichill/sdk 以外の他mod実装に依存しない。文字列イベント名だけが規約）。
 */
export const MobileControllerEvents = Ubi.event.define<{
    'mobile:key_down': { code: string };
    'mobile:key_up': { code: string };
}>();
