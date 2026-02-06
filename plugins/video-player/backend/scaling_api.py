"""
Scaling Management API Endpoints
内部スケーリング制御用のAPIエンドポイント
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
import logging
from .k8s_scaling import scaling_controller

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/internal/scaling", tags=["Internal Scaling"])

# Request/Response Models
class ScaleRequest(BaseModel):
    replicas: int = Field(..., ge=1, le=50, description="Number of replicas (1-50)")

class HPAUpdateRequest(BaseModel):
    min_replicas: Optional[int] = Field(None, ge=1, le=50, description="Minimum replicas")
    max_replicas: Optional[int] = Field(None, ge=1, le=50, description="Maximum replicas")

class BurstModeRequest(BaseModel):
    duration_minutes: int = Field(10, ge=1, le=60, description="Burst duration in minutes (1-60)")

class ScalingStatus(BaseModel):
    enabled: bool
    deployment: Optional[Dict[str, Any]] = None
    hpa: Optional[Dict[str, Any]] = None

class APIResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None

# Authentication/Authorization (簡単な例)
async def verify_internal_access(authorization: Optional[str] = None) -> bool:
    """内部アクセス認証"""
    # 実装例: ヘッダートークンやIP制限など
    # 本番環境では適切な認証機構を実装してください
    import os
    internal_token = os.getenv("INTERNAL_API_TOKEN")
    
    if not internal_token:
        return True  # トークン未設定時は許可（開発環境用）
    
    if not authorization or not authorization.startswith("Bearer "):
        return False
    
    token = authorization[7:]  # "Bearer " を除去
    return token == internal_token

# API Endpoints
@router.get("/status", response_model=ScalingStatus)
async def get_scaling_status():
    """現在のスケーリング状況を取得"""
    try:
        status = await scaling_controller.get_current_status()
        
        if status is None:
            return ScalingStatus(enabled=False)
        
        return ScalingStatus(
            enabled=scaling_controller.enabled,
            deployment=status.get("deployment"),
            hpa=status.get("hpa")
        )
    
    except Exception as e:
        logger.error(f"Error getting scaling status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get scaling status")

@router.post("/deployment/scale", response_model=APIResponse)
async def scale_deployment(
    request: ScaleRequest,
    authorized: bool = Depends(verify_internal_access)
):
    """Deploymentを手動スケール"""
    if not authorized:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    if not scaling_controller.enabled:
        raise HTTPException(status_code=503, detail="Scaling is not available")
    
    try:
        success = await scaling_controller.scale_deployment(request.replicas)
        
        if success:
            return APIResponse(
                success=True,
                message=f"Successfully scaled to {request.replicas} replicas",
                data={"target_replicas": request.replicas}
            )
        else:
            return APIResponse(
                success=False,
                message="Failed to scale deployment"
            )
    
    except Exception as e:
        logger.error(f"Error scaling deployment: {e}")
        raise HTTPException(status_code=500, detail="Scaling operation failed")

@router.patch("/hpa", response_model=APIResponse)
async def update_hpa_limits(
    request: HPAUpdateRequest,
    authorized: bool = Depends(verify_internal_access)
):
    """HPA制限を動的更新"""
    if not authorized:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    if not scaling_controller.enabled:
        raise HTTPException(status_code=503, detail="Scaling is not available")
    
    try:
        success = await scaling_controller.update_hpa_limits(
            min_replicas=request.min_replicas,
            max_replicas=request.max_replicas
        )
        
        if success:
            return APIResponse(
                success=True,
                message="Successfully updated HPA limits",
                data={
                    "min_replicas": request.min_replicas,
                    "max_replicas": request.max_replicas
                }
            )
        else:
            return APIResponse(
                success=False,
                message="Failed to update HPA limits"
            )
    
    except Exception as e:
        logger.error(f"Error updating HPA: {e}")
        raise HTTPException(status_code=500, detail="HPA update failed")

@router.post("/burst", response_model=APIResponse)
async def enable_burst_mode(
    request: BurstModeRequest,
    authorized: bool = Depends(verify_internal_access)
):
    """バーストモード有効化（負荷急増時の緊急スケール）"""
    if not authorized:
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    if not scaling_controller.enabled:
        raise HTTPException(status_code=503, detail="Scaling is not available")
    
    try:
        success = await scaling_controller.enable_burst_mode(request.duration_minutes)
        
        if success:
            return APIResponse(
                success=True,
                message=f"Burst mode enabled for {request.duration_minutes} minutes",
                data={"duration_minutes": request.duration_minutes}
            )
        else:
            return APIResponse(
                success=False,
                message="Failed to enable burst mode"
            )
    
    except Exception as e:
        logger.error(f"Error enabling burst mode: {e}")
        raise HTTPException(status_code=500, detail="Burst mode activation failed")

@router.get("/health")
async def scaling_health_check():
    """スケーリング機能のヘルスチェック"""
    return {
        "status": "healthy" if scaling_controller.enabled else "disabled",
        "scaling_enabled": scaling_controller.enabled,
        "namespace": scaling_controller.namespace,
        "deployment": scaling_controller.deployment_name,
        "hpa": scaling_controller.hpa_name
    }