import { spawn } from 'node:child_process';
import { Router } from 'express';

const router = Router();

interface AudioInfo {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    audioUrl: string;
    author?: string;
}

interface SearchResult {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    author?: string;
}

/**
 * yt-dlpコマンドを実行して結果を取得するヘルパー
 */
function runYtDlp(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const process = spawn('yt-dlp', args);
        let stdout = '';
        let stderr = '';

        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });

        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        process.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            } else {
                reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
            }
        });

        process.on('error', (err) => {
            reject(new Error(`Failed to start yt-dlp: ${err.message}`));
        });
    });
}

/**
 * yt-dlpを使用してオーディオ情報を取得
 */
async function getAudioInfo(videoUrl: string): Promise<AudioInfo> {
    console.log(`Fetching audio info for: ${videoUrl}`);

    try {
        // --dump-single-json: プレイリストの場合も最初の1件のJSONのみ返す
        const jsonOutput = await runYtDlp([
            '--dump-single-json',
            '--no-warnings',
            '--no-call-home',
            '--prefer-free-formats',
            videoUrl,
        ]);

        const info = JSON.parse(jsonOutput);

        return {
            id: info.id,
            title: info.title || 'Unknown',
            thumbnail: info.thumbnail || '',
            duration: info.duration || 0,
            audioUrl: '', // API側で構築
            author: info.uploader || info.artist || '',
        };
    } catch (error) {
        console.error('getAudioInfo error:', error);
        throw new Error('動画情報の取得に失敗しました');
    }
}

/**
 * YouTube検索
 */
async function searchYoutube(query: string, _limit = 10): Promise<SearchResult[]> {
    console.log(`Search requested for: ${query}`);

    // 人気のLofiチャンネル/動画のIDを返す (プレースホルダー)
    const popularLofiVideos: SearchResult[] = [
        {
            id: 'jfKfPfyJRdk',
            title: 'lofi hip hop radio 📚 - beats to relax/study to',
            thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
            duration: 0, // ライブストリーム
            author: 'Lofi Girl',
        },
        {
            id: '4xDzrJKXOOY',
            title: 'synthwave radio 🌌 - beats to chill/game to',
            thumbnail: 'https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg',
            duration: 0,
            author: 'Lofi Girl',
        },
        {
            id: 'rUxyKA_-grg',
            title: 'lofi hip hop radio 💤 - beats to sleep/chill to',
            thumbnail: 'https://i.ytimg.com/vi/rUxyKA_-grg/hqdefault.jpg',
            duration: 0,
            author: 'Lofi Girl',
        },
        {
            id: '5yx6BWlEVcY',
            title: 'Chillhop Radio - jazzy & lofi hip hop beats',
            thumbnail: 'https://i.ytimg.com/vi/5yx6BWlEVcY/hqdefault.jpg',
            duration: 0,
            author: 'Chillhop Music',
        },
        {
            id: '36YnV9STBqc',
            title: 'Cozy Coffee Shop Ambience ☕ Smooth Jazz Music',
            thumbnail: 'https://i.ytimg.com/vi/36YnV9STBqc/hqdefault.jpg',
            duration: 10800,
            author: 'Calmed By Nature',
        },
    ];

    const lowerQuery = query.toLowerCase();
    const filtered = popularLofiVideos.filter(
        (v) => v.title.toLowerCase().includes(lowerQuery) || v.author?.toLowerCase().includes(lowerQuery),
    );

    return filtered.length > 0 ? filtered : popularLofiVideos;
}

/**
 * GET /api/audio/info?url=<youtube_url>
 */
router.get('/info', async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URLパラメータが必要です' });
    }

    try {
        const info = await getAudioInfo(url);
        info.audioUrl = `${req.protocol}://${req.get('host')}/api/audio/proxy/${info.id}`;
        return res.json(info);
    } catch (error) {
        console.error('オーディオ情報の取得に失敗:', error);
        return res.status(500).json({ error: 'オーディオ情報の取得に失敗しました' });
    }
});

/**
 * GET /api/audio/info/:id
 */
router.get('/info/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ error: '動画IDが必要です' });
    }

    try {
        const info = await getAudioInfo(`https://www.youtube.com/watch?v=${id}`);
        info.audioUrl = `${req.protocol}://${req.get('host')}/api/audio/proxy/${id}`;
        return res.json(info);
    } catch (error) {
        console.error('オーディオ情報の取得に失敗:', error);
        return res.status(500).json({ error: 'オーディオ情報の取得に失敗しました' });
    }
});

/**
 * GET /api/audio/search
 */
router.get('/search', async (req, res) => {
    const { q, limit = '10' } = req.query;
    if (!q || typeof q !== 'string') {
        return res.status(400).json({ error: '検索クエリ(q)が必要です' });
    }

    try {
        const results = await searchYoutube(q, Number.parseInt(limit as string, 10) || 10);
        return res.json(results);
    } catch (_error) {
        return res.status(500).json({ error: 'Search failed' });
    }
});

/**
 * GET /api/audio/proxy/:id
 * yt-dlpを使用してオーディオストリームをパイプする
 */
