'use client';

import type React from 'react';
import { useState } from 'react';
import { PlayIcon, TrashIcon } from './icons';
import styles from './styles.module.css';
import type { MusicPlayerState, Track } from './types';

interface PlaylistPanelProps {
    data: MusicPlayerState;
    isLocked: boolean;
    onSelectTrack: (index: number) => void;
    onRemoveTrack: (index: number) => void;
    onAddTrack: (track: Track) => void;
}

interface SearchResult {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
}

// ubichill本体と同じパターン：本番環境では相対パス、開発環境のみlocalhost
const API_BASE = typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:8000' // 開発環境のみ
    : '/video-player-api'; // 本番環境（Kubernetesなど）

const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// YouTube URLからIDを抽出
const extractYouTubeId = (url: string): string | null => {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/,
        /youtube\.com\/embed\/([\w-]+)/,
        /^([\w-]{11})$/, // 直接IDの場合
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) return match[1];
    }
    return null;
};

export const PlaylistPanel: React.FC<PlaylistPanelProps> = ({
    data,
    isLocked,
    onSelectTrack,
    onRemoveTrack,
    onAddTrack,
}) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [urlInput, setUrlInput] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedMode, setSelectedMode] = useState<'live' | 'video'>('video'); // モード選択状態

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

    const handleAddTrack = (result: SearchResult) => {
        const newTrack: Track = {
            id: result.id,
            title: result.title,
            thumbnail: result.thumbnail,
            duration: result.duration,
            mode: selectedMode, // ユーザーが選択したモードを使用
        };
        onAddTrack(newTrack);
        setSearchResults([]);
        setSearchQuery('');
    };

    const handleAddFromUrl = async () => {
        const videoId = extractYouTubeId(urlInput.trim());
        if (!videoId) {
            alert('Invalid YouTube URL or ID');
            return;
        }

        setIsSearching(true);
        try {
            // バックエンドから動画情報を取得
            const res = await fetch(`${API_BASE}/api/stream/info/${videoId}`);
            if (!res.ok) {
                const errorText = await res.text();
                console.error(`API Error (${res.status}):`, errorText);
                throw new Error(`Failed to get video info: ${res.status} - ${errorText}`);
            }
            const info = await res.json();

            const newTrack: Track = {
                id: videoId,
                title: info.title || urlInput,
                thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/default.jpg`,
                duration: info.duration || 0,
                mode: selectedMode, // ユーザーが選択したモードを使用
            };
            onAddTrack(newTrack);
            setUrlInput('');
        } catch (error) {
            console.error('Failed to add from URL:', error);
            // フォールバック: 最低限の情報で追加
            const newTrack: Track = {
                id: videoId,
                title: urlInput,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
                duration: 0,
                mode: selectedMode, // ユーザーが選択したモードを使用
            };
            onAddTrack(newTrack);
            setUrlInput('');
        } finally {
            setIsSearching(false);
        }
    };

    if (isLocked) return null;

    return (
        <div className={styles.playlistPanel}>
            <div className={styles.playlistHeader}>
                <span className={styles.playlistTitle}>Playlist ({data.playlist.length})</span>
            </div>

            {/* モード切り替えボタン */}
            <div className={styles.playlistSearch}>
                <button
                    type="button"
                    className={`${styles.playlistSearchBtn} ${selectedMode === 'live' ? styles.activeMode : ''}`}
                    onClick={() => setSelectedMode('live')}
                    style={{
                        flex: 1,
                        backgroundColor: selectedMode === 'live' ? '#ff4444' : '#333',
                        borderRadius: '4px 0 0 4px',
                    }}
                >
                    🔴 Live
                </button>
                <button
                    type="button"
                    className={`${styles.playlistSearchBtn} ${selectedMode === 'video' ? styles.activeMode : ''}`}
                    onClick={() => setSelectedMode('video')}
                    style={{
                        flex: 1,
                        backgroundColor: selectedMode === 'video' ? '#4444ff' : '#333',
                        borderRadius: '0 4px 4px 0',
                    }}
                >
                    🎬 Video
                </button>
            </div>

            {/* URL入力 */}
            <div className={styles.playlistSearch}>
                <input
                    type="text"
                    className={styles.playlistInput}
                    placeholder="YouTube URL or ID..."
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddFromUrl()}
                />
                <button
                    type="button"
                    className={styles.playlistSearchBtn}
                    onClick={handleAddFromUrl}
                    disabled={isSearching}
                >
                    {isSearching ? '...' : '+'}
                </button>
            </div>

            {/* 検索バー */}
            <div className={styles.playlistSearch}>
                <input
                    type="text"
                    className={styles.playlistInput}
                    placeholder="Search YouTube..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
                <button
                    type="button"
                    className={styles.playlistSearchBtn}
                    onClick={handleSearch}
                    disabled={isSearching}
                >
                    {isSearching ? '...' : '🔍'}
                </button>
            </div>

            {/* 検索結果 */}
            {searchResults.length > 0 && (
                <div className={styles.playlistList}>
                    {searchResults.map((result) => (
                        <div key={result.id} className={styles.playlistItem}>
                            <img src={result.thumbnail} alt="" className={styles.playlistThumb} />
                            <div className={styles.playlistInfo}>
                                <div className={styles.playlistItemTitle}>{result.title}</div>
                                <div className={styles.playlistItemDuration}>{formatTime(result.duration)}</div>
                            </div>
                            <button
                                type="button"
                                className={styles.playlistAddBtn}
                                onClick={() => handleAddTrack(result)}
                            >
                                +
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* プレイリスト */}
            <div className={styles.playlistList}>
                {data.playlist.length === 0 ? (
                    <div className={styles.playlistEmpty}>
                        <div className={styles.playlistEmptyText}>No tracks in playlist</div>
                    </div>
                ) : (
                    data.playlist.map((track, index) => (
                        <div
                            key={`${track.id}-${index}`}
                            className={`${styles.playlistItem} ${index === data.currentIndex ? styles.playlistItemActive : ''}`}
                            onClick={() => onSelectTrack(index)}
                            onKeyDown={(e) => e.key === 'Enter' && onSelectTrack(index)}
                            role="button"
                            tabIndex={0}
                        >
                            <img src={track.thumbnail} alt="" className={styles.playlistThumb} />
                            <div className={styles.playlistInfo}>
                                <div className={styles.playlistItemTitle}>
                                    <span style={{ marginRight: '4px' }}>{track.mode === 'live' ? '🔴' : '🎬'}</span>
                                    {track.title}
                                </div>
                                <div className={styles.playlistItemDuration}>{formatTime(track.duration)}</div>
                            </div>
                            {index === data.currentIndex && (
                                <div className={styles.playingIndicator}>
                                    <PlayIcon size={12} />
                                </div>
                            )}
                            <button
                                type="button"
                                className={styles.playlistDeleteBtn}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveTrack(index);
                                }}
                            >
                                <TrashIcon size={14} />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
