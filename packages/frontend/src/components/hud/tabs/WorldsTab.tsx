import { WorldBrowser } from '@/components/worlds/WorldBrowser';
import type { JoinInstanceHandler } from './shared';

interface WorldsTabProps {
    onJoinInstance: JoinInstanceHandler;
    currentInstanceId?: string;
}

export function WorldsTab({ onJoinInstance, currentInstanceId }: WorldsTabProps) {
    return <WorldBrowser onJoinInstance={onJoinInstance} currentInstanceId={currentInstanceId} />;
}
