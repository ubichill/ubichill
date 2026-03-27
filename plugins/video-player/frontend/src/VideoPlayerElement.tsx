'use client';

import type { UbiEntityContext } from '@ubichill/sdk/ui';
import { UbiWidget } from '@ubichill/sdk/ui';
import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Root } from 'react-dom/client';
import { createRoot } from 'react-dom/client';
import {
    FullscreenExitIcon,
    FullscreenIcon,
    ListIcon,
    PauseIcon,
    PlayIcon,
    RepeatIcon,
    RepeatOneIcon,
    ShuffleIcon,
    SkipNextIcon,
    SkipPrevIcon,
    VideoIcon,
    VolumeHighIcon,
    VolumeLowIcon,
    VolumeMediumIcon,
    VolumeMuteIcon,
} from './icons';
import { PlaylistPanel } from './PlaylistPanel';
import { DEFAULT_LOFI_PLAYLIST } from './playlists';
import styles from './styles.module.css';
import type { MusicPlayerState, Track } from './types';
import { getVideoPlayerApiBase } from './utils/apiConfig';

// ============================================
// React コンテンツ（context を props で受け取る）
// ============================================

const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const VideoPlayerContent: React.FC<{ ctx: UbiEntityContext<MusicPlayerState> }> = ({ ctx }) => {
    const { entity, isLocked, patchEntity, socket } = ctx;
    const { data } = entity;
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const [apiBase] = useState(() => getVideoPlayerApiBase());
    const hlsRef = useRef<Hls | null>(null);
    const dataRef = useRef(data);
    const updateRef = useRef(patchEntity);
    const [localTime, setLocalTime] = useState(data.currentTime);
    const [showVideo, setShowVideo] = useState(false);
    const [isLoadingTrack, setIsLoadingTrack] = useState(false);
    const [showPlaylist, setShowPlaylist] = useState(true);
    const [videoSize, setVideoSize] = useState<'small' | 'medium' | 'large'>('small');

    const currentTrack = data.playlist[data.currentIndex];

    const update = useCallback(
        (patch: Partial<{ data: MusicPlayerState }>) => {
            patchEntity(patch as Parameters<typeof patchEntity>[0]);
        },
        [patchEntity],
    );

    // 最新の data と update を ref に保持
    useEffect(() => {
        dataRef.current = data;
        updateRef.current = patchEntity;
    });

    // デフォルトプレイリストの初期化
    useEffect(() => {
        const currentData = dataRef.current;
        const currentUpdate = updateRef.current;
        if (currentData.playlist.length === 0 && DEFAULT_LOFI_PLAYLIST.length > 0) {
            currentUpdate({ data: { ...currentData, playlist: DEFAULT_LOFI_PLAYLIST } });
        }
    }, []);

    // HLS クリーンアップ
    useEffect(() => {
        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
        };
    }, []);

    // プレイヤー状態の同期（WebSocket で受信）
    useEffect(() => {
        if (!socket) return;

        const handleSync = (syncData: { currentIndex: number; isPlaying: boolean; currentTime: number }) => {
            const currentData = dataRef.current;
            const currentUpdate = updateRef.current;

            currentUpdate({
                data: {
                    ...currentData,
                    currentIndex: syncData.currentIndex,
                    isPlaying: syncData.isPlaying,
                },
            });

            if (videoRef.current && syncData.currentTime !== undefined) {
                videoRef.current.currentTime = syncData.currentTime;
            }
        };

        socket.on('video-player:sync', handleSync as (...args: unknown[]) => void);
        return () => socket.off('video-player:sync', handleSync as (...args: unknown[]) => void);
    }, [socket]);

    // トラックの動画URLを設定
    const loadTrackVideo = useCallback(
        async (trackId: string, mode: 'live' | 'video' = 'video') => {
            const endpoint = mode === 'live' ? 'live' : 'video';
            const videoUrl = `${apiBase}/${endpoint}/${trackId}`;

            setIsLoadingTrack(true);
            try {
                if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                }

                if (videoRef.current) {
                    if (mode === 'video') {
                        videoRef.current.src = videoUrl;
                        videoRef.current.load();
                        if (data.isPlaying) {
                            videoRef.current.play().catch(console.error);
                        }
                        setIsLoadingTrack(false);
                        return;
                    }

                    if (Hls.isSupported()) {
                        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
                        hlsRef.current = hls;
                        hls.loadSource(videoUrl);
                        hls.attachMedia(videoRef.current);
                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            if (data.isPlaying && videoRef.current) {
                                videoRef.current.play().catch(console.error);
                            }
                        });
                        hls.on(Hls.Events.ERROR, (_event, errorData) => {
                            if (errorData.fatal) {
                                hls.destroy();
                            }
                        });
                    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                        videoRef.current.src = videoUrl;
                        if (data.isPlaying) {
                            await videoRef.current.play();
                        }
                    }
                }
            } catch (error) {
                console.error('[VideoPlayer] 動画読み込みエラー:', error);
            } finally {
                setIsLoadingTrack(false);
            }
        },
        [data.isPlaying, apiBase],
    );

    const loadedTrackIdRef = useRef<string | null>(null);

    useEffect(() => {
        if (currentTrack && data.isPlaying && loadedTrackIdRef.current !== currentTrack.id) {
            loadedTrackIdRef.current = currentTrack.id;
            loadTrackVideo(currentTrack.id, currentTrack.mode);
        }
    }, [currentTrack, data.isPlaying, loadTrackVideo]);

    useEffect(() => {
        if (!videoRef.current || !currentTrack) return;
        if (data.isPlaying) {
            videoRef.current.play().catch(console.error);
        } else {
            videoRef.current.pause();
        }
    }, [data.isPlaying, currentTrack]);

    const [localVolume, setLocalVolume] = useState(0.5);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = localVolume;
        }
    }, [localVolume]);

    const handleTimeUpdate = useCallback(() => {
        if (videoRef.current) {
            setLocalTime(videoRef.current.currentTime);
        }
    }, []);

    const handleTrackEnded = useCallback(() => {
        if (data.loop === 'track') {
            if (videoRef.current) {
                videoRef.current.currentTime = 0;
                videoRef.current.play().catch(console.error);
            }
        } else {
            let nextIndex = data.currentIndex + 1;
            if (nextIndex >= data.playlist.length) {
                if (data.loop === 'playlist') {
                    nextIndex = 0;
                } else {
                    update({ data: { ...data, isPlaying: false } });
                    return;
                }
            }
            update({ data: { ...data, currentIndex: nextIndex } });
        }
    }, [data, update]);

    const togglePlay = () => {
        const newState = { ...data, isPlaying: !data.isPlaying };
        update({ data: newState });
        if (socket && currentTrack) {
            socket.emit('video-player:sync', {
                currentIndex: data.currentIndex,
                isPlaying: newState.isPlaying,
                currentTime: localTime,
            });
        }
    };

    const playPrev = () => {
        const prevIndex = data.currentIndex > 0 ? data.currentIndex - 1 : data.playlist.length - 1;
        update({ data: { ...data, currentIndex: prevIndex } });
        if (socket) {
            socket.emit('video-player:sync', { currentIndex: prevIndex, isPlaying: data.isPlaying, currentTime: 0 });
        }
    };

    const playNext = () => {
        const nextIndex = data.currentIndex < data.playlist.length - 1 ? data.currentIndex + 1 : 0;
        update({ data: { ...data, currentIndex: nextIndex } });
        if (socket) {
            socket.emit('video-player:sync', { currentIndex: nextIndex, isPlaying: data.isPlaying, currentTime: 0 });
        }
    };

    const toggleLoop = () => {
        const modes: ('none' | 'playlist' | 'track')[] = ['none', 'playlist', 'track'];
        const nextMode = modes[(modes.indexOf(data.loop) + 1) % modes.length];
        update({ data: { ...data, loop: nextMode } });
    };

    const toggleShuffle = () => {
        update({ data: { ...data, shuffle: !data.shuffle } });
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalVolume(Number.parseFloat(e.target.value));
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!videoRef.current || !currentTrack) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const newTime = ((e.clientX - rect.left) / rect.width) * currentTrack.duration;
        videoRef.current.currentTime = newTime;
        setLocalTime(newTime);
    };

    const handleSelectTrack = (index: number) => {
        update({ data: { ...data, currentIndex: index, isPlaying: true } });
        if (socket) {
            socket.emit('video-player:sync', { currentIndex: index, isPlaying: true, currentTime: 0 });
        }
    };

    const handleRemoveTrack = (index: number) => {
        const newPlaylist = [...data.playlist];
        newPlaylist.splice(index, 1);
        let newIndex = data.currentIndex;
        if (index < data.currentIndex) newIndex = Math.max(0, newIndex - 1);
        else if (index === data.currentIndex && newIndex >= newPlaylist.length)
            newIndex = Math.max(0, newPlaylist.length - 1);
        update({ data: { ...data, playlist: newPlaylist, currentIndex: newIndex } });
    };

    const handleAddTrack = (track: { id: string; title: string; thumbnail: string; duration: number }) => {
        const newTrack: Track = { ...track, mode: 'video' };
        update({ data: { ...data, playlist: [...data.playlist, newTrack] } });
    };

    if (isLocked) return null;

    return (
        <div className={styles.videoPlayerContainer}>
            <div className={styles.mainContent}>
                <div className={styles.playerSection}>
                    {showVideo && currentTrack && (
                        <div className={`${styles.videoDisplay} ${styles[videoSize]}`}>
                            {/* biome-ignore lint/a11y/useMediaCaption: Visualizer only */}
                            <video
                                ref={videoRef}
                                className={styles.videoElement}
                                onTimeUpdate={handleTimeUpdate}
                                onEnded={handleTrackEnded}
                                controls={false}
                                autoPlay={false}
                            />
                        </div>
                    )}
                    {!showVideo && (
                        // biome-ignore lint/a11y/useMediaCaption: Visualizer only
                        <video
                            ref={videoRef}
                            style={{ display: 'none' }}
                            onTimeUpdate={handleTimeUpdate}
                            onEnded={handleTrackEnded}
                            autoPlay={false}
                        />
                    )}

                    <div className={styles.playerControl}>
                        <div
                            className={styles.progressContainer}
                            onClick={handleSeek}
                            role="slider"
                            tabIndex={0}
                            aria-valuenow={localTime}
                            aria-valuemin={0}
                            aria-valuemax={currentTrack?.duration || 0}
                        >
                            <div
                                className={styles.progressBar}
                                style={{ width: currentTrack ? `${(localTime / currentTrack.duration) * 100}%` : '0%' }}
                            />
                        </div>

                        <div className={styles.controlRow}>
                            <div className={styles.trackInfo}>
                                {currentTrack && (
                                    <>
                                        <img src={currentTrack.thumbnail} alt="" className={styles.trackThumb} />
                                        <div className={styles.trackText}>
                                            <div className={styles.trackTitle}>{currentTrack.title}</div>
                                            <div className={styles.trackTime}>
                                                {formatTime(localTime)} / {formatTime(currentTrack.duration)}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className={styles.playControls}>
                                <button
                                    type="button"
                                    className={styles.controlBtn}
                                    onClick={playPrev}
                                    disabled={data.playlist.length === 0}
                                >
                                    <SkipPrevIcon size={18} />
                                </button>
                                <button
                                    type="button"
                                    className={styles.playBtn}
                                    onClick={togglePlay}
                                    disabled={data.playlist.length === 0 || isLoadingTrack}
                                >
                                    {data.isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
                                </button>
                                <button
                                    type="button"
                                    className={styles.controlBtn}
                                    onClick={playNext}
                                    disabled={data.playlist.length === 0}
                                >
                                    <SkipNextIcon size={18} />
                                </button>
                            </div>

                            <div className={styles.extraControls}>
                                <button
                                    type="button"
                                    className={`${styles.controlBtn} ${data.shuffle ? styles.active : ''}`}
                                    onClick={toggleShuffle}
                                >
                                    <ShuffleIcon size={16} />
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.controlBtn} ${data.loop !== 'none' ? styles.active : ''}`}
                                    onClick={toggleLoop}
                                >
                                    {data.loop === 'track' ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
                                </button>
                                <button type="button" className={styles.controlBtn}>
                                    {localVolume === 0 ? (
                                        <VolumeMuteIcon size={16} />
                                    ) : localVolume < 0.3 ? (
                                        <VolumeLowIcon size={16} />
                                    ) : localVolume < 0.7 ? (
                                        <VolumeMediumIcon size={16} />
                                    ) : (
                                        <VolumeHighIcon size={16} />
                                    )}
                                </button>
                                <input
                                    type="range"
                                    className={styles.volumeControl}
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={localVolume}
                                    onChange={handleVolumeChange}
                                />
                                {currentTrack && (
                                    <>
                                        <button
                                            type="button"
                                            className={`${styles.controlBtn} ${showVideo ? styles.active : ''}`}
                                            onClick={() => setShowVideo(!showVideo)}
                                        >
                                            <VideoIcon size={16} />
                                        </button>
                                        {showVideo && (
                                            <button
                                                type="button"
                                                className={styles.controlBtn}
                                                onClick={() => {
                                                    setVideoSize((prev) =>
                                                        prev === 'small'
                                                            ? 'medium'
                                                            : prev === 'medium'
                                                              ? 'large'
                                                              : 'small',
                                                    );
                                                }}
                                                title={`動画サイズ: ${videoSize === 'small' ? '小' : videoSize === 'medium' ? '中' : '大'}`}
                                            >
                                                {videoSize === 'large' ? (
                                                    <FullscreenExitIcon size={16} />
                                                ) : (
                                                    <FullscreenIcon size={16} />
                                                )}
                                            </button>
                                        )}
                                    </>
                                )}
                                <button
                                    type="button"
                                    className={`${styles.controlBtn} ${showPlaylist ? styles.active : ''}`}
                                    onClick={() => setShowPlaylist(!showPlaylist)}
                                    title="プレイリストを表示/非表示"
                                >
                                    <ListIcon size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {showPlaylist && (
                    <PlaylistPanel
                        data={data}
                        isLocked={isLocked}
                        onSelectTrack={handleSelectTrack}
                        onRemoveTrack={handleRemoveTrack}
                        onAddTrack={handleAddTrack}
                    />
                )}
            </div>
        </div>
    );
};

// ============================================
// Custom Element
// ============================================

export class VideoPlayerElement extends UbiWidget<MusicPlayerState> {
    #root: Root | null = null;

    connectedCallback() {
        this.#root = createRoot(this);
    }

    protected onUpdate(ctx: UbiEntityContext<MusicPlayerState>) {
        this.#root?.render(<VideoPlayerContent ctx={ctx} />);
    }

    disconnectedCallback() {
        const root = this.#root;
        this.#root = null;
        setTimeout(() => root?.unmount(), 0);
    }
}
