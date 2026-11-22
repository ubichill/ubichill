import { useWorld } from '@ubichill/react';
import type { ComponentInstance } from '@ubichill/shared';
import { useState } from 'react';
import { createPressGuard, entityScripts, hasUiButton } from './entityButton';
import { useScriptRunner } from './useScriptRunner';

/**
 * スクリプト（ワープ・スイッチ・ポータル）の Component が、自分の設定と動かし方を引く。onButton なら同じ Entity の
 * UI のボタンで動くので、自分では押せるものを描かない。
 */
export function useEntityScript(entity: ComponentInstance) {
    const { entities } = useWorld();
    const runner = useScriptRunner();
    const [guard] = useState(createPressGuard);
    const entityId = entity.entityId ?? entity.id;
    const script = entityScripts([entity], entityId)[0] ?? null;
    return {
        script,
        onButton: hasUiButton(entities.values(), entityId),
        ready: !!script && runner.ready(script),
        run: (pressedName: string) => {
            if (script) guard(() => runner.run(script, pressedName));
        },
    };
}