router.get('/proxy/:id', (req, res) => {
    const { id } = req.params;
    const videoUrl = `https://www.youtube.com/watch?v=${id}`;

    console.log(`Starting stream for ${id} using system yt-dlp`);

    try {
        // システムのyt-dlpをspawn
        const ytDlp = spawn('yt-dlp', [
            '--output',
            '-', // 標準出力へ
            '--format',
            'bestaudio[ext=m4a]/bestaudio[ext=aac]/bestaudio[ext=mp4]/bestaudio', // 互換性を重視
            '--no-warnings',
            '--no-call-home',
            '--no-check-certificates',
            '--prefer-free-formats',
            videoUrl,
        ]);

        // レスポンスヘッダー設定 (Chunked転送)
        res.writeHead(200, {
            'Content-Type': 'audio/mp4', // m4a(AAC)に対応
            'Transfer-Encoding': 'chunked',
            Connection: 'keep-alive',
            'Accept-Ranges': 'bytes',
        });

        // stdout -> response
        ytDlp.stdout.pipe(res);

        // エラーハンドリング
        ytDlp.stderr.on('data', (data) => {
            // 警告などもstderrに出るため、すべてをエラー扱いにはしないがログには出す
            const msg = data.toString();
            if (!msg.includes('WARNING')) {
                console.error(`yt-dlp stderr: ${msg}`);
            }
        });

        // biome-ignore lint/suspicious/noExplicitAny: External library error type
        ytDlp.on('error', (err: any) => {
            console.error('Failed to start yt-dlp process:', err);
            // ヘッダー未送信なら500
            if (!res.headersSent) {
                res.status(500).json({ error: 'Stream process failed' });
            } else {
                res.end();
            }
        });

        ytDlp.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.log(`yt-dlp process exited with code ${code}`);
            }
            res.end();
        });

        // クライアント切断時にプロセスをキル
        req.on('close', () => {
            console.log('Client disconnected, killing yt-dlp process');
            ytDlp.kill();
        });
    } catch (error) {
        console.error('Proxy stream setup failed:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Stream setup failed' });
        }
    }
});

/**
 * GET /api/audio/video/:id
 * 動画ストリーミング用（音楽プレイヤーで動画として再生）
 */
router.get('/video/:id', (req, res) => {
    const { id } = req.params;
    const videoUrl = `https://www.youtube.com/watch?v=${id}`;

    console.log(`Starting video stream for ${id} using system yt-dlp`);

    try {
        // 動画ストリーム用のyt-dlp設定
        const ytDlp = spawn('yt-dlp', [
            '--output',
            '-',
            '--format',
            'best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best', // 720p以下のmp4を優先
            '--no-warnings',
            '--no-call-home',
            '--no-check-certificates',
            videoUrl,
        ]);

        // レスポンスヘッダー設定 (Chunked転送)
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Transfer-Encoding': 'chunked',
            Connection: 'keep-alive',
            'Accept-Ranges': 'bytes',
        });

        // stdout -> response
        ytDlp.stdout.pipe(res);

        // エラーハンドリング
        ytDlp.stderr.on('data', (data) => {
            const msg = data.toString();
            if (!msg.includes('WARNING')) {
                console.error(`yt-dlp video stderr: ${msg}`);
            }
        });

        // biome-ignore lint/suspicious/noExplicitAny: External library error type
        ytDlp.on('error', (err: any) => {
            console.error('Failed to start yt-dlp video process:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Video stream process failed' });
            } else {
                res.end();
            }
        });

        ytDlp.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.log(`yt-dlp video process exited with code ${code}`);
            }
            res.end();
        });

        // クライアント切断時にプロセスをキル
        req.on('close', () => {
            console.log('Client disconnected, killing yt-dlp video process');
            ytDlp.kill();
        });
    } catch (error) {
        console.error('Video proxy stream setup failed:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Video stream setup failed' });
        }
    }
});

/**
 * GET /api/audio/popular
 */
router.get('/popular', async (_req, res) => {
    // プレイリストは変更なし
    const popularTracks: SearchResult[] = [
        {
            id: 'jfKfPfyJRdk',
            title: 'lofi hip hop radio 📚 - beats to relax/study to',
            thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg',
            duration: 0,
            author: 'Lofi Girl',
        },
        {
            id: '4xDzrJKXOOY',
            title: 'synthwave radio 🌌 - beats to chill/game to',
            thumbnail: 'https://i.ytimg.com/vi/4xDzrJKXOOY/hqdefault.jpg',
            duration: 0,
            author: 'Lofi Girl',
        },
        {
            id: 'rUxyKA_-grg',
            title: 'lofi hip hop radio 💤 - beats to sleep/chill to',
            thumbnail: 'https://i.ytimg.com/vi/rUxyKA_-grg/hqdefault.jpg',
            duration: 0,
            author: 'Lofi Girl',
        },
        {
            id: '5yx6BWlEVcY',
            title: 'Chillhop Radio - jazzy & lofi hip hop beats',
            thumbnail: 'https://i.ytimg.com/vi/5yx6BWlEVcY/hqdefault.jpg',
            duration: 0,
            author: 'Chillhop Music',
        },
        {
            id: 'lTRiuFIWV54',
            title: '1 A.M Study Session 📚 - lofi hip hop/chill beats',
            thumbnail: 'https://i.ytimg.com/vi/lTRiuFIWV54/hqdefault.jpg',
            duration: 7200,
            author: 'Lofi Girl',
        },
        {
            id: 'Na0w3Mz46GA',
            title: 'Coffee Shop Ambience ☕ Jazz Music for Study, Work',
            thumbnail: 'https://i.ytimg.com/vi/Na0w3Mz46GA/hqdefault.jpg',
            duration: 10800,
            author: 'Relaxing Jazz Piano',
        },
    ];

    return res.json(popularTracks);
});

export { router };
