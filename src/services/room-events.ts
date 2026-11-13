import type { RoomEvent } from '@/services/realtime';
import { parseRoomStation } from '@/services/room-query';
import type { RoomDetail } from '@/types/room';

export type RefreshTarget = 'detail' | 'proposals' | 'recommendation';
export function roomEventTargets(type: RoomEvent['type']): RefreshTarget[] {
    switch (type) {
        case 'MEMBER_JOINED': case 'DEPARTURE_UPDATED': return ['detail', 'recommendation'];
        case 'MEMBER_LEFT': return ['detail', 'proposals', 'recommendation'];
        case 'OWNER_CHANGED': return ['detail'];
        case 'ROOM_UPDATED': case 'RECOMMENDATION_CREATED': return ['recommendation'];
        case 'STATION_PROPOSAL_CREATED': case 'STATION_PROPOSAL_DELETED': case 'STATION_PROPOSAL_VOTE_CHANGED': return ['proposals'];
        default: return [];
    }
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export function parseSelectedStationEvent(payload: unknown) {
    try {
        if (!record(payload) || !(payload.confirmedAt === null || date(payload.confirmedAt))) return null;
        const station = parseRoomStation(payload.station);
        if ((station === null) !== (payload.confirmedAt === null)) return null;
        return { selectedStation: station, confirmedAt: payload.confirmedAt };
    } catch { return null; }
}
export function mergeRoomUpdated(current: RoomDetail, payload: unknown, includeStation = true): RoomDetail | null {
    try {
        if (!record(payload) || payload.id !== current.id || typeof payload.name !== 'string'
            || !['OPEN', 'CONFIRMED'].includes(String(payload.status))
            || !Number.isInteger(payload.memberCount) || !Number.isInteger(payload.maxMembers)
            || !(payload.appointmentAt === null || date(payload.appointmentAt))) return null;
        const selectedStation = parseRoomStation(payload.selectedStation);
        return { ...current, name: payload.name, status: payload.status as RoomDetail['status'],
            memberCount: payload.memberCount as number, maxMembers: payload.maxMembers as number,
            appointmentAt: payload.appointmentAt,
            ...(includeStation ? { selectedStation, ...(selectedStation === null ? { confirmedAt: null } : {}) } : {}) };
    } catch { return null; }
}
export function recommendationEventAction(currentRunId: string | undefined, incomingRunId: unknown, calculating: boolean, showingResult: boolean) {
    if (calculating || currentRunId && currentRunId === incomingRunId) return 'ignore';
    return showingResult && currentRunId ? 'banner' : 'load';
}

/** Each target owns one timer and one request; arrivals during a request set one trailing refresh. */
export function createRoomEventCoalescer(callback: (target: RefreshTarget) => Promise<void> | void, valid = () => true, delay = 300) {
    let disposed = false;
    const states = new Map<RefreshTarget, { timer?: ReturnType<typeof setTimeout>; running: boolean; pending: boolean }>();
    const enqueue = (target: RefreshTarget) => {
        if (disposed || !valid()) return;
        let state = states.get(target);
        if (!state) { state = { running: false, pending: false }; states.set(target, state); }
        state.pending = true;
        if (state.running || state.timer !== undefined) return;
        const entry = state;
        entry.timer = setTimeout(() => {
            entry.timer = undefined;
            if (disposed || !valid()) return;
            entry.pending = false; entry.running = true;
            void Promise.resolve().then(() => { if (!disposed && valid()) return callback(target); }).catch(() => {}).finally(() => {
                entry.running = false;
                if (entry.pending) enqueue(target);
            });
        }, delay);
    };
    return { request: (targets: RefreshTarget[]) => targets.forEach(enqueue), dispose: () => {
        disposed = true; states.forEach(state => clearTimeout(state.timer)); states.clear();
    } };
}
