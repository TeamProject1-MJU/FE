import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { Client } from '@stomp/stompjs';
import { API_BASE_URL, useMock as isMockMode } from '@/services/api/config';
import { isAuthError } from '@/services/api/errors';
import { clearLocalSession, getSessionGeneration, refreshSession } from '@/services/auth';
import { getAccessToken, subscribeTokenStorage } from '@/services/token-storage';
import { getRoomCacheScope, removeCachedRoom, subscribeRoomCacheReset } from '@/services/room-cache';

export type RealtimeState = 'idle' | 'connecting' | 'open' | 'closed';
const eventTypes = [
    'MESSAGE_CREATED', 'MEMBER_JOINED', 'MEMBER_LEFT', 'OWNER_CHANGED', 'DEPARTURE_UPDATED',
    'ROOM_UPDATED', 'RECOMMENDATION_CREATED', 'STATION_PROPOSAL_CREATED', 'STATION_PROPOSAL_DELETED',
    'STATION_PROPOSAL_VOTE_CHANGED', 'SELECTED_STATION_CHANGED',
] as const;
export type RoomEvent = { type: typeof eventTypes[number]; roomId: string; payload: Record<string, unknown>; at: string };
export type RoomEventOptions = {
    onReconnected?: () => void;
    /** NOT_ROOM_MEMBER / ROOM_NOT_FOUND는 접근 불가, 그 외 코드는 반복 실패로 구독을 포기한 경우예요. */
    onRejected?: (code: string) => void;
};
type Registration = { listener: (event: RoomEvent) => void; options: RoomEventOptions; connected: boolean };
type Room = { listeners: Set<Registration>; unsubscribe?: () => void; failures: number };
type Frame = { headers: Record<string, string>; body: string };

