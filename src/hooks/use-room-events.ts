import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMock as isMockMode } from '@/services/api/config';
import { getSessionGeneration } from '@/services/auth';
import { getRoomCacheScope, subscribeRoomCacheReset } from '@/services/room-cache';
import { subscribeTokenStorage } from '@/services/token-storage';
import { subscribeRoomEvents, type RoomEvent } from '@/services/realtime';
import { createRoomEventCoalescer, roomEventTargets, type RefreshTarget } from '@/services/room-events';
import { subscribeAuthState } from '@/stores/auth-store';

export function roomEventsScope() {
    if (isMockMode()) return 'mock';
    try { return getRoomCacheScope(); } catch { return 'signedOut'; }
}
type Callbacks = {
    refresh: (target: RefreshTarget, valid: () => boolean) => Promise<void> | void;
    receive?: (event: RoomEvent) => boolean | RefreshTarget[] | void;
    rejected: (code: 'NOT_ROOM_MEMBER' | 'ROOM_NOT_FOUND') => void;
};
function subscribeScope(listener: () => void) {
    const cleanups = [subscribeAuthState(listener), subscribeTokenStorage(listener), subscribeRoomCacheReset(listener)];
    return () => cleanups.forEach(cleanup => cleanup());
}
export function useRoomEvents(roomId: string, callbacks: Callbacks) {
    const scope = useSyncExternalStore(subscribeScope, roomEventsScope, roomEventsScope);
    const latest = useRef(callbacks);
    useEffect(() => { latest.current = callbacks; }, [callbacks]);
    useEffect(() => {
        if (scope === 'mock' || scope === 'signedOut') return;
        const generation = getSessionGeneration();
        let active = true;
        const valid = () => active && generation === getSessionGeneration() && roomEventsScope() === scope;
        const queue = createRoomEventCoalescer(target => latest.current.refresh(target, valid), valid);
        let unsubscribe: () => void = () => {};
        try {
            unsubscribe = subscribeRoomEvents(roomId, event => {
                if (!valid() || event.roomId.toLowerCase() !== roomId.toLowerCase()) return;
                const result = latest.current.receive?.(event);
                if (result !== false) queue.request(Array.isArray(result) ? result : roomEventTargets(event.type));
            }, {
                onReconnected: () => { if (valid()) queue.request(['detail', 'proposals', 'recommendation']); },
                onRejected: code => {
                    if (valid() && (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND')) {
                        latest.current.rejected(code);
                        active = false; queue.dispose();
                    }
                },
            });
        } catch {
            if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[room-events] realtime subscription unavailable');
        }
        return () => { active = false; queue.dispose(); unsubscribe(); };
    }, [roomId, scope]);
    return scope;
}
