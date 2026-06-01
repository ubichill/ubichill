/**
 * video-player:playlist Worker — プレイリストの一意な所有者。
 *
 * 状態: playlist + currentIndex のみ保持 (entity.data)。
 * Worker 間通信は `VPEvents` に閉じた型付き emit/on のみ。
 */

import { VPEvents, VPTarget } from './events';
import { PlaySmallIcon, TrashIcon } from './icons';
import type { LoopMode, Track } from './types';

const state = Ubi.state.define({
    playlist: Ubi.state.sync([] as Track[]),
    currentIndex: Ubi.state.sync(0),
});

const fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

/** 現トラックを siblings に通知。 */
function emitCurrent(): void {
    const list = state.local.playlist;
    const idx = state.local.currentIndex;
    const track = list[idx] ?? null;
    VPEvents.emit('vp:track:current', { track, index: idx, total: list.length }, VPTarget.siblings);
}

function addTrack(track: Track): void {
    state.local.playlist = [...state.local.playlist, track];
}

function selectTrack(i: number): void {
    if (i < 0 || i >= state.local.playlist.length) return;
    state.local.currentIndex = i;
}

function removeTrack(i: number): void {
    const newList = state.local.playlist.filter((_, idx) => idx !== i);
    // 削除位置に応じて currentIndex を補正:
    //  - 削除位置が currentIndex より前: 1 つ前にシフト
    //  - 削除位置が currentIndex (= 今再生中): その位置に新トラックが繰り上がってくるので維持
    //  - 削除位置が currentIndex より後: 変化なし
    //  - 最後に範囲外なら末尾にクランプ
    state.batch(() => {
        let newIdx = state.local.currentIndex;
        if (i < newIdx) newIdx -= 1;
        if (newIdx >= newList.length) newIdx = Math.max(0, newList.length - 1);
        state.local.playlist = newList;
        state.local.currentIndex = newIdx;
    });
}

function nextTrack(loop: LoopMode, shuffle: boolean): void {
    const len = state.local.playlist.length;
    if (len === 0) return;
    if (loop === 'one') {
        // 同じトラックを emit し直して screen に load を促す
        emitCurrent();
        return;
    }
    if (shuffle) {
        state.local.currentIndex = Math.floor(Math.random() * len);
        return;
    }
    const cur = state.local.currentIndex;
    if (cur + 1 < len) {
        state.local.currentIndex = cur + 1;
        return;
    }
    // 末尾に到達: loop='all' のみ先頭に戻る。'none' は停止 (controls 側で isPlaying=false に)
    if (loop === 'all') {
        state.local.currentIndex = 0;
    } else {
        VPEvents.emit('vp:playback:stop', {}, VPTarget.controls);
    }
}

function prevTrack(): void {
    const len = state.local.playlist.length;
    if (len === 0) return;
    state.local.currentIndex = state.local.currentIndex > 0 ? state.local.currentIndex - 1 : len - 1;
}

state.onChange('playlist', emitCurrent);
state.onChange('currentIndex', emitCurrent);

function render(): void {
    const list = state.local.playlist;
    const cur = state.local.currentIndex;
    Ubi.ui.render(
        () => (
            <div
                style={{
                    position: 'absolute',
                    inset: '0',
                    background: '#1a1a1a',
                    borderRadius: '12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                    userSelect: 'none',
                    pointerEvents: 'auto',
                }}
            >
                <div
                    style={{
                        padding: '8px 12px',
                        borderBottom: '1px solid rgba(255,255,255,0.1)',
                        fontSize: '12px',
                        fontWeight: '600',
                        color: '#fff',
                    }}
                >
                    Playlist ({list.length})
                </div>
                <div style={{ flex: '1', overflowY: 'auto', padding: '8px' }}>
                    {list.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center' }}>
                            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>No tracks</div>
                        </div>
                    ) : (
                        list.map((t, i) => (
                            <div
                                key={`${t.id}-${i}`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    marginBottom: '4px',
                                    background: i === cur ? 'rgba(0,122,255,0.2)' : 'transparent',
                                    cursor: 'pointer',
                                }}
                                onUbiClick={() => selectTrack(i)}
                            >
                                <img
                                    src={t.thumbnail}
                                    alt=""
                                    style={{
                                        width: '32px',
                                        height: '32px',
                                        borderRadius: '4px',
                                        objectFit: 'cover',
                                    }}
                                />
                                <div style={{ flex: '1', minWidth: '0' }}>
                                    <div
                                        style={{
                                            fontSize: '11px',
                                            fontWeight: '500',
                                            color: '#fff',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                        }}
                                    >
                                        <span
                                            style={{
                                                display: 'inline-block',
                                                width: '6px',
                                                height: '6px',
                                                borderRadius: '50%',
                                                background: t.mode === 'live' ? '#ff4444' : '#4444ff',
                                                marginRight: '5px',
                                                verticalAlign: 'middle',
                                            }}
                                        />
                                        {t.title}
                                    </div>
                                    <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)' }}>
                                        {t.duration > 0 ? fmt(t.duration) : t.mode === 'live' ? 'LIVE' : '--:--'}
                                    </div>
                                </div>
                                {i === cur && (
                                    <span style={{ color: '#007aff', flexShrink: '0' }}>
                                        <PlaySmallIcon />
                                    </span>
                                )}
                                <button
                                    type="button"
                                    style={{
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'rgba(255,255,255,0.6)',
                                        cursor: 'pointer',
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        display: 'flex',
                                        alignItems: 'center',
                                    }}
                                    onUbiClick={() => removeTrack(i)}
                                >
                                    <TrashIcon size={14} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        ),
        'playlist',
    );
}

state.onChange('playlist', render);
state.onChange('currentIndex', render);

// ── イベント受信 ──────────────────────────────────────
VPEvents.on('vp:track:add', ({ track }) => addTrack(track));
VPEvents.on('vp:track:remove', ({ index }) => removeTrack(index));
VPEvents.on('vp:track:next', ({ loop, shuffle }) => nextTrack(loop, shuffle));
VPEvents.on('vp:track:prev', () => prevTrack());

render();
// 起動時に siblings に通知 (siblings の起動順に依存しないよう少し遅延)
queueMicrotask(emitCurrent);
