from fastapi import FastAPI, HTTPException, Response, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
import yt_dlp
import httpx
from typing import Dict, Any
import re
import os
from urllib.parse import urljoin, quote

# ROOT_PATH環境変数を取得（Kubernetes Ingressでのプレフィックス対応）
root_path = os.getenv("ROOT_PATH", "")

app = FastAPI(
    title="Ubichill Video Player API",
    version="1.0.0",
    root_path=root_path
)

# CORS設定（環境変数から取得、デフォルトは開発環境用）
allowed_origins = os.getenv(
    "CORS_ORIGINS", "http://localhost:3000,http://localhost:3001"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins]
    if allowed_origins != ["*"]
    else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class YTDLPLogger:
    """yt-dlpのログを制御"""

    def debug(self, msg):
        pass

    def warning(self, msg):
        pass

    def error(self, msg):
        print(f"yt-dlp error: {msg}")


# yt-dlpの設定
YDL_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "logger": YTDLPLogger(),
    "extract_flat": False,
    "format": "best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best",
}


@app.get("/")
async def health_check():
    return {"message": "Ubichill Music Streaming API", "status": "healthy"}


@app.get("/search")
async def search_tracks(q: str, limit: int = 10):
    """YouTube検索"""
    try:
        search_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "logger": YTDLPLogger(),
            "extract_flat": True,
            "playlist_items": f"1:{limit}",
        }

        with yt_dlp.YoutubeDL(search_opts) as ydl:
            # YouTube検索
            search_results = ydl.extract_info(f"ytsearch{limit}:{q}", download=False)

            tracks = []
            if search_results is not None and "entries" in search_results:
                for entry in search_results["entries"]:
                    if entry:
                        tracks.append(
                            {
                                "id": entry.get("id"),
                                "title": entry.get("title", "Unknown"),
                                "thumbnail": entry.get("thumbnail", ""),
                                "duration": entry.get("duration", 0),
                                "author": entry.get("uploader", "Unknown"),
                            }
                        )

            return tracks
    except Exception as e:
        print(f"Search error: {e}")


@app.get("/info/{video_id}")
async def get_video_info(video_id: str, request: Request):
    """動画情報を取得"""
    try:
        ydl_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "logger": YTDLPLogger(),
            "extract_flat": False,
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(
                f"https://www.youtube.com/watch?v={video_id}", download=False
            )

            # リクエストのベースURLを取得して完全なURLを生成
            base_url = f"{request.url.scheme}://{request.url.netloc}"

            return {
                "id": info.get("id"),
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "duration": info.get("duration", 0),
                "author": info.get("uploader", "Unknown"),
                "streamUrl": f"{base_url}/api/stream/video/{video_id}",
            }
    except Exception as e:
        error_msg = str(e)
        if "Requested format is not available" in error_msg:
            raise HTTPException(
                status_code=400, detail=f"Video format not supported for ID: {video_id}"
            )
        elif "Video unavailable" in error_msg:
            raise HTTPException(status_code=404, detail=f"Video not found: {video_id}")
        else:
            raise HTTPException(
                status_code=500, detail=f"Failed to get video info: {error_msg}"
            )


@app.get("/popular")
async def get_popular_tracks():
    """人気トラックを返す（サンプル）"""
    # 実際のプロダクションでは、データベースやキャッシュから取得
    popular_tracks = [
        {
            "id": "dQw4w9WgXcQ",
            "title": "Rick Astley - Never Gonna Give You Up",
            "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
            "duration": 213,
            "author": "Rick Astley",
        },
        {
            "id": "9bZkp7q19f0",
            "title": "PSY - GANGNAM STYLE",
            "thumbnail": "https://img.youtube.com/vi/9bZkp7q19f0/maxresdefault.jpg",
            "duration": 252,
            "author": "officialpsy",
        },
    ]
    return popular_tracks


# ヘルパー関数
def _rewrite_manifest_urls(content: str, base_url: str) -> str:
    """HLSマニフェスト内のURLをプロキシURL に書き換え"""
    
    proxy_path = f"{root_path}/proxy" if root_path else "/proxy"

    def replace_url(match):
        original_url = match.group(1)
        if original_url.startswith(proxy_path):
            return original_url
        full_url = (
            original_url
            if original_url.startswith("http")
            else urljoin(base_url, original_url)
        )
        return f"{proxy_path}?url={quote(full_url, safe='')}"

    content = re.sub(r'(https?://[^\s"]+\.(?:m3u8|ts))', replace_url, content)
    content = re.sub(
        r"^(?!#)([^\s]+\.(?:m3u8|ts))$", replace_url, content, flags=re.MULTILINE
    )
    return content


