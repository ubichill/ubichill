// custom 指標。Prometheus の remote write では k6_ が前に付く（Counter は _total、Trend は _p95 など、native histogram なら _seconds）。
// 名前とタグは docs/operations/load-testing.md の表と Grafana のダッシュボードが参照するので、変えるときは両方を直す。
import { Counter, Trend } from 'k6/metrics';

/** 1 人目の cursor:move に入れた時刻が、2 人目に cursor:moved / cursors:moved で届くまで（同じ Pod の時計） */
export const cursorLatency = new Trend('ubichill_cursor_latency', true);
/** WebSocket を開き始めてから world:snapshot まで */
export const joinDuration = new Trend('ubichill_join_duration', true);
/** 利用者が始めてから（ログイン・部屋を作る/探す・参加情報）world:snapshot まで */
export const readyDuration = new Trend('ubichill_ready_duration', true);
/** 部屋に入れなかった。タグ stage = account / create / discover / ticket / join、reason */
export const joinFailures = new Counter('ubichill_join_failures');
/** 応答のある要求。タグ event = entity:create / entity:patch / state:update、result = ok / migrating / conflict / error / timeout */
export const requests = new Counter('ubichill_requests');
/** WebSocket の切断。タグ code（close code）、by = server（試験の途中に切られた）/ client（退室・入室の失敗で自分から閉じた） */
export const disconnects = new Counter('ubichill_disconnects');
/** 試験の途中に切られて繋ぎ直した（Host と同じく参加情報を取り直す）。タグ code */
export const reconnects = new Counter('ubichill_reconnects');
/** 知らせ。タグ kind = server:notice の kind / session_replaced / instance_closing */
export const notices = new Counter('ubichill_notices');
/** world:snapshot まで届いた人と、部屋を出た人（差が今いる人数） */
export const joined = new Counter('ubichill_joined');
export const left = new Counter('ubichill_left');
/** インスタンスの作成・削除。タグ op = create / delete、result = ok / rate_limited / not_found / error */
export const instanceOps = new Counter('ubichill_instance_ops');

/** 画面の体験の各段の時間。タグ step = login / home / render */
export const browserStep = new Trend('ubichill_browser_step_duration', true);
/** ログインの画面を開いてから描画まで */
export const browserJourney = new Trend('ubichill_browser_journey_duration', true);
/** 画面の体験の失敗。タグ step */
export const browserFailures = new Counter('ubichill_browser_failures');
