import type { WidgetDefinition } from '@ubichill/sdk';
import { PEN_CONFIG } from './config';
import { PenIcon } from './PenIcon';
import { PenTray } from './PenTray';
import { PenWidget } from './PenWidget';
import type { PenData } from './types';

// ペンの初期データ定義
export const penWidgetDefinition: WidgetDefinition<PenData> = {
    id: 'pen:pen', // Entity type ID
    name: 'Pen',
    icon: <PenIcon color="#000000" />,
    defaultSize: { w: 48, h: 48 }, // Size of one pen
    defaultData: {
        color: PEN_CONFIG.COLORS.BLACK,
        strokeWidth: 4,
        isHeld: false,
    },

    // 実装したコンポーネントを渡す
    Component: PenWidget,

    // シングルトンコンポーネント: ペントレイ（全体UIの一部として1つだけ存在）
    SingletonComponent: PenTray,
};
