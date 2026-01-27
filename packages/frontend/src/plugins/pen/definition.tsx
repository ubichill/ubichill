import type { WidgetDefinition } from '../types';
import { PEN_CONFIG } from './config';
import { PenWidget } from './PenWidget';
import type { PenData } from './types';

// ペンアイコン (簡易実装、PenWidgetにあるものを再利用するか、ここで定義するか)
// PenWidget.tsxからPenIconをエクスポートしていないので、一旦アイコンはnullか、PenWidget内部のものを使う。
// ここでは簡易的にnullにしておくか、あとでPenWidgetから分離する。
// User request: definition.tsx imports PenIcon from './icon'.
// I should extract PenIcon from PenWidget.tsx or create icon.tsx.

import { PenIcon } from './PenIcon';

// ペンの初期データ定義
export const penWidgetDefinition: WidgetDefinition<PenData> = {
    id: 'pen', // Entity type ID
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
};
