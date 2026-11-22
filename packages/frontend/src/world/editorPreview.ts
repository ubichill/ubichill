import { createContext, useContext } from 'react';

/**
 * エディタのプレビューで描いているか。エディタでは、部屋では見えない印（スポーン）を描き、見えない Entity を薄く描く
 * （選んで直せるように）。
 */
const EditorPreviewContext = createContext(false);

export const EditorPreviewProvider = EditorPreviewContext.Provider;

export const useEditorPreview = (): boolean => useContext(EditorPreviewContext);
