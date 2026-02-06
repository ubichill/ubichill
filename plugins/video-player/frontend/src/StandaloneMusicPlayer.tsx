'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    LoadingIcon,
    MusicNoteIcon,
    PauseIcon,
    PlayIcon,
    RepeatIcon,
    RepeatOneIcon,
    SkipNextIcon,
    SkipPrevIcon,
    VolumeHighIcon,
    VolumeLowIcon,
    VolumeMediumIcon,
    VolumeMuteIcon,
} from './icons';
import type { MusicPlayerState, Track } from './types';
import { DEFAULT_MUSIC_PLAYER_STATE } from './types';

// バックエンドAPIのベースURL
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface Props {
    initialState?: Partial<MusicPlayerState>;
    onStateChange?: (state: MusicPlayerState) => void;
}

export const StandaloneMusicPlayer: React.FC<Props> = ({ initialState, onStateChange }) => {
    const [state, setState] = useState<MusicPlayerState>({
        ...DEFAULT_MUSIC_PLAYER_STATE,
        ...initialState,
    });

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isLoadingTrack, setIsLoadingTrack] = useState(false);
    const [localTime, setLocalTime] = useState(0);
    const [isExpanded, setIsExpanded] = useState(false); // プレイリストの表示切り替えに使用
    const [currentLoadingId, setCurrentLoadingId] = useState<string | null>(null);
    const isLoadingRef = useRef(false);

    const currentTrack = state.playlist[state.currentIndex];

    // 状態を更新
    const updateState = useCallback(
        (updates: Partial<MusicPlayerState>) => {
            setState((prev) => {
                const newState = { ...prev, ...updates };
                onStateChange?.(newState);
                return newState;
            });
        },
        [onStateChange],
    );

    // 時間をフォーマット (MM:SS)
    const formatTime = (seconds: number): string => {
        if (!seconds || Number.isNaN(seconds) || seconds === 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // トラックのオーディオURLを取得して再生
    const loadAndPlayTrack = useCallback(
        async (trackId: string) => {
            // 既に同じトラックをロード中の場合はスキップ
            if (isLoadingRef.current && currentLoadingId === trackId) {
                console.log('Already loading this track, skipping');
                return;
            }

            isLoadingRef.current = true;
            setCurrentLoadingId(trackId);
            setIsLoadingTrack(true);

            try {
                // プロキシエンドポイントを使用（CORS回避・Range対応）
                const audioUrl = `${API_BASE}/api/stream/proxy/${trackId}`;

                if (audioRef.current) {
                    // 現在の再生を停止
                    audioRef.current.pause();

                    // 新しいソースを設定
                    audioRef.current.src = audioUrl;
                    audioRef.current.currentTime = 0; // 最初から再生

                    // canplaythrough イベントを待ってから再生
                    await new Promise<void>((resolve, reject) => {
                        const audio = audioRef.current;
                        if (!audio) {
                            reject(new Error('Audio element not available'));
                            return;
                        }

                        const onCanPlay = () => {
                            audio.removeEventListener('canplay', onCanPlay);
                            audio.removeEventListener('error', onError);
                            resolve();
                        };

                        const onError = (e: Event) => {
                            const target = e.target as HTMLAudioElement;
                            console.error('Audio load error:', target.error, target.error?.code, target.error?.message);
                            audio.removeEventListener('canplay', onCanPlay);
                            audio.removeEventListener('error', onError);
                            reject(
                                new Error(
                                    `Failed to load audio: ${target.error?.message || 'Unknown error'} (Code: ${target.error?.code})`,
                                ),
                            );
                        };

                        // canplayで十分（Rangeリクエストの場合、全体ダウンロードは待たないため）
                        audio.addEventListener('canplay', onCanPlay);
                        audio.addEventListener('error', onError);
                        audio.load();
                    });

                    // ロード完了後に再生
                    if (audioRef.current && state.isPlaying) {
                        await audioRef.current.play();
                    }
                }
            } catch (error) {
                console.error('Failed to load track:', error);
            } finally {
                setIsLoadingTrack(false);
                isLoadingRef.current = false;
            }
        },
        [currentLoadingId, state.isPlaying],
    );

    // 人気トラックを読み込む
    const loadPopularTracks = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/api/stream/popular`);
            if (!res.ok) throw new Error('Failed to fetch popular tracks');
            const tracks: Track[] = await res.json();

            updateState({ playlist: tracks });
        } catch (error) {
            console.error('Failed to load popular tracks:', error);
        }
    }, [updateState]);

    // 初期化時に人気トラックを読み込む
    useEffect(() => {
        if (state.playlist.length === 0) {
            loadPopularTracks();
        }
    }, [loadPopularTracks, state.playlist.length]);

    // currentTrackが変わった時のみオーディオを読み込む
    useEffect(() => {
        if (currentTrack && state.isPlaying) {
            loadAndPlayTrack(currentTrack.id);
        }
    }, [currentTrack?.id, loadAndPlayTrack, state.isPlaying, currentTrack]);

    // 再生/一時停止の状態を同期
    useEffect(() => {
        if (!audioRef.current || !currentTrack) return;
        if (isLoadingRef.current) return;

        if (state.isPlaying) {
            if (!audioRef.current.src || audioRef.current.src === '') {
                loadAndPlayTrack(currentTrack.id);
            } else {
                audioRef.current.play().catch((err) => {
                    if (err.name !== 'AbortError') console.error('Play error:', err);
                });
            }
        } else {
            audioRef.current.pause();
        }
    }, [state.isPlaying, currentTrack, loadAndPlayTrack]);

    // 音量を同期
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = state.volume;
        }
    }, [state.volume]);

    // 再生位置の更新
    const handleTimeUpdate = useCallback(() => {
        if (audioRef.current) {
            setLocalTime(audioRef.current.currentTime);
        }
    }, []);

    // トラック終了時
    const handleTrackEnded = useCallback(() => {
        if (state.loop === 'track') {
            if (audioRef.current) {
                audioRef.current.currentTime = 0;
                audioRef.current.play().catch(console.error);
            }
        } else {
            let nextIndex = state.currentIndex + 1;
            if (nextIndex >= state.playlist.length) {
                if (state.loop === 'playlist') {
                    nextIndex = 0;
                } else {
                    updateState({ isPlaying: false });
                    return;
                }
            }
            updateState({ currentIndex: nextIndex });
        }
    }, [state, updateState]);

    // トラック選択
    const handleSelectTrack = (index: number) => {
        updateState({ currentIndex: index, isPlaying: true });
    };

    // 再生/一時停止
    const togglePlay = () => {
        updateState({ isPlaying: !state.isPlaying });
    };

    // 前のトラック
    const playPrev = () => {
        const prevIndex = state.currentIndex > 0 ? state.currentIndex - 1 : state.playlist.length - 1;
        updateState({ currentIndex: prevIndex, isPlaying: true });
    };

    // 次のトラック
    const playNext = () => {
        const nextIndex = state.currentIndex < state.playlist.length - 1 ? state.currentIndex + 1 : 0;
        updateState({ currentIndex: nextIndex, isPlaying: true });
    };

    // ループモード切り替え
    const toggleLoop = () => {
        const modes: ('none' | 'playlist' | 'track')[] = ['none', 'playlist', 'track'];
        const currentModeIndex = modes.indexOf(state.loop);
        const nextMode = modes[(currentModeIndex + 1) % modes.length];
        updateState({ loop: nextMode });
    };

    // 音量変更
    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = Number.parseFloat(e.target.value);
        updateState({ volume: newVolume });
    };

    // シーク機能
    const handleSeek = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!audioRef.current || !currentTrack) return;

            const rect = e.currentTarget.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            // 0-1の範囲に制限
            const clampedPercent = Math.max(0, Math.min(1, percent));
            const newTime = clampedPercent * currentTrack.duration;

            audioRef.current.currentTime = newTime;
            setLocalTime(newTime);
        },
        [currentTrack],
    );

    const renderLoopIcon = () => {
        if (state.loop === 'track') return <RepeatOneIcon size={18} />;
        return <RepeatIcon size={18} />;
    };

    const renderVolumeIcon = () => {
        if (state.volume === 0) return <VolumeMuteIcon size={18} />;
        if (state.volume < 0.3) return <VolumeLowIcon size={18} />;
        if (state.volume < 0.7) return <VolumeMediumIcon size={18} />;
        return <VolumeHighIcon size={18} />;
    };

    return (
        <div className="music-player-container">
            {/* プレイリスト（展開時のみ表示） */}
            {isExpanded && (
                <div className="music-player__playlist-container">
                    <div className="music-player__playlist-header">
                        <span>プレイリスト</span>
                        <button type="button" className="music-player__close-btn" onClick={() => setIsExpanded(false)}>
                            ×
                        </button>
                    </div>
                    <div className="music-player__playlist">
                        {state.playlist.length === 0 ? (
                            <div className="music-player__loading">
                                <LoadingIcon size={24} />
                                <span>読み込み中...</span>
                            </div>
                        ) : (
                            state.playlist.map((track, index) => (
                                <div
                                    key={`${track.id}-${index}`}
                                    className={`music-player__playlist-item ${
                                        index === state.currentIndex ? 'music-player__playlist-item--active' : ''
                                    }`}
                                    onClick={() => handleSelectTrack(index)}
                                    role="button"
                                    tabIndex={0}
                                >
                                    <img src={track.thumbnail} alt="" className="music-player__playlist-thumb" />
                                    <div className="music-player__playlist-info">
                                        <div className="music-player__playlist-title">{track.title}</div>
                                        <div className="music-player__playlist-duration">
                                            {track.author} • {formatTime(track.duration)}
                                        </div>
                                    </div>
                                    {index === state.currentIndex && state.isPlaying && (
                                        <div className="music-player__playing-indicator">
                                            <div className="bar bar1"></div>
                                            <div className="bar bar2"></div>
                                            <div className="bar bar3"></div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* メインプレイヤーバー */}
            <div className="music-player-bar">
                {/* 非表示のaudio要素 */}
                {/* biome-ignore lint/a11y/useMediaCaption: Audio player only */}
                <audio
                    ref={audioRef}
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleTrackEnded}
                    crossOrigin="anonymous"
                    preload="auto"
                />

                {/* 左側: トラック情報 */}
                <div className="music-player__left">
                    {currentTrack ? (
                        <>
                            <img src={currentTrack.thumbnail} alt="" className="music-player__artwork" />
                            <div className="music-player__info">
                                <div className="music-player__title-text" title={currentTrack.title}>
                                    {isLoadingTrack ? '読み込み中...' : currentTrack.title}
                                </div>
                                <div className="music-player__artist-text" title={currentTrack.author}>
                                    {currentTrack.author}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="music-player__info-placeholder">
                            <MusicNoteIcon size={24} />
                            <span>No Music</span>
                        </div>
                    )}
                </div>

                {/* 中央: コントロールとシークバー */}
                <div className="music-player__center">
                    <div className="music-player__main-controls">
                        <button
                            type="button"
                            className={`music-player__icon-btn ${state.loop !== 'none' ? 'active' : ''}`}
                            onClick={toggleLoop}
                            title={`ループ: ${state.loop}`}
                        >
                            {renderLoopIcon()}
                        </button>
                        <button
                            type="button"
                            className="music-player__icon-btn"
                            onClick={playPrev}
                            disabled={state.playlist.length === 0}
                        >
                            <SkipPrevIcon size={24} />
                        </button>
                        <button
                            type="button"
                            className="music-player__play-circle-btn"
                            onClick={togglePlay}
                            disabled={state.playlist.length === 0}
                        >
                            {isLoadingTrack ? (
                                <LoadingIcon size={28} />
                            ) : state.isPlaying ? (
                                <PauseIcon size={28} color="#1e1b2d" />
                            ) : (
                                <PlayIcon size={28} color="#1e1b2d" />
                            )}
                        </button>
                        <button
                            type="button"
                            className="music-player__icon-btn"
                            onClick={playNext}
                            disabled={state.playlist.length === 0}
                        >
                            <SkipNextIcon size={24} />
                        </button>
                        <div className="music-player__time-display">{formatTime(localTime)}</div>
                    </div>

                    <div className="music-player__progress-container" onClick={handleSeek}>
                        <div className="music-player__progress-bg">
                            <div
                                className="music-player__progress-fill"
                                style={{
                                    width: `${
                                        currentTrack && currentTrack.duration > 0
                                            ? (localTime / currentTrack.duration) * 100
                                            : 0
                                    }%`,
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* 右側: 音量とその他 */}
                <div className="music-player__right">
                    <div className="music-player__volume-control">
                        <button type="button" className="music-player__icon-btn">
                            {renderVolumeIcon()}
                        </button>
                        <input
                            type="range"
                            className="music-player__volume-slider"
                            min="0"
                            max="1"
                            step="0.01"
                            value={state.volume}
                            onChange={handleVolumeChange}
                        />
                    </div>
                    <div className="music-player__divider"></div>
                    <button
                        type="button"
                        className={`music-player__icon-btn ${isExpanded ? 'active' : ''}`}
                        onClick={() => setIsExpanded(!isExpanded)}
                        title="プレイリスト"
                    >
                        <MusicNoteIcon size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StandaloneMusicPlayer;