def _get_content_type_for_ts(content: bytes, original_type: str) -> str:
    """TSセグメントのContent-Typeを検出"""
    if len(content) > 0 and content[0] == 0x47:
        return "video/MP2T"  # MPEG-TS magic byte detected
    return original_type


@app.get("/proxy")
async def proxy_url(url: str, request: Request):
    """任意のURLをプロキシ（HLSセグメント用）"""
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "*/*",
        "Referer": "https://www.youtube.com/",
        "Origin": "https://www.youtube.com",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()

            content_type = response.headers.get(
                "content-type", "application/octet-stream"
            )
            is_manifest = url.endswith(".m3u8") or "mpegurl" in content_type

            if is_manifest:
                # マニフェストの場合はURLを書き換え
                base_url = url.rsplit("/", 1)[0] + "/"
                content = _rewrite_manifest_urls(response.text, base_url)
                return Response(
                    content=content,
                    media_type="application/vnd.apple.mpegurl",
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "no-cache",
                    },
                )
            else:
                # TSセグメントの場合はContent-Typeを検出
                is_ts = ".ts" in url or "seg.ts" in url
                final_type = (
                    _get_content_type_for_ts(response.content, content_type)
                    if is_ts
                    else content_type
                )
                return Response(
                    content=response.content,
                    media_type=final_type,
                    headers={
                        "Access-Control-Allow-Origin": "*",
                        "Cache-Control": "public, max-age=3600",
                    },
                )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Request timeout")
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail="HTTP error")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Proxy error: {str(e)}")


@app.get("/live/{video_id}")
async def stream_live(video_id: str, request: Request):
    """ライブストリーム配信（HLS最適化）"""
    try:
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"

        # ライブストリーム用フォーマット（HLS優先、720p以下）
        stream_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "logger": YTDLPLogger(),
            "format": "95/96/best[height<=720]/best",
            "youtube_include_dash_manifest": False,
            "hls_prefer_native": False,
        }

        with yt_dlp.YoutubeDL(stream_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
            stream_url = info.get("url")

            if not stream_url:
                raise HTTPException(status_code=404, detail="Stream URL not found")

        return await proxy_url(stream_url, request)

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        if "unavailable" in error_msg.lower():
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "LIVE_UNAVAILABLE",
                    "message": "このライブ配信は利用できません。",
                },
            )
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "STREAM_ERROR",
                    "message": f"配信エラー: {error_msg[:100]}",
                },
            )


@app.get("/video/{video_id}")
async def stream_video(video_id: str):
    """通常動画配信（MP4直接再生 - リダイレクト方式）"""
    try:
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"

        # 通常動画用フォーマット（MP4優先、720p以下で安定性重視）
        stream_opts: Dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "logger": YTDLPLogger(),
            "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
            "youtube_include_dash_manifest": False,
        }

        with yt_dlp.YoutubeDL(stream_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
            stream_url = info.get("url")

            if not stream_url:
                raise HTTPException(status_code=404, detail="Stream URL not found")

        # 通常動画は直接URLにリダイレクト（プロキシ不要）
        return RedirectResponse(url=stream_url, status_code=302)

    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)

        if "processing this video" in error_msg.lower():
            raise HTTPException(
                status_code=503,
                detail={
                    "error": "VIDEO_PROCESSING",
                    "message": "この動画は現在処理中です。しばらくしてからもう一度お試しください。",
                },
            )
        elif "unavailable" in error_msg.lower():
            raise HTTPException(
                status_code=404,
                detail={
                    "error": "VIDEO_UNAVAILABLE",
                    "message": "この動画は利用できません。削除されたか、非公開になっている可能性があります。",
                },
            )
        elif "private video" in error_msg.lower():
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "VIDEO_PRIVATE",
                    "message": "この動画は非公開に設定されています。",
                },
            )
        elif (
            "no video formats found" in error_msg.lower()
            or "format" in error_msg.lower()
        ):
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "FORMAT_NOT_SUPPORTED",
                    "message": "この動画のフォーマットはサポートされていません。",
                },
            )
        else:
            raise HTTPException(
                status_code=500,
                detail={
                    "error": "VIDEO_ERROR",
                    "message": f"動画エラー: {error_msg[:100]}",
                },
            )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
