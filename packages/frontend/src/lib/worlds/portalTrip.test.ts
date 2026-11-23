import { describe, expect, it } from 'vitest';
import { createPortalTrips } from './portalTrip';

describe('createPortalTrips', () => {
    it('途中なら押し直しを無視し、終われば次を始められる', () => {
        const trips = createPortalTrips();
        const first = trips.begin();
        expect(first).not.toBeNull();
        expect(trips.begin()).toBeNull();
        if (first) trips.end(first);
        expect(trips.begin()).not.toBeNull();
    });

    it('部屋を移る・ページを閉じると途中のものを取り消し、次を始められる', () => {
        const trips = createPortalTrips();
        const first = trips.begin();
        trips.cancel();
        expect(first?.aborted).toBe(true);
        const next = trips.begin();
        expect(next?.aborted).toBe(false);
    });

    it('取り消された古いものがあとで終わっても、新しいものを終わらせない（二重に始めさせない）', () => {
        const trips = createPortalTrips();
        const stale = trips.begin();
        trips.cancel();
        const current = trips.begin();
        if (stale) trips.end(stale);
        expect(trips.begin()).toBeNull();
        expect(current?.aborted).toBe(false);
    });

    it('何も始まっていなくても取り消せる', () => {
        const trips = createPortalTrips();
        trips.cancel();
        expect(trips.begin()).not.toBeNull();
    });
});
