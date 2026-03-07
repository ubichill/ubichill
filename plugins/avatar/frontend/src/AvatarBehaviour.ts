export const avatarPluginCode = `
const cursor = Ubi.world.createEntity('avatar-cursor');
cursor.setComponent('Position', { x: 0, y: 0 });
cursor.setComponent('Target', { x: 0, y: 0 });
cursor.setComponent('State', { initialized: false });

Ubi.registerSystem((entities, deltaTime, events) => {
    for (const event of events) {
        if (event.type === 'SET_TARGET_POSITION') {
            const { x, y } = event.payload;
            cursor.setComponent('Target', { x, y });
            const state = cursor.getComponent('State');
            if (!state.initialized) {
                cursor.setComponent('Position', { x, y });
                cursor.setComponent('State', { initialized: true });
                Ubi.scene.updateCursorPosition(x, y);
            }
        }
    }

    const state = cursor.getComponent('State');
    if (!state.initialized) return;

    const pos = cursor.getComponent('Position');
    const target = cursor.getComponent('Target');
    const lerpFactor = Math.min(1, deltaTime * 0.015);
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;

    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
        cursor.setComponent('Position', { x: target.x, y: target.y });
    } else {
        cursor.setComponent('Position', {
            x: pos.x + dx * lerpFactor,
            y: pos.y + dy * lerpFactor,
        });
    }

    const newPos = cursor.getComponent('Position');
    Ubi.scene.updateCursorPosition(newPos.x, newPos.y);
});
`;
