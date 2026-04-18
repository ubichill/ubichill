export function cssToState(css: string): string {
    if (css === 'pointer') return 'pointer';
    if (css === 'text' || css === 'vertical-text') return 'text';
    if (css === 'wait' || css === 'progress') return 'wait';
    if (css === 'help') return 'help';
    if (css === 'not-allowed' || css === 'no-drop') return 'not-allowed';
    if (css === 'move') return 'move';
    if (css === 'grabbing') return 'grabbing';
    return 'default';
}
