'use client';

import { useSocket } from '@ubichill/sdk';
import type { WorldEntity } from '@ubichill/shared';
import Hls from 'hls.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
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

interface Props {
    entity: WorldEntity<MusicPlayerState>;
    isLocked: boolean;
    update: (patch: Partial<WorldEntity<MusicPlayerState>>) => void;
}

const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const VideoPlayer: React.FC<Props> = ({ entity, isLocked, update }) => {
    const { data } = entity;
    const { socket } = useSocket();
    const videoRef = useRef<HTMLVideoElement | null>(null);

    // SSR対応：共通API設定を使用
    const [apiBase, setApiBase] = useState(() => getVideoPlayerApiBase());

    useEffect(() => {
        // クライアントサイドで再評価（環境変数がない場合のみ）
        if (!process.env.NEXT_PUBLIC_VIDEO_PLAYER_BACKEND_URL) {
            setApiBase(getVideoPlayerApiBase());
        }
    }, []);
    const hlsRef = useRef<Hls | null>(null);
    const dataRef = useRef(data);
    const updateRef = useRef(update);
    const [localTime, setLocalTime] = useState(data.currentTime);
    const [showVideo, setShowVideo] = useState(false);
    const [isLoadingTrack, setIsLoadingTrack] = useState(false);

    const currentTrack = data.playlist[data.currentIndex];

    // 最新のdataとupdateをrefに保持
    useEffect(() => {
        dataRef.current = data;
        updateRef.current = update;
    });

    // デフォルトプレイリストの初期化（playlist.lengthが0の時のみ）
    useEffect(() => {
        const currentData = dataRef.current;
        const currentUpdate = updateRef.current;

        if (currentData.playlist.length === 0 && DEFAULT_LOFI_PLAYLIST.length > 0) {
            currentUpdate({
                data: {
                    ...currentData,
                    playlist: DEFAULT_LOFI_PLAYLIST,
                },
            });
        }
    }, []);

    // HLSクリーンアップ
    useEffect(() => {
        return () => {
            if (hlsRef.current) {
                console.log('[VideoPlayer] 🧹 HLSインスタンスをクリーンアップ');
                hlsRef.current.destroy();
            }
        };
    }, []);

    // プレイヤー状態の同期（WebSocketで受信）
    useEffect(() => {
        if (!socket) return;

        const handleSync = (syncData: { currentIndex: number; isPlaying: boolean; currentTime: number }) => {
            const currentData = dataRef.current;
            const currentUpdate = updateRef.current;

            console.log('[VideoPlayer] 🔄 同期データ受信:', {
                syncData,
                currentState: {
                    currentIndex: currentData.currentIndex,
                    isPlaying: currentData.isPlaying,
                    currentTime: videoRef.current?.currentTime,
                },
                timestamp: new Date().toISOString(),
                socketId: socket.id as string,
            });

            // ローカルの状態を更新
            currentUpdate({
                data: {
                    ...currentData,
                    currentIndex: syncData.currentIndex,
                    isPlaying: syncData.isPlaying,
                },
            });

            // 再生位置を同期
            if (videoRef.current && syncData.currentTime !== undefined) {
                videoRef.current.currentTime = syncData.currentTime;
                console.log('[VideoPlayer] ⏱️  再生位置を同期:', syncData.currentTime);
            }
        };

        console.log('[VideoPlayer] 🎧 video-player:syncリスナーを登録');
        socket.on('video-player:sync', handleSync);

        return () => {
            console.log('[VideoPlayer] 🔌 video-player:syncリスナーを解除');
            socket.off('video-player:sync', handleSync);
        };
    }, [socket]);

    // トラックの動画URLを設定
    const loadTrackVideo = useCallback(
        async (trackId: string, mode: 'live' | 'video' = 'video') => {
            // モードによってエンドポイントを切り替え
            const endpoint = mode === 'live' ? 'live' : 'video';
            const videoUrl = `${apiBase}/api/stream/${endpoint}/${trackId}`;

            setIsLoadingTrack(true);
            try {
                // 既存のHLSインスタンスをクリーンアップ
                if (hlsRef.current) {
                    hlsRef.current.destroy();
                    hlsRef.current = null;
                }

                if (videoRef.current) {
                    // 通常動画モード：video要素で直接再生（バックエンドが302リダイレクト）
                    if (mode === 'video') {
                        videoRef.current.src = videoUrl;
                        videoRef.current.load();
                        if (data.isPlaying) {
                            videoRef.current.play().catch(console.error);
                        }
                        setIsLoadingTrack(false);
                        return;
                    }

                    // ライブモード：HLS.jsで再生
                    if (Hls.isSupported()) {
                        console.log('[VideoPlayer] 📺 HLS.jsで再生（バックエンドURLを直接使用）');
                        const hls = new Hls({
                            enableWorker: true,
                            lowLatencyMode: true,
                            // ライブストリーム用のバッファ設定（YouTubeの24時間配信に最適化）
                            maxBufferLength: 60, // 最大60秒のバッファ（途切れを防ぐ）
                            maxMaxBufferLength: 120, // 絶対最大120秒
                            liveSyncDuration: 5, // ライブエッジから5秒遅れて再生（安定性重視）
                            liveMaxLatencyDuration: 15, // 最大15秒の遅延まで許容
                            backBufferLength: 0, // 後方バッファを保持しない（メモリ節約）
                            // TSセグメント解析の許容度を上げる
                            enableSoftwareAES: true, // ソフトウェアAES復号化を有効化
                            abrEwmaDefaultEstimate: 500000, // 初期帯域推定値を下げる
                            xhrSetup: (_xhr, url) => {
                                // リダイレクトを自動追従
                                console.log('[VideoPlayer] 🔗 リクエスト:', url);
                            },
                        });
                        hlsRef.current = hls;

                        hls.loadSource(videoUrl);
                        hls.attachMedia(videoRef.current);

                        hls.on(Hls.Events.MANIFEST_PARSED, () => {
                            if (data.isPlaying && videoRef.current) {
                                videoRef.current.play().catch(console.error);
                            }
                        });

                        hls.on(Hls.Events.ERROR, (event, errorData) => {
                            console.error('[VideoPlayer] ❌ HLSエラー:', {
                                event,
                                errorData,
                                type: errorData.type,
                                details: errorData.details,
                                fatal: errorData.fatal,
                                url: errorData.url,
                                response: errorData.response,
                            });

                            // 非致命的なfragParsingErrorは無視（ライブストリームでは頻発する）
                            if (!errorData.fatal && errorData.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
                                console.warn('[VideoPlayer] ⚠️ セグメント解析エラー（非致命的）- スキップして続行');
                                return;
                            }

                            // 非致命的なbufferStalledErrorは無視（ネットワーク遅延で発生）
                            if (!errorData.fatal && errorData.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
                                console.warn('[VideoPlayer] ⚠️ バッファ停止（非致命的）- 自動復旧待機中...');
                                return;
                            }

                            if (errorData.fatal) {
                                switch (errorData.type) {
                                    case Hls.ErrorTypes.NETWORK_ERROR:
                                        console.log('[VideoPlayer] 🔄 ネットワークエラー、リトライ中...');

                                        // manifestLoadError の場合は、バックエンドエラーメッセージを取得
                                        if (errorData.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR) {
                                            console.error('[VideoPlayer] 📋 マニフェスト読み込みエラー');
                                            console.error('[VideoPlayer] レスポンス:', errorData.response);

                                            // バックエンドからのエラーメッセージを抽出
                                            if (
                                                errorData.response?.data &&
                                                typeof errorData.response.data === 'object'
                                            ) {
                                                try {
                                                    const detail = (errorData.response.data as { detail?: unknown })
                                                        .detail;
                                                    if (
                                                        typeof detail === 'object' &&
                                                        detail !== null &&
                                                        'message' in detail
                                                    ) {
                                                        alert(`動画エラー: ${(detail as { message: string }).message}`);
                                                        return;
                                                    } else if (typeof detail === 'string') {
                                                        alert(`動画エラー: ${detail}`);
                                                        return;
                                                    }
                                                } catch (e) {
                                                    console.error('[VideoPlayer] エラーメッセージ解析失敗:', e);
                                                }
                                            }
                                        }

                                        hls.startLoad();
                                        break;
                                    case Hls.ErrorTypes.MEDIA_ERROR:
                                        console.log('[VideoPlayer] 🔄 メディアエラー、復旧試行中...');
                                        // FRAG_PARSING_ERRORの場合は、バッファをフラッシュしてリトライ
                                        if (errorData.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
                                            console.log(
                                                '[VideoPlayer] 🔄 TSセグメント解析エラー - バッファクリア後リトライ',
                                            );
                                            hls.startLoad(-1); // バッファをクリアして最初から
                                        } else {
                                            hls.recoverMediaError();
                                        }
                                        break;
                                    default:
                                        console.error('[VideoPlayer] 💥 致命的エラー、HLSを破棄');
                                        hls.destroy();
                                        break;
                                }
                            }
                        });
                    } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                        // Safari用のネイティブHLS再生（ライブモードのみ）
                        console.log('[VideoPlayer] 🍎 Safari ネイティブHLS再生');
                        videoRef.current.src = videoUrl;
                        if (data.isPlaying) {
                            await videoRef.current.play();
                        }
                    } else {
                        console.error('[VideoPlayer] ❌ HLSがサポートされていません');
                    }
                }
            } catch (error) {
                console.error('[VideoPlayer] ❌ 動画読み込みエラー:', {
                    error,
                    trackId,
                    videoUrl,
                    errorType: error instanceof Error ? error.name : typeof error,
                    errorMessage: error instanceof Error ? error.message : String(error),
                });

                // HTTPエラーレスポンスからエラーメッセージを抽出
                let errorMessage = '動画の読み込みに失敗しました';

                if (error && typeof error === 'object' && 'response' in error) {
                    try {
                        const response = (error as { response?: { data?: { detail?: unknown } } }).response;
                        if (response?.data?.detail) {
                            const detail = response.data.detail;
                            if (typeof detail === 'object' && detail !== null && 'message' in detail) {
                                errorMessage = (detail as { message: string }).message;
                            } else if (typeof detail === 'string') {
                                errorMessage = detail;
                            }
                        }
                    } catch (parseError) {
                        console.error('[VideoPlayer] エラーメッセージ解析失敗:', parseError);
                    }
                }

                // エラーメッセージをコンソールに表示（TODO: トーストメッセージに変更）
                console.error(`[VideoPlayer] 🚨 ${errorMessage}`);
                alert(`動画エラー: ${errorMessage}`);
            } finally {
                setIsLoadingTrack(false);
            }
        },
        [data.isPlaying, apiBase],
    );

    // トラックが変わったら動画を読み込む
    useEffect(() => {
        if (currentTrack) {
            loadTrackVideo(currentTrack.id, currentTrack.mode);
        }
    }, [currentTrack, loadTrackVideo]);

    // 再生/一時停止の状態を同期
    useEffect(() => {
        if (!videoRef.current || !currentTrack) return;

        if (data.isPlaying) {
            videoRef.current.play().catch(console.error);
        } else {
            videoRef.current.pause();
        }
    }, [data.isPlaying, currentTrack]);

    // 音量を同期
    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.volume = data.volume;
        }
    }, [data.volume]);

    // 再生位置の更新
    const handleTimeUpdate = useCallback(() => {
        if (videoRef.current) {
            setLocalTime(videoRef.current.currentTime);
        }
    }, []);

    // トラック終了時
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

        // WebSocketで状態を同期
        if (socket && currentTrack) {
            const syncData = {
                currentIndex: data.currentIndex,
                isPlaying: newState.isPlaying,
                currentTime: localTime,
            };
            console.log('[VideoPlayer] ▶️ 再生/一時停止を送信:', {
                syncData,
                currentTrack: currentTrack.title,
                socketId: socket.id as string,
                timestamp: new Date().toISOString(),
            });
            socket.emit('video-player:sync', syncData);
        }
    };

    const playPrev = () => {
        const prevIndex = data.currentIndex > 0 ? data.currentIndex - 1 : data.playlist.length - 1;
        update({ data: { ...data, currentIndex: prevIndex } });

        // WebSocketで状態を同期
        if (socket) {
            const syncData = {
                currentIndex: prevIndex,
                isPlaying: data.isPlaying,
                currentTime: 0,
            };
            console.log('[VideoPlayer] ⏮️  前の曲を送信:', {
                syncData,
                socketId: socket.id as string,
                timestamp: new Date().toISOString(),
            });
            socket.emit('video-player:sync', syncData);
        }
    };

    const playNext = () => {
        const nextIndex = data.currentIndex < data.playlist.length - 1 ? data.currentIndex + 1 : 0;
        update({ data: { ...data, currentIndex: nextIndex } });

        // WebSocketで状態を同期
        if (socket) {
            const syncData = {
                currentIndex: nextIndex,
                isPlaying: data.isPlaying,
                currentTime: 0,
            };
            console.log('[VideoPlayer] ⏭️  次の曲を送信:', {
                syncData,
                socketId: socket.id as string,
                timestamp: new Date().toISOString(),
            });
            socket.emit('video-player:sync', syncData);
        }
    };

    const toggleLoop = () => {
        const modes: ('none' | 'playlist' | 'track')[] = ['none', 'playlist', 'track'];
        const currentModeIndex = modes.indexOf(data.loop);
        const nextMode = modes[(currentModeIndex + 1) % modes.length];
        update({ data: { ...data, loop: nextMode } });
    };

    const toggleShuffle = () => {
        update({ data: { ...data, shuffle: !data.shuffle } });
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = Number.parseFloat(e.target.value);
        update({ data: { ...data, volume: newVolume } });
    };

    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!videoRef.current || !currentTrack) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const newTime = percent * currentTrack.duration;

        videoRef.current.currentTime = newTime;
        setLocalTime(newTime);
    };

    const handleSelectTrack = (index: number) => {
        update({ data: { ...data, currentIndex: index, isPlaying: true } });

        // WebSocketで状態を同期
        if (socket) {
            const syncData = {
                currentIndex: index,
                isPlaying: true,
                currentTime: 0,
            };
            console.log('[VideoPlayer] 🎵 曲を選択して送信:', {
                syncData,
                track: data.playlist[index]?.title,
                socketId: socket.id as string,
                timestamp: new Date().toISOString(),
            });
            socket.emit('video-player:sync', syncData);
        }
    };

    const handleRemoveTrack = (index: number) => {
        const newPlaylist = [...data.playlist];
        newPlaylist.splice(index, 1);

        let newIndex = data.currentIndex;
        if (index < data.currentIndex) {
            newIndex = Math.max(0, newIndex - 1);
        } else if (index === data.currentIndex && newIndex >= newPlaylist.length) {
            newIndex = Math.max(0, newPlaylist.length - 1);
        }

        update({
            data: {
                ...data,
                playlist: newPlaylist,
                currentIndex: newIndex,
            },
        });
    };

    const handleAddTrack = (track: { id: string; title: string; thumbnail: string; duration: number }) => {
        const newTrack: Track = {
            id: track.id,
            title: track.title,
            thumbnail: track.thumbnail,
            duration: track.duration,
            mode: 'video', // デフォルトはvideo mode
        };

        update({
            data: {
                ...data,
                playlist: [...data.playlist, newTrack],
            },
        });
    };

    if (isLocked) return null;

    return (
        <div className={styles.videoPlayerContainer}>
            <div className={styles.mainContent}>
                {/* 左側: プレイヤー */}
                <div className={styles.playerSection}>
                    {/* 動画表示 */}
                    {showVideo && currentTrack && (
                        <div className={styles.videoDisplay}>
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

                    {/* 非表示のvideo要素 */}
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

                    {/* コンパクトな再生コントロール */}
                    <div className={styles.playerControl}>
                        {/* プログレスバー */}
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

                        {/* メインコントロール */}
                        <div className={styles.controlRow}>
                            {/* 左: トラック情報 */}
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

                            {/* 中央: 再生ボタン */}
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

                            {/* 右: その他コントロール */}
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
                                    {data.volume === 0 ? (
                                        <VolumeMuteIcon size={16} />
                                    ) : data.volume < 0.3 ? (
                                        <VolumeLowIcon size={16} />
                                    ) : data.volume < 0.7 ? (
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
                                    value={data.volume}
                                    onChange={handleVolumeChange}
                                />
                                {currentTrack && (
                                    <button
                                        type="button"
                                        className={`${styles.controlBtn} ${showVideo ? styles.active : ''}`}
                                        onClick={() => setShowVideo(!showVideo)}
                                    >
                                        <VideoIcon size={16} />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 右側: プレイリスト */}
                <PlaylistPanel
                    data={data}
                    isLocked={isLocked}
                    onSelectTrack={handleSelectTrack}
                    onRemoveTrack={handleRemoveTrack}
                    onAddTrack={handleAddTrack}
                />
            </div>
        </div>
    );
};