// Only this adapter knows STOMP. The service cannot publish/SEND.
type Transport = {
    start: () => void;
    close: () => void;
    subscribe: (roomId: string, id: string, receipt: string, message: (body: string) => void, confirmed: () => void) => () => void;
};
type TransportOptions = {
    url: string; token: string;
    socketFactory: (url: string, protocols: string[]) => WebSocket;
    connected: () => void; error: (frame: Frame) => void;
    closed: (event: { code: number; reason: string }) => void;
};
function createStompTransport(options: TransportOptions): Transport {
    const socket = options.socketFactory(options.url, ['v12.stomp']);
    const client = new Client({
        webSocketFactory: () => socket,
        connectHeaders: { Authorization: `Bearer ${options.token}` },
        heartbeatIncoming: 10000, heartbeatOutgoing: 10000,
        reconnectDelay: 0, connectionTimeout: 10000,
        forceBinaryWSFrames: Platform.OS !== 'web',
        appendMissingNULLonIncoming: Platform.OS !== 'web',
        discardWebsocketOnCommFailure: true,
        debug: () => {}, logRawCommunication: false,
        onConnect: options.connected, onStompError: options.error, onWebSocketClose: options.closed,
    });
    return {
        start: () => client.activate(),
        close: () => {
            void client.deactivate({ force: true }).catch(() => {});
            if (socket.readyState < 2) socket.close();
        },
        subscribe: (roomId, id, receipt, message, confirmed) => {
            client.watchForReceipt(receipt, confirmed);
            const subscription = client.subscribe(`/topic/rooms/${roomId}`, frame => message(frame.body), { id, receipt });
            return () => { if (client.connected) subscription.unsubscribe(); };
        },
    };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const safely = (callback: () => void) => { try { callback(); } catch { /* Consumer failures are isolated. */ } };
export function buildRealtimeUrl(base: string): string {
    try {
        if (!/^https?:\/\/[^/?#\\\s]+\/api\/v1$/.test(base)) throw new Error();
        const url = new URL(base);
        if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password
            || url.pathname !== '/api/v1' || url.search || url.hash) throw new Error();
        return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`;
    } catch { throw new Error('WebSocket 서버 주소는 http(s)://호스트/api/v1 형식이어야 해요.'); }
}
function expiring(token: string) {
    try {
        const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const value: unknown = JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '=')));
        return record(value) && typeof value.exp === 'number' && Number.isFinite(value.exp) && value.exp * 1000 <= Date.now() + 60000;
    } catch { return false; }
}

/** Socket/client injection stays behind the same public subscription API. */
export function createRealtimeService(dependencies: {
    socketFactory?: TransportOptions['socketFactory'];
    clientFactory?: (options: TransportOptions) => Transport;
    random?: () => number;
} = {}) {
    const rooms = new Map<string, Room>();
    const stateListeners = new Set<() => void>();
    let state: RealtimeState = 'idle';
    let transport: Transport | undefined;
    let scope: string | undefined;
    let epoch = 0;
    let attempt = 0;
    let serial = 0;
    let authRetried = false;
    let unidentifiedFailures = 0;
    let starting = false;
    let suspended = false;
    let backgroundAt: number | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let backgroundTimer: ReturnType<typeof setTimeout> | undefined;
    let scopeTimer: ReturnType<typeof setInterval> | undefined;
    let removeAppListener: (() => void) | undefined;
    let removeTokenListener: (() => void) | undefined;
    let removeResetListener: (() => void) | undefined;
    const pending = new Map<string, string>();
    const setState = (value: RealtimeState) => {
        if (state === value) return;
        state = value;
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[realtime]', value);
        stateListeners.forEach(listener => safely(listener));
    };
    function stop() {
        epoch++; starting = false;
        clearTimeout(retryTimer); retryTimer = undefined;
        const previous = transport; transport = undefined;
        pending.clear();
        rooms.forEach(room => { room.unsubscribe = undefined; });
        previous?.close();
        setState('closed');
    }
    function reset() {
        stop(); rooms.clear(); scope = undefined; attempt = 0; authRetried = false; unidentifiedFailures = 0;
        clearTimeout(idleTimer); idleTimer = undefined;
        clearTimeout(backgroundTimer); backgroundTimer = undefined;
        clearInterval(scopeTimer); scopeTimer = undefined;
        removeAppListener?.(); removeAppListener = undefined;
        removeTokenListener?.(); removeTokenListener = undefined;
        removeResetListener?.(); removeResetListener = undefined;
        suspended = false; backgroundAt = undefined;
    }
    function validScope() {
        if (!scope) return false;
        try { if (getRoomCacheScope() === scope) return true; } catch { /* Signed out. */ }
        reset(); return false;
    }
    function current(connection: number) { return connection === epoch && validScope(); }
    function retry(immediate = false) {
        if (!rooms.size || suspended || !validScope() || retryTimer !== undefined) return;
        const delay = immediate ? 0 : Math.round(Math.min(30000, 1000 * 2 ** Math.min(attempt++, 5)) * (0.8 + (dependencies.random ?? Math.random)() * 0.4));
        retryTimer = setTimeout(() => { retryTimer = undefined; void connect(); }, delay);
    }
    async function failAuth() {
        const generation = getSessionGeneration();
        if (!validScope()) return;
        reset();
        await clearLocalSession(generation);
    }
    function deliver(roomId: string, room: Room, body: string, connection: number) {
        const drop = (reason: string) => {
            if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug(`[realtime] drop: ${reason}`);
        };
        if (!current(connection) || rooms.get(roomId) !== room) return drop('inactive subscription');
        try {
            const value: unknown = JSON.parse(body);
            if (!record(value)) return drop('invalid envelope');
            if (typeof value.type !== 'string') return drop('invalid type');
            if (!(eventTypes as readonly string[]).includes(value.type)) return drop('unknown type');
            if (typeof value.roomId !== 'string' || !uuid.test(value.roomId)) return drop('invalid roomId');
            if (value.roomId.toLowerCase() !== roomId) return drop('roomId mismatch');
            if (!record(value.payload)) return drop('invalid payload');
            if (typeof value.at !== 'string'
                || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value.at) || !Number.isFinite(Date.parse(value.at))
                || new Date(value.at).toISOString().slice(0, 19) !== value.at.slice(0, 19)) return drop('invalid at');
            const event = { type: value.type, roomId: value.roomId, payload: value.payload, at: value.at } as RoomEvent;
            for (const registration of [...room.listeners]) {
                if (!current(connection) || rooms.get(roomId) !== room) break;
                if (room.listeners.has(registration)) safely(() => registration.listener(event));
            }
        } catch { drop('invalid JSON'); }
    }
    function subscribe(roomId: string, room: Room, connection: number) {
        if (!transport || room.unsubscribe || !room.listeners.size) return;
        const id = `sub-${++serial}`;
        const receipt = `receipt-${serial}`;
        pending.set(receipt, roomId);
        room.unsubscribe = transport.subscribe(roomId, id, receipt, body => deliver(roomId, room, body, connection), () => {
            if (current(connection) && rooms.get(roomId) === room) {
                pending.delete(receipt); authRetried = false; room.failures = 0;
            }
        });
        for (const registration of [...room.listeners]) {
            const reconnect = registration.connected;
            registration.connected = true;
            if (reconnect && current(connection) && room.listeners.has(registration)) safely(() => registration.options.onReconnected?.());
        }
    }
    function forgetRoom(roomId: string) {
        if (isMockMode()) return;
        const id = roomId.toLowerCase(); const room = rooms.get(id);
        rooms.delete(id);
        for (const [receipt, pendingRoom] of pending) if (pendingRoom === id) pending.delete(receipt);
        safely(() => room?.unsubscribe?.());
        if (!rooms.size && idleTimer === undefined) idleTimer = setTimeout(() => {
            idleTimer = undefined; if (!rooms.size) reset();
        }, 10000);
    }
    async function handleError(frame: Frame, connection: number) {
        if (!current(connection)) return;
        const known = ['AUTH_REQUIRED', 'TOKEN_EXPIRED', 'TOKEN_INVALID', 'NOT_ROOM_MEMBER', 'ROOM_NOT_FOUND', 'VALIDATION_ERROR', 'ACCESS_DENIED', 'INTERNAL_ERROR'];
        const code = known.includes(frame.headers.message) ? frame.headers.message : 'INTERNAL_ERROR';
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[realtime]', code);
        const roomId = frame.headers['receipt-id'] ? pending.get(frame.headers['receipt-id']) : [...pending.values()].at(-1);
        const recovery = connection + 1;
        stop();
        if (!current(recovery)) return;
        if (['TOKEN_EXPIRED', 'TOKEN_INVALID', 'AUTH_REQUIRED'].includes(code)) {
            if (authRetried) { await failAuth(); return; }
            authRetried = true;
            try { await refreshSession(); }
            catch (error) {
                if (current(recovery)) {
                    if (isAuthError(error)) await failAuth(); else retry();
                }
                return;
            }
            if (current(recovery)) retry(true);
            return;
        }
        if (roomId) {
            const room = rooms.get(roomId);
            const denied = code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND';
            if (room && (denied || ++room.failures >= 3)) {
                const registrations = [...room.listeners];
                forgetRoom(roomId);
                if (denied && scope) removeCachedRoom(roomId, scope);
                registrations.forEach(registration => { if (current(recovery)) safely(() => registration.options.onRejected?.(code)); });
            }
        } else if (++unidentifiedFailures >= 3) {
            for (const [id, room] of [...rooms]) {
                forgetRoom(id);
                room.listeners.forEach(registration => safely(() => registration.options.onRejected?.(code)));
            }
        }
        if (current(recovery)) retry();
    }
    async function connect() {
        if (starting || transport || suspended || !rooms.size || !validScope()) return;
        starting = true; setState('connecting');
        const connection = ++epoch;
        try {
            let token = getAccessToken();
            if (!token) { await failAuth(); return; }
            if (expiring(token)) {
                await refreshSession();
                if (!current(connection)) return;
                token = getAccessToken();
                if (!token) { await failAuth(); return; }
            }
            if (!current(connection) || !rooms.size || suspended) return;
            const client = (dependencies.clientFactory ?? createStompTransport)({
                url: buildRealtimeUrl(API_BASE_URL), token,
                socketFactory: dependencies.socketFactory ?? ((url, protocols) => new WebSocket(url, protocols)),
                connected: () => {
                    if (!current(connection)) return;
                    starting = false; attempt = 0; authRetried = false; unidentifiedFailures = 0; setState('open');
                    for (const [id, room] of rooms) {
                        if (!current(connection)) break;
                        subscribe(id, room, connection);
                    }
                },
                error: frame => { void handleError(frame, connection); },
                closed: event => {
                    if (!current(connection)) return;
                    if (event.code === 1008 && event.reason === 'ACCOUNT_WITHDRAWN') { void failAuth(); return; }
                    stop(); retry();
                },
            });
            transport = client; client.start();
        } catch (error) {
            if (!current(connection)) return;
            stop();
            if (isAuthError(error)) await failAuth(); else retry();
        } finally { if (connection === epoch) starting = false; }
    }
    function watchSession() {
        if (scopeTimer !== undefined) return;
        // Cache resets are lazy; also observe token changes and check session scope while registered.
        scopeTimer = setInterval(validScope, 1000);
        removeResetListener = subscribeRoomCacheReset(reset);
        removeTokenListener = subscribeTokenStorage(() => { validScope(); });
        const background = () => {
            if (backgroundAt !== undefined) return;
            backgroundAt = Date.now();
            backgroundTimer = setTimeout(() => { suspended = true; stop(); }, 30000);
        };
        if (AppState.currentState === 'background') background();
        const subscription = AppState.addEventListener('change', next => {
            if (!validScope()) return;
            if (next === 'background') background();
            if (next === 'active') {
                clearTimeout(backgroundTimer); backgroundTimer = undefined;
                if (backgroundAt !== undefined && Date.now() - backgroundAt >= 30000) stop();
                backgroundAt = undefined; suspended = false;
                if (rooms.size) void connect();
            }
        });
        removeAppListener = () => subscription.remove();
    }
    return {
        subscribeRoomEvents(roomId: string, listener: Registration['listener'], options: RoomEventOptions = {}) {
            if (isMockMode()) return () => {};
            buildRealtimeUrl(API_BASE_URL);
            if (!uuid.test(roomId)) throw new Error('방 ID는 UUID 형식이어야 해요.');
            validScope();
            scope = getRoomCacheScope();
            watchSession();
            clearTimeout(idleTimer); idleTimer = undefined;
            const id = roomId.toLowerCase();
            let room = rooms.get(id);
            if (!room) { room = { listeners: new Set(), failures: 0 }; rooms.set(id, room); }
            const registration: Registration = { listener, options, connected: !!room.unsubscribe };
            room.listeners.add(registration);
            if (state === 'open') subscribe(id, room, epoch); else if (retryTimer === undefined) void connect();
            const original = room;
            return () => {
                if (rooms.get(id) !== original) return;
                original.listeners.delete(registration);
                if (!original.listeners.size) forgetRoom(id);
            };
        },
        forgetRoom,
        getRealtimeState: () => state,
        subscribeRealtimeState(listener: () => void) { stateListeners.add(listener); return () => { stateListeners.delete(listener); }; },
        dispose: reset,
    };
}

let singleton: ReturnType<typeof createRealtimeService> | undefined;
const service = () => singleton ??= createRealtimeService();
export const subscribeRoomEvents = (roomId: string, listener: (event: RoomEvent) => void, options?: RoomEventOptions) => service().subscribeRoomEvents(roomId, listener, options);
export const forgetRoom = (roomId: string) => { singleton?.forgetRoom(roomId); };
export const getRealtimeState = () => service().getRealtimeState();
export const subscribeRealtimeState = (listener: () => void) => service().subscribeRealtimeState(listener);
export const useRealtimeState = () => useSyncExternalStore(subscribeRealtimeState, getRealtimeState, getRealtimeState);
