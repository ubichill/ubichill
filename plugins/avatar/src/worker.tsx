import { resetState } from './state';
import { AvatarMainSystem } from './systems/AvatarMainSystem';

resetState();
Ubi.registerSystem(AvatarMainSystem);

console.log('[Avatar Worker] Initialized. Singleton presence mode active.');
