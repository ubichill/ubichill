'use client';

import type { WorldEntity } from '@ubichill/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './styles.module.css';
import type { MusicPlayerState, Track } from './types';

interface Props {
    entity: WorldEntity<MusicPlayerState>;
    isLocked: boolean;
    update: (patch: Partial<WorldEntity<MusicPlayerState>>) => void;
}

interface SearchResult {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
}

// バックエンドAPIのベースURL
const API_BASE = process.env.NEXT_PUBLIC_VIDEO_PLAYER_BACKEND_URL || 
    (typeof window !== 'undefined' && window.location.hostname !== 'localhost' 
        ? '' // 本番環境では相対パス（同一ドメイン）
        : 'http://localhost:8000'); // 開発環境

export const MusicPlayer: React.FC<Props> = ({ entity, isLocked, update }) => {
    const { data } = entity;
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isLoadingTrack, setIsLoadingTrack] = useState(false);
    const [localTime, setLocalTime] = useState(data.currentTime);
    const [showVideo, setShowVideo] = useState(false);

    const currentTrack = data.playlist[data.currentIndex];

    // 時間をフォーマット (MM:SS)
    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // トラックの動画URLを設定
    const loadTrackVideo = useCallback(
        async (trackId: string) => {
            setIsLoadingTrack(true);
            try {
                if (videoRef.current) {
                    // 動画ストリーミングエンドポイントを使用
                    videoRef.current.src = `${API_BASE}/api/stream/video/${trackId}`;
                    if (data.isPlaying) {
                        await videoRef.current.play();
                    }
                }
            } catch (error) {
                console.error('Failed to load track video:', error);
            } finally {
                setIsLoadingTrack(false);
            }
        },
        [data.isPlaying],
    );

    // トラックが変わったら動画を読み込む
    useEffect(() => {
        if (currentTrack) {
            loadTrackVideo(currentTrack.id);
        }
    }, [currentTrack?.id, loadTrackVideo, currentTrack]);

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
            // 次のトラックへ
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

    // YouTube検索
    const handleSearch = async () => {
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        try {
            const res = await fetch(
                `${API_BASE}/api/stream/search?q=${encodeURIComponent(`${searchQuery} lofi`)}&limit=10`,
            );
            if (!res.ok) throw new Error('Search failed');
            const results = await res.json();
            setSearchResults(results);
        } catch (error) {
            console.error('Search error:', error);
        } finally {
            setIsSearching(false);
        }
    };

    // プレイリストに追加
    const handleAddTrack = (track: SearchResult) => {
        const newTrack: Track = {
            id: track.id,
            title: track.title,
            thumbnail: track.thumbnail,
            duration: track.duration,
        };

        update({
            data: {
                ...data,
                playlist: [...data.playlist, newTrack],
            },
        });

        // 検索結果をクリア
        setSearchResults([]);
        setSearchQuery('');
    };

    // トラックを削除
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

    // トラック選択
    const handleSelectTrack = (index: number) => {
        update({
            data: {
                ...data,
                currentIndex: index,
                isPlaying: true,
            },
        });
    };

    // 再生/一時停止
    const togglePlay = () => {
        update({
            data: {
                ...data,
                isPlaying: !data.isPlaying,
            },
        });
    };

    // 前のトラック
    const playPrev = () => {
        const prevIndex = data.currentIndex > 0 ? data.currentIndex - 1 : data.playlist.length - 1;
        update({
            data: {
                ...data,
                currentIndex: prevIndex,
            },
        });
    };

    // 次のトラック
    const playNext = () => {
        const nextIndex = data.currentIndex < data.playlist.length - 1 ? data.currentIndex + 1 : 0;
        update({
            data: {
                ...data,
                currentIndex: nextIndex,
            },
        });
    };

    // ループモード切り替え
    const toggleLoop = () => {
        const modes: ('none' | 'playlist' | 'track')[] = ['none', 'playlist', 'track'];
        const currentModeIndex = modes.indexOf(data.loop);
        const nextMode = modes[(currentModeIndex + 1) % modes.length];
        update({
            data: {
                ...data,
                loop: nextMode,
            },
        });
    };

    // シャッフル切り替え
    const toggleShuffle = () => {
        update({
            data: {
                ...data,
                shuffle: !data.shuffle,
            },
        });
    };

    // 音量変更
    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = Number.parseFloat(e.target.value);
        update({
            data: {
                ...data,
                volume: newVolume,
            },
        });
    };

    // 再生位置変更
    const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!videoRef.current || !currentTrack) return;

        const rect = e.currentTarget.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        const newTime = percent * currentTrack.duration;

        videoRef.current.currentTime = newTime;
        setLocalTime(newTime);
    };

    // ループアイコン
    const getLoopIcon = () => {
        switch (data.loop) {
            case 'track':
                return '🔂';
            case 'playlist':
                return '🔁';
            default:
                return '🔁';
        }
    };

    // 音量アイコン
    const getVolumeIcon = () => {
        if (data.volume === 0) return '🔇';
        if (data.volume < 0.3) return '🔈';
        if (data.volume < 0.7) return '🔉';
        return '🔊';
    };

    return (
        <div className={styles.container}>
            {/* 動画表示エリア - 表示切り替え可能 */}
            {showVideo && currentTrack && (
                <div className={styles.videoWrapper}>
                    {/* biome-ignore lint/a11y/useMediaCaption: Visualizer only */}
                    <video
                        ref={videoRef}
                        className={styles.video}
                        onTimeUpdate={handleTimeUpdate}
                        onEnded={handleTrackEnded}
                        controls={false}
                        autoPlay={false}
                    />
                </div>
            )}

            {/* 非表示のvideo要素 - 音楽のみの場合 */}
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

            {/* メインプレイヤーバー - 常時表示 */}
            <div className={styles.playerBar}>
                {/* 再生バー - 常時表示 */}
                <div
                    className={styles.progressBar}
                    onClick={handleSeek}
                    role="slider"
                    tabIndex={0}
                    aria-valuenow={localTime}
                    aria-valuemin={0}
                    aria-valuemax={currentTrack?.duration || 0}
                >
                    <div
                        className={styles.progressFill}
                        style={{
                            width: currentTrack ? `${(localTime / currentTrack.duration) * 100}%` : '0%',
                        }}
                    />
                </div>

                {/* メインコントロールエリア */}
                <div className={styles.controlsArea}>
                    {/* 左側: トラック情報 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: '1', minWidth: '0' }}>
                        {currentTrack ? (
                            <>
                                <img
                                    src={currentTrack.thumbnail}
                                    alt=""
                                    className={`${styles.thumbnail} ${styles.thumbnailClickable}`}
                                    onClick={() => setShowVideo(!showVideo)}
                                    title={showVideo ? '動画を非表示' : '動画を表示'}
                                />
                                <div style={{ display: 'flex', flexDirection: 'column', minWidth: '0' }}>
                                    <div className={styles.trackInfoTitle}>
                                        {isLoadingTrack ? '読み込み中...' : currentTrack.title}
                                    </div>
                                    <div className={styles.trackInfoDuration}>
                                        {formatTime(localTime)} / {formatTime(currentTrack.duration)}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ fontSize: '24px' }}>🎵</div>
                                <div style={{ color: 'rgba(255, 255, 255, 0.6)', fontSize: '14px', fontWeight: '500' }}>
                                    Lofi Music Player
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 中央: 再生コントロール */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <button
                            type="button"
                            className={`${styles.controlButtonSecondary} ${data.shuffle ? styles.controlButtonActive : ''}`}
                            onClick={toggleShuffle}
                            title="シャッフル"
                        >
                            🔀
                        </button>
                        <button
                            type="button"
                            className={styles.controlButtonSecondary}
                            onClick={playPrev}
                            disabled={data.playlist.length === 0}
                            title="前のトラック"
                        >
                            ⏮️
                        </button>
                        <button
                            type="button"
                            className={styles.controlButtonPrimary}
                            onClick={togglePlay}
                            disabled={data.playlist.length === 0 || isLoadingTrack}
                            title={data.isPlaying ? '一時停止' : '再生'}
                        >
                            {data.isPlaying ? '⏸️' : '▶️'}
                        </button>
                        <button
                            type="button"
                            className={styles.controlButtonSecondary}
                            onClick={playNext}
                            disabled={data.playlist.length === 0}
                            title="次のトラック"
                        >
                            ⏭️
                        </button>
                        <button
                            type="button"
                            className={`${styles.controlButtonSecondary} ${data.loop !== 'none' ? styles.controlButtonActive : ''}`}
                            onClick={toggleLoop}
                            title={`ループ: ${data.loop}`}
                        >
                            {getLoopIcon()}
                        </button>
                    </div>

                    {/* 右側: 音量コントロール - 常時表示 */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            flex: '1',
                            justifyContent: 'flex-end',
                        }}
                    >
                        <span style={{ fontSize: '20px' }}>{getVolumeIcon()}</span>
                        <input
                            type="range"
                            className={styles.volumeSlider}
                            min="0"
                            max="1"
                            step="0.01"
                            value={data.volume}
                            onChange={handleVolumeChange}
                        />
                        {/* 動画表示切り替えボタン */}
                        {currentTrack && (
                            <button
                                type="button"
                                className={`${styles.controlButtonSecondary} ${showVideo ? styles.controlButtonActive : ''}`}
                                onClick={() => setShowVideo(!showVideo)}
                                title={showVideo ? '動画を非表示' : '動画を表示'}
                                style={{ fontSize: '18px' }}
                            >
                                📺
                            </button>
                        )}
                    </div>
                </div>

                {/* 検索バー */}
                {!isLocked && (
                    <div className={styles.searchContainer}>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <input
                                type="text"
                                className={styles.searchInput}
                                placeholder="YouTubeから曲を検索..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                            <button
                                type="button"
                                className={styles.controlButtonAction}
                                onClick={handleSearch}
                                disabled={isSearching}
                            >
                                {isSearching ? '検索中...' : '検索'}
                            </button>
                        </div>
                    </div>
                )}

                {/* 検索結果 */}
                {searchResults.length > 0 && (
                    <div className={`${styles.listContainer} ${styles.listContainerSearch}`}>
                        {searchResults.map((result) => (
                            <div key={result.id} className={`${styles.listItem} ${styles.listItemSearch}`}>
                                <img src={result.thumbnail} alt="" className={styles.thumbnail} />
                                <div style={{ flex: '1', minWidth: '0' }}>
                                    <div className={styles.trackInfoTitle}>{result.title}</div>
                                    <div className={styles.trackInfoDuration}>{formatTime(result.duration)}</div>
                                </div>
                                <button
                                    type="button"
                                    className={styles.controlButtonAction}
                                    onClick={() => handleAddTrack(result)}
                                >
                                    追加
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* プレイリスト */}
                {!isLocked && (
                    <div className={styles.listContainer}>
                        {data.playlist.length === 0 ? (
                            <div className={styles.playlistEmptyState}>
                                <div style={{ fontSize: '48px' }}>🎶</div>
                                <div style={{ fontSize: '14px', lineHeight: '1.5' }}>
                                    プレイリストが空です
                                    <br />
                                    上の検索バーから曲を追加してください
                                </div>
                            </div>
                        ) : (
                            data.playlist.map((track, index) => (
                                <div
                                    key={`${track.id}-${index}`}
                                    className={`${styles.listItem} ${styles.listItemPlaylist} ${index === data.currentIndex ? styles.listItemActive : ''}`}
                                    onClick={() => handleSelectTrack(index)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleSelectTrack(index)}
                                    role="button"
                                    tabIndex={0}
                                >
                                    <img
                                        src={track.thumbnail}
                                        alt=""
                                        className={styles.thumbnail}
                                        style={{ width: '40px', height: '40px' }}
                                    />
                                    <div style={{ flex: '1', minWidth: '0' }}>
                                        <div
                                            className={styles.trackInfoTitle}
                                            style={{
                                                color: index === data.currentIndex ? '#c9b6ff' : 'inherit',
                                                fontSize: '13px',
                                            }}
                                        >
                                            {track.title}
                                        </div>
                                        <div className={styles.trackInfoDuration}>{formatTime(track.duration)}</div>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.controlButtonDelete}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveTrack(index);
                                        }}
                                        title="プレイリストから削除"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
