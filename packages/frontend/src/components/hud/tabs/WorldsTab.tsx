import { Lobby } from '@/components/lobby/Lobby';
import type { JoinInstanceHandler } from './shared';

interface WorldsTabProps {
    onJoinInstance: JoinInstanceHandler;
    currentInstanceId?: string;
}

export function WorldsTab({ onJoinInstance, currentInstanceId }: WorldsTabProps) {
    return <Lobby onJoinInstance={onJoinInstance} mode="modal" currentInstanceId={currentInstanceId} />;
}
