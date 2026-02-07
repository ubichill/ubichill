"""
Kubernetes Auto-Scaling Controller for Video Player Backend
アプリケーション内部からのスケーリング制御機能
"""
import os
import asyncio
from typing import Optional, Dict, Any
from kubernetes import client, config
from kubernetes.client.rest import ApiException
import logging

logger = logging.getLogger(__name__)

class K8sScalingController:
    """Kubernetes HPA and Deployment スケーリングコントローラー"""
    
    def __init__(self):
        self.namespace = os.getenv("K8S_NAMESPACE", "default")
        self.deployment_name = os.getenv("K8S_DEPLOYMENT_NAME", "video-player-backend")
        self.hpa_name = os.getenv("K8S_HPA_NAME", "video-player-backend")
        
        # Kubernetes client初期化
        try:
            # クラスター内実行時
            config.load_incluster_config()
        except config.ConfigException:
            try:
                # ローカル開発時
                config.load_kube_config()
            except config.ConfigException:
                logger.warning("Kubernetes config not found. Scaling functions disabled.")
                self.enabled = False
                return
        
        self.apps_v1 = client.AppsV1Api()
        self.autoscaling_v2 = client.AutoscalingV2Api()
        self.enabled = True
    
    async def get_current_status(self) -> Optional[Dict[str, Any]]:
        """現在のスケーリング状況を取得"""
        if not self.enabled:
            return None
        
        try:
            # Deployment情報取得
            deployment = self.apps_v1.read_namespaced_deployment(
                name=self.deployment_name,
                namespace=self.namespace
            )
            
            # HPA情報取得
            hpa = None
            try:
                hpa = self.autoscaling_v2.read_namespaced_horizontal_pod_autoscaler(
                    name=self.hpa_name,
                    namespace=self.namespace
                )
            except ApiException as e:
                if e.status != 404:  # HPA not found is okay
                    raise
            
            return {
                "deployment": {
                    "name": deployment.metadata.name,
                    "replicas": {
                        "desired": deployment.spec.replicas,
                        "available": deployment.status.available_replicas or 0,
                        "ready": deployment.status.ready_replicas or 0,
                        "updated": deployment.status.updated_replicas or 0
                    },
                    "conditions": [
                        {
                            "type": condition.type,
                            "status": condition.status,
                            "reason": condition.reason
                        }
                        for condition in (deployment.status.conditions or [])
                    ]
                },
                "hpa": {
                    "enabled": hpa is not None,
                    "min_replicas": hpa.spec.min_replicas if hpa else None,
                    "max_replicas": hpa.spec.max_replicas if hpa else None,
                    "current_replicas": hpa.status.current_replicas if hpa else None,
                    "desired_replicas": hpa.status.desired_replicas if hpa else None,
                    "metrics": [
                        {
                            "type": metric.type,
                            "resource_name": getattr(metric.resource, 'name', None) if hasattr(metric, 'resource') else None,
                            "current_utilization": getattr(metric.resource.current, 'average_utilization', None) if hasattr(metric, 'resource') and hasattr(metric.resource, 'current') else None
                        }
                        for metric in (hpa.status.current_metrics or []) if hpa
                    ] if hpa else []
                } if hpa else {"enabled": False}
            }
            
        except ApiException as e:
            logger.error(f"Failed to get scaling status: {e}")
            return None
    
    async def scale_deployment(self, replicas: int) -> bool:
        """Deploymentを手動スケール"""
        if not self.enabled:
            return False
        
        try:
            # HPA一時無効化の必要性チェック
            hpa_exists = await self._hpa_exists()
            if hpa_exists:
                logger.warning("HPA is active. Manual scaling may be overridden.")
            
            # Deploymentスケール実行
            body = {"spec": {"replicas": replicas}}
            self.apps_v1.patch_namespaced_deployment(
                name=self.deployment_name,
                namespace=self.namespace,
                body=body
            )
            
            logger.info(f"Scaled deployment {self.deployment_name} to {replicas} replicas")
            return True
            
        except ApiException as e:
            logger.error(f"Failed to scale deployment: {e}")
            return False
    
    async def update_hpa_limits(self, min_replicas: Optional[int] = None, max_replicas: Optional[int] = None) -> bool:
        """HPA制限を動的更新"""
        if not self.enabled:
            return False
        
        try:
            hpa = self.autoscaling_v2.read_namespaced_horizontal_pod_autoscaler(
                name=self.hpa_name,
                namespace=self.namespace
            )
            
            # 更新値設定
            if min_replicas is not None:
                hpa.spec.min_replicas = min_replicas
            if max_replicas is not None:
                hpa.spec.max_replicas = max_replicas
            
            # HPA更新実行
            self.autoscaling_v2.patch_namespaced_horizontal_pod_autoscaler(
                name=self.hpa_name,
                namespace=self.namespace,
                body=hpa
            )
            
            logger.info(f"Updated HPA limits: min={min_replicas}, max={max_replicas}")
            return True
            
        except ApiException as e:
            logger.error(f"Failed to update HPA: {e}")
            return False
    
    async def _hpa_exists(self) -> bool:
        """HPA存在確認"""
        try:
            self.autoscaling_v2.read_namespaced_horizontal_pod_autoscaler(
                name=self.hpa_name,
                namespace=self.namespace
            )
            return True
        except ApiException:
            return False
    
    async def enable_burst_mode(self, duration_minutes: int = 10) -> bool:
        """バーストモード: 一時的に最大レプリカ数を増加"""
        if not self.enabled:
            return False
        
        try:
            # 現在のHPA設定取得
            current_status = await self.get_current_status()
            if not current_status or not current_status["hpa"]["enabled"]:
                return False
            
            original_max = current_status["hpa"]["max_replicas"]
            burst_max = min(original_max * 2, 50)  # 2倍または最大50
            
            # バーストモード有効化
            success = await self.update_hpa_limits(max_replicas=burst_max)
            if success:
                logger.info(f"Burst mode enabled: max replicas increased to {burst_max} for {duration_minutes}min")
                
                # 指定時間後に元に戻すタスクをスケジュール
                asyncio.create_task(self._restore_after_burst(original_max, duration_minutes))
            
            return success
            
        except Exception as e:
            logger.error(f"Failed to enable burst mode: {e}")
            return False
    
    async def _restore_after_burst(self, original_max: int, duration_minutes: int):
        """バーストモード終了後の復元"""
        await asyncio.sleep(duration_minutes * 60)
        
        success = await self.update_hpa_limits(max_replicas=original_max)
        if success:
            logger.info(f"Burst mode ended: max replicas restored to {original_max}")
        else:
            logger.error("Failed to restore original HPA limits after burst mode")

# グローバルインスタンス
scaling_controller = K8sScalingController()