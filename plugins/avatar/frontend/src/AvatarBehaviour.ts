// Avatar Plugin Behaviour - Pure TypeScript
export const avatarPluginCode = `
class AvatarBehaviour extends UbiBehaviour {
    currentPosition = { x: 0, y: 0 };
    targetPosition = { x: 0, y: 0 };
    isInitialized = false;

    update(deltaTime) {
        if (!this.isInitialized) return;

        const dx = this.targetPosition.x - this.currentPosition.x;
        const dy = this.targetPosition.y - this.currentPosition.y;
        const lerpFactor = Math.min(1, deltaTime * 0.015);

        if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) {
            this.currentPosition.x = this.targetPosition.x;
            this.currentPosition.y = this.targetPosition.y;
        } else {
            this.currentPosition.x += dx * lerpFactor;
            this.currentPosition.y += dy * lerpFactor;
        }

        Ubi.scene.updateCursorPosition(this.currentPosition.x, this.currentPosition.y);
    }

    onCustomEvent(eventType, data) {
        if (eventType === 'SET_TARGET_POSITION' && data) {
            const { x, y } = data;
            this.targetPosition = { x, y };
            if (!this.isInitialized) {
                this.currentPosition = { x, y };
                this.isInitialized = true;
                Ubi.scene.updateCursorPosition(x, y);
            }
        }
    }
}

Ubi.registerBehaviour(new AvatarBehaviour());
`;
