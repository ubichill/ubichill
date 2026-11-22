import { useWorld } from '@ubichill/react';
import { unknownCoreComponentsMessage, unknownCoreComponentTypes } from '@ubichill/shared';
import { useEffect, useMemo } from 'react';
import { logConsole } from '@/lib/console/consoleStore';

/** この版が知らない本体の部品（新しい ubichill のワールド）があれば、表示されない部分があることをコンソールに残す。 */
export function useUnknownCoreNotice(): void {
    const { entities } = useWorld();
    const key = useMemo(
        () => unknownCoreComponentTypes(Array.from(entities.values(), (entity) => entity.type)).join(' '),
        [entities],
    );
    useEffect(() => {
        if (key)
            logConsole({ level: 'warning', source: 'ワールド', message: unknownCoreComponentsMessage(key.split(' ')) });
    }, [key]);
}
