"""
Redis Cache Layer for Video Player Backend
スケーラビリティ向上のための実装例
"""
from fastapi import FastAPI, HTTPException, Response, Request
from fastapi.responses import RedirectResponse
import redis.asyncio as redis
from typing import Optional
import json
import hashlib
import os

app = FastAPI()

# Redis設定
REDIS_ENABLED = os.getenv("REDIS_ENABLED", "false").lower() == "true"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))  # 1時間

# Redis接続（オプション）
redis_client: Optional[redis.Redis] = None

@app.on_event("startup")
async def startup():
    global redis_client
    if REDIS_ENABLED:
        try:
            redis_client = await redis.from_url(
                REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                max_connections=50
            )
            await redis_client.ping()
            print("✅ Redis cache enabled")
        except Exception as e:
            print(f"⚠️ Redis connection failed: {e}")
            redis_client = None

@app.on_event("shutdown")
async def shutdown():
    if redis_client:
        await redis_client.close()

def get_cache_key(prefix: str, identifier: str) -> str:
    """キャッシュキーを生成"""
    return f"{prefix}:{hashlib.md5(identifier.encode()).hexdigest()}"

async def get_cached(key: str) -> Optional[str]:
    """キャッシュから取得"""
    if not redis_client:
        return None
    try:
        return await redis_client.get(key)
    except Exception as e:
        print(f"⚠️ Cache get error: {e}")
        return None

async def set_cached(key: str, value: str, ttl: int = CACHE_TTL):
    """キャッシュに保存"""
    if not redis_client:
        return
    try:
        await redis_client.setex(key, ttl, value)
    except Exception as e:
        print(f"⚠️ Cache set error: {e}")

@app.get("/api/stream/video/{video_id}")
async def stream_video_cached(video_id: str):
    """
    通常動画配信（キャッシュ対応版）
    1. Redisからストリーム URLを取得
    2. キャッシュミスの場合、yt-dlpで取得
    3. URLをキャッシュに保存
    4. 302リダイレクト
    """
    cache_key = get_cache_key("video", video_id)
    
    # キャッシュ確認
    cached_url = await get_cached(cache_key)
    if cached_url:
        print(f"✅ Cache HIT: {video_id}")
        return RedirectResponse(url=cached_url, status_code=302)
    
    print(f"❌ Cache MISS: {video_id}")
    
    # yt-dlpで取得（既存のロジック）
    try:
        import yt_dlp
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"
        
        stream_opts = {
            'quiet': True,
            'no_warnings': True,
            'format': 'best[height<=720][ext=mp4]/best',
            'youtube_include_dash_manifest': False,
        }
        
        with yt_dlp.YoutubeDL(stream_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
            stream_url = info.get('url')
            
            if not stream_url:
                raise HTTPException(status_code=404, detail="Stream URL not found")
        
        # キャッシュに保存
        await set_cached(cache_key, stream_url)
        
        return RedirectResponse(url=stream_url, status_code=302)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stream/info/{video_id}")
async def get_video_info_cached(video_id: str):
    """
    動画情報取得（キャッシュ対応版）
    メタデータは変更されにくいため、TTL長め（24時間）
    """
    cache_key = get_cache_key("info", video_id)
    
    # キャッシュ確認
    cached_info = await get_cached(cache_key)
    if cached_info:
        print(f"✅ Info Cache HIT: {video_id}")
        return json.loads(cached_info)
    
    print(f"❌ Info Cache MISS: {video_id}")
    
    # yt-dlpで取得
    try:
        import yt_dlp
        youtube_url = f"https://www.youtube.com/watch?v={video_id}"
        
        info_opts = {
            'quiet': True,
            'no_warnings': True,
            'extract_flat': False,
        }
        
        with yt_dlp.YoutubeDL(info_opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
            
            result = {
                "id": info.get("id"),
                "title": info.get("title", "Unknown"),
                "thumbnail": info.get("thumbnail", ""),
                "duration": info.get("duration", 0),
                "author": info.get("uploader", "Unknown"),
                "streamUrl": f"/api/stream/video/{video_id}"
            }
        
        # キャッシュに保存（24時間）
        await set_cached(cache_key, json.dumps(result), ttl=86400)
        
        return result
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/cache/stats")
async def cache_stats():
    """キャッシュ統計情報"""
    if not redis_client:
        return {"enabled": False}
    
    try:
        info = await redis_client.info()
        return {
            "enabled": True,
            "connected_clients": info.get("connected_clients"),
            "used_memory_human": info.get("used_memory_human"),
            "keyspace_hits": info.get("keyspace_hits", 0),
            "keyspace_misses": info.get("keyspace_misses", 0),
            "hit_rate": round(
                info.get("keyspace_hits", 0) / 
                (info.get("keyspace_hits", 0) + info.get("keyspace_misses", 1)) * 100,
                2
            )
        }
    except Exception as e:
        return {"enabled": True, "error": str(e)}

@app.delete("/cache/clear")
async def clear_cache():
    """キャッシュクリア（管理用）"""
    if not redis_client:
        raise HTTPException(status_code=503, detail="Cache not enabled")
    
    try:
        await redis_client.flushdb()
        return {"message": "Cache cleared successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
