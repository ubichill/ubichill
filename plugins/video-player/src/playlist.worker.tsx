/**
 * video-player:playlist Worker — トラック一覧 UI。
 *
 * watchScope='parent' で screen の playlist / currentIndex を読み書きする。
 * 自身のローカル状態は持たない。
 */

import { PlaySmallIcon, TrashIcon } from './icons';
import type { Track } from './types';

const state = Ubi.state.define({
    playlist: Ubi.state.persistent([] as Track[]),
    currentIndex: Ubi.state.persistent(0),
});

const fmt = (sec: number): string => {
    if (!Number.isFinite(sec) || sec <= 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

const onSelectTrack = (i: number): void => {
    state.local.currentIndex = i;
};

const onRemoveTrack = (i: number): void => {
    const newList = state.local.playlist.filter((_, idx) => idx !== i);
    const newIdx =
        state.local.currentIndex >= newList.length ? Math.max(0, newList.length - 1) : state.local.currentIndex;
    state.local.playlist = newList;
    state.local.currentIndex = newIdx;
};

function render(): void {
    const playlist = state.local.playlist;
    const currentIndex = state.local.currentIndex;

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
                    Playlist ({playlist.length})
                </div>
                <div style={{ flex: '1', overflowY: 'auto', padding: '8px' }}>
                    {playlist.length === 0 ? (
                        <div style={{ padding: '24px', textAlign: 'center' }}>
                            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>No tracks</div>
                        </div>
                    ) : (
                        playlist.map((t, i) => (
                            <div
                                key={t.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '6px 8px',
                                    borderRadius: '6px',
                                    marginBottom: '4px',
                                    background: i === currentIndex ? 'rgba(0,122,255,0.2)' : 'transparent',
                                    cursor: 'pointer',
                                }}
                                onUbiClick={() => onSelectTrack(i)}
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
                                {i === currentIndex && (
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
                                    onUbiClick={() => onRemoveTrack(i)}
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

render();
