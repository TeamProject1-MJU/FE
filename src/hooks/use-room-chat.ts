import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
    chatContentLength,
    createChatClientId,
    fetchChatMessages,
    getPendingChatAiCount,
    parseChatMessage,
    sendChatMessage,
    subscribeChat,
} from '@/services/chat';
import type {
    ChatMessage,
    ChatMessagePage,
    ChatMockScenario,
    PendingChatMessage,
} from '@/types/chat';
import { AI_REPLY_WINDOW_MS, createAiReplyTracker } from '@/services/chat-ai-wait';
import { getRealtimeState, subscribeRealtimeState, subscribeRoomEvents } from '@/services/realtime';
import { RoomError } from '@/types/room';
import { useMock as isMockMode } from '@/services/api/config';
import { getRoomCacheScope } from '@/services/room-cache';
import { useAuthStatus, getSession } from '@/stores/auth-store';

type State = {
    scope: string;
    status: 'loading' | 'ready' | 'error';
    messages: ChatMessage[];
    pending: PendingChatMessage[];
    draft: string;
    error: string | null;
    inputError: string | null;
    historyError: string | null;
    historyLoading: boolean;
    refreshing: boolean;
    hasMore: boolean;
    blocked: boolean;
    aiPending: number;
};

type Context = {
    actionId: number;
    focused: boolean;
    valid: () => boolean;
    stopPolling: () => void;
    waitForAi: (message: ChatMessage) => void;
    resumePolling: () => void;
    receiveReplies: (messages: ChatMessage[]) => void;
    queued: Map<string, PendingChatMessage>;
    knownIds: Set<string>;
    confirmedIds: Set<string>;
    aiPending: number;
    scope: string;
    active: boolean;
    loaded: boolean;
    blocked: boolean;
    refreshing: boolean;
    refreshAgain: boolean;
    historyLoading: boolean;
    hasMore: boolean;
    cursor: string | null;
    /** REST 로 받아 빈 구간 없이 이어진 메시지 id (처음 로드·이전 메시지·복구). WS·전송 결과는 넣지 않아요(#137). */
    syncedIds: Set<string>;
    /** 이미 어떤 전송에 짝지어진 내 메시지 id (정상 저장 응답·재시도 확인·WS 확인). 다른 전송의 후보가 될 수 없어요(#139). */
    claimedIds: Set<string>;
    sending: Set<string>;
    sendBaseline: Map<string, Set<string>>;
};

const initial = (scope: string): State => ({
    scope,
    status: 'loading',
    messages: [],
    pending: [],
    draft: '',
    error: null,
    inputError: null,
    historyError: null,
    historyLoading: false,
    refreshing: false,
    hasMore: false,
    blocked: false,
    aiPending: 0,
});

function parseMock(value?: string): ChatMockScenario | undefined {
    switch (value) {
        case 'chat-empty':
        case 'chat-error':
        case 'chat-send-error':
        case 'chat-ai-error':
        case 'chat-history-error':
            return value;
    }
}

/** 화면에서는 시간순으로 표시하고, ID는 중복 제거에만 사용해요. */
export function mergeChatMessages(
    current: ChatMessage[],
    incoming: ChatMessage[],
) {
    const unique = new Map(
        current.map(message => [message.id, message]),
    );

    incoming.forEach(message => unique.set(message.id, message));

    return [...unique.values()].sort(
        (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
}

/** 재연결 복구에서 최신 쪽부터 받을 최대 페이지 수 (30개 × 10 = 300개, #137) */
export const CHAT_RECOVERY_MAX_PAGES = 10;

export type ChatRecovery = {
    /** 받은 메시지(최신 → 오래된 순서) */
    items: ChatMessage[];
    /**
     * overlap: 이어진 목록의 메시지를 만났어요. 그 사이를 합치고 오래된 쪽 cursor·hasMore 는 그대로예요.
     * complete: 겹치기 전에 방의 처음까지 받았어요(hasMore: false). 받은 것이 방의 모든 메시지예요.
     * replace: 상한까지 겹치지 않았어요. 목록을 받은 범위로 바꾸고 그보다 오래된 건 이전 메시지 조회로 이어 받아요.
     */
    mode: 'overlap' | 'complete' | 'replace';
    cursor: string | null;
    hasMore: boolean;
};

/**
 * 재연결·화면 복귀·reload 때 끊긴 동안 쌓인 메시지를 빈 구간 없이 받아요 (#137, 명세 10.2·11장).
 * 최신 페이지부터 nextCursor 를 따라 이어 받고, syncedIds(이미 이어져 있는 목록)의 메시지를 만나면 멈춰요.
 * 중간에 실패하면 예외를 그대로 던져요(받은 일부만 합치면 빈 구간이 생겨요). 더 진행하면 안 되면(valid false) null.
 */
export async function recoverChatGap(
    fetchPage: (cursor: string | null) => Promise<ChatMessagePage>,
    syncedIds: ReadonlySet<string>,
    valid: () => boolean,
    maxPages = CHAT_RECOVERY_MAX_PAGES,
): Promise<ChatRecovery | null> {
    const items: ChatMessage[] = [];
    let cursor: string | null = null;
    for (let page = 1; ; page++) {
        const result = await fetchPage(cursor);
        if (!valid()) return null;
        items.push(...result.items);
        if (result.items.some(message => syncedIds.has(message.id))) return { items, mode: 'overlap', cursor: null, hasMore: false };
        if (!result.hasMore || !result.nextCursor) return { items, mode: result.hasMore ? 'replace' : 'complete', cursor: result.nextCursor, hasMore: result.hasMore && !!result.nextCursor };
        if (page >= maxPages) return { items, mode: 'replace', cursor: result.nextCursor, hasMore: true };
        cursor = result.nextCursor;
    }
}

/**
 * 복구 결과를 현재 목록에 반영해요.
 * - overlap: 합치기만 해요.
 * - complete·replace: 받은 범위보다 오래된 기존 메시지만 버려요. 복구 중 WS 로 들어온 더 최신 메시지는 남겨요.
 */
export function applyChatRecovery(current: ChatMessage[], recovery: ChatRecovery) {
    // 받은 것이 없으면(빈 방) 버릴 기준이 없어 그대로 둬요.
    if (recovery.mode === 'overlap' || !recovery.items.length) return mergeChatMessages(current, recovery.items);
    const oldest = Math.min(...recovery.items.map(message => Date.parse(message.createdAt)));
    const fetched = new Set(recovery.items.map(message => message.id));
    return mergeChatMessages(current.filter(message => fetched.has(message.id) || Date.parse(message.createdAt) >= oldest), recovery.items);
}

/** 서버 모드에서 최신 한 페이지만 합쳤을 때 이어진 목록과 사이가 빌 수 있는지 (#137) */
function needsRecovery(ctx: Context, page: ChatMessagePage) {
    return !isMockMode() && ctx.loaded && page.hasMore && !page.items.some(message => ctx.syncedIds.has(message.id));
}

export const CHAT_SEND_UNCONFIRMED_TEXT = '저장됐는지 확인하지 못했어요. 다시 보내면 같은 메시지가 두 번 저장될 수 있어요.';

/** items 는 확인하며 받은 메시지, wholeRoom 은 방의 처음까지 받았는지(그러면 목록과 빈 구간 없이 이어져요)예요. */
export type ChatSendCheck = { items: ChatMessage[]; wholeRoom: boolean } & (
    | { status: 'saved'; message: ChatMessage }
    | { status: 'notSaved' }
    | { status: 'unknown' });

/**
 * 응답이 유실된 전송을 다시 보내기 전에 서버에 이미 저장됐는지 확인해요 (#139).
 * 최신 페이지부터 nextCursor 로 과거로 넘기면서 첫 전송 전 기준(baseline)의 메시지를 만나거나 방의 처음까지 받아요(recoverChatGap 재사용).
 * 원본이 저장됐다면 반드시 그 범위(기준보다 새것) 안에 있어요.
 * - saved: 후보(기준에 없음·USER·나·본문 일치·다른 전송에 안 짝지어짐) 중 가장 오래된 하나
 * - notSaved: 범위를 다 봤는데 후보가 없어요. 다시 보내도 돼요.
 * - unknown: 기준을 모르거나(baseline 없음) 페이지 상한까지 기준을 못 만났어요. 자동으로 보내지 않아요.
 * 확인 중 오류는 그대로 던지고, 더 진행하면 안 되면(valid false) null 이에요.
 */
export async function checkChatSend(
    fetchPage: (cursor: string | null) => Promise<ChatMessagePage>,
    baseline: ReadonlySet<string> | undefined,
    isCandidate: (message: ChatMessage) => boolean,
    valid: () => boolean,
    maxPages = CHAT_RECOVERY_MAX_PAGES,
): Promise<ChatSendCheck | null> {
    if (!baseline) return { status: 'unknown', items: [], wholeRoom: false };
    const range = await recoverChatGap(fetchPage, baseline, valid, maxPages);
    if (!range) return null;
    const checked = range.mode === 'overlap' || range.mode === 'complete';
    const candidates = range.items.filter(message => !baseline.has(message.id) && isCandidate(message));
    const saved = [...candidates].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : 1))[0];
    const wholeRoom = range.mode === 'complete';
    if (saved) return { status: 'saved', message: saved, items: range.items, wholeRoom };
    return { status: checked ? 'notSaved' : 'unknown', items: range.items, wholeRoom };
}

const errorText = (error: unknown) =>
    error instanceof RoomError
        ? error.message
        : '요청을 완료하지 못했어요. 다시 시도해 주세요.';

const denied = (error: unknown) =>
    error instanceof RoomError &&
    (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND');


export function useRoomChat(roomId: string, mock?: string) {
    useAuthStatus();
    const scenario = parseMock(mock);
    let account = 'mock';
    if (!isMockMode()) {
        try { account = getRoomCacheScope(); } catch { account = 'signedOut'; }
    }
    const scope = `${account}:${roomId}:${scenario ?? 'normal'}`;
    const currentScope = useRef(scope);
    currentScope.current = scope;

    const [state, setState] = useState<State>(() => initial(scope));
    const context = useRef<Context | null>(null);
    const draftRef = useRef('');

    const update = useCallback(
        (ctx: Context, change: (previous: State) => State) => {
            if (!ctx.valid()) return;

            setState(previous =>
                ctx.valid()
                    ? change(
                        previous.scope === ctx.scope
                            ? previous
                            : initial(ctx.scope),
                    )
                    : previous,
            );
        },
        [],
    );

    const refresh = useCallback(async () => {
        const ctx = context.current;

        if (!ctx?.valid() || ctx.scope !== scope) return;

        if (ctx.refreshing) {
            ctx.refreshAgain = true;
            return;
        }

        ctx.refreshing = true;
        const actionId = ctx.actionId;

        update(ctx, previous => ({
            ...previous,
            refreshing: true,
            error: null,
            status: ctx.loaded ? previous.status : 'loading',
        }));

        try {
            do {
                ctx.refreshAgain = false;

                // 서버 모드에서 이미 로드된 목록은 끊긴 동안 쌓인 메시지를 빈 구간 없이 복구해요(#137).
                // 처음 로드와 mock 모드는 이전처럼 최신 한 페이지예요.
                if (ctx.loaded && !isMockMode()) {
                    const recovery = await recoverChatGap(
                        cursor => fetchChatMessages(roomId, { cursor }),
                        ctx.syncedIds,
                        () => ctx.valid() && actionId === ctx.actionId,
                    );
                    if (!recovery) return;
                    recovery.items.forEach(message => ctx.knownIds.add(message.id));
                    if (recovery.mode === 'overlap') recovery.items.forEach(message => ctx.syncedIds.add(message.id));
                    else {
                        // 목록·cursor·hasMore 를 받은 범위로 맞춰요. 그보다 오래된 건 이전 메시지 조회로 이어 받아요.
                        ctx.syncedIds = new Set(recovery.items.map(message => message.id));
                        ctx.cursor = recovery.cursor;
                        ctx.hasMore = recovery.hasMore;
                    }
                    ctx.receiveReplies(recovery.items);
                    ctx.blocked = false;
                    update(ctx, previous => ({
                        ...previous,
                        status: 'ready',
                        error: null,
                        blocked: false,
                        hasMore: ctx.hasMore,
                        messages: applyChatRecovery(previous.messages, recovery),
                        aiPending: ctx.aiPending,
                    }));
                    continue;
                }

                const page = await fetchChatMessages(roomId, {
                    mock: scenario,
                });

                if (!ctx.valid() || actionId !== ctx.actionId) return;

                if (!ctx.loaded) {
                    ctx.cursor = page.nextCursor;
                    ctx.hasMore = page.hasMore;
                    page.items.forEach(message => ctx.syncedIds.add(message.id));
                }

                page.items.forEach(message => ctx.knownIds.add(message.id));
                ctx.receiveReplies(page.items);
                ctx.loaded = true;
                ctx.blocked = false;

                update(ctx, previous => ({
                    ...previous,
                    status: 'ready',
                    error: null,
                    blocked: false,
                    hasMore: ctx.hasMore,
                    messages: mergeChatMessages(
                        previous.messages,
                        [...page.items].reverse(),
                    ),
                    aiPending: isMockMode() ? getPendingChatAiCount(roomId, scenario) : ctx.aiPending,
                }));
            } while (ctx.refreshAgain && ctx.active);
        } catch (error) {
            if (!ctx.valid() || actionId !== ctx.actionId) return;
            if (denied(error)) { ctx.blocked = true; ctx.stopPolling(); }

            update(ctx, previous => ({
                ...previous,
                status: ctx.loaded && !ctx.blocked ? 'ready' : 'error',
                error: errorText(error),
                blocked: ctx.blocked,
                messages: ctx.blocked ? [] : previous.messages,
                pending: ctx.blocked ? [] : previous.pending,
                aiPending: ctx.blocked ? 0 : previous.aiPending,
            }));
        } finally {
            ctx.refreshing = false;

            update(ctx, previous => ({
                ...previous,
                refreshing: false,
            }));
            if (ctx.refreshAgain && ctx.valid() && ctx.focused) {
                ctx.refreshAgain = false;
                void refresh();
            }
        }
    }, [roomId, scenario, scope, update]);

    useEffect(() => {
        const ctx: Context = {
            actionId: 0,
            focused: true,
            valid: () => {
                if (!ctx.active || context.current !== ctx || currentScope.current !== ctx.scope) return false;
                if (isMockMode()) return true;
                try { return getRoomCacheScope() === account; } catch { return false; }
            },
            stopPolling: () => {},
            waitForAi: () => {},
            resumePolling: () => {},
            receiveReplies: () => {},
            queued: new Map(),
            knownIds: new Set(),
            confirmedIds: new Set(),
            aiPending: 0,
            scope,
            active: true,
            loaded: false,
            blocked: false,
            refreshing: false,
            refreshAgain: false,
            historyLoading: false,
            hasMore: false,
            cursor: null,
            syncedIds: new Set(),
            claimedIds: new Set(),
            sending: new Set(),
            sendBaseline: new Map(),
        };

        context.current = ctx;
        draftRef.current = '';

        // Blur pauses REST work; the listener continues receiving room messages.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let generation = 0;
        let fetching = false;
        let latestPage: ReturnType<typeof fetchChatMessages> | undefined;
        const waiting = new Map<string, { question: ChatMessage; deadline: number; expiry: ReturnType<typeof setTimeout> | undefined }>();
        // 방에서 보이는 질문·답변으로 "답변 하나 = 질문 하나"를 짝지어요(#138, services/chat-ai-wait.ts).
        const replies = createAiReplyTracker();
        const received = ctx.confirmedIds;
        const publishWaiting = () => {
            // 짝짓기가 순서 추측이라 개수는 정확하지 않을 수 있어요. 화면에는 대기 여부(0·1)만 알려요.
            ctx.aiPending = waiting.size > 0 ? 1 : 0;
            update(ctx, previous => ({ ...previous, aiPending: ctx.aiPending }));
            if (!waiting.size) { clearTimeout(timer); timer = undefined; }
        };
        const resolveWaiting = (messages: ChatMessage[]) => {
            replies.observe(messages);
            for (const [id, entry] of waiting) {
                if (replies.isAnswered(id)) {
                    clearTimeout(entry.expiry);
                    waiting.delete(id);
                }
            }
            publishWaiting();
        };
        ctx.receiveReplies = resolveWaiting;
        const block = (code: 'NOT_ROOM_MEMBER' | 'ROOM_NOT_FOUND') => {
            ctx.blocked = true;
            ctx.actionId++;
            ctx.sendBaseline.clear();
            ctx.queued.clear();
            ctx.stopPolling();
            update(ctx, previous => ({ ...previous, status: 'error', blocked: true,
                error: errorText(new RoomError(code, '이 약속방에 접근할 수 없어요.', roomId)),
                messages: [], pending: [], refreshing: false, historyLoading: false }));
        };
        const latest = async (ids?: string[]) => {
            const epoch = generation;
            if (!ctx.valid() || ctx.blocked || !ctx.focused) return;
            try {
                // Fallback polling and deadline requests share an in-flight page.
                const request = latestPage ??= fetchChatMessages(roomId);
                const page = await request.finally(() => {
                    if (latestPage === request) latestPage = undefined;
                });
                if (!ctx.valid() || ctx.blocked || epoch !== generation) return;
                page.items.forEach(message => ctx.knownIds.add(message.id));
                resolveWaiting(page.items);
                update(ctx, previous => ({ ...previous, messages: mergeChatMessages(previous.messages, page.items) }));
                // 최신 한 페이지가 이어진 목록과 겹치지 않으면 그 사이가 비어요. 같은 복구(refresh)로 채워요(#137).
                if (needsRecovery(ctx, page)) void refresh();
            } catch (error) {
                if (!ctx.valid() || epoch !== generation) return;
                if (denied(error)) block((error as RoomError).code as 'NOT_ROOM_MEMBER' | 'ROOM_NOT_FOUND');
            } finally {
                if (ctx.valid() && epoch === generation && ids) {
                    ids.forEach(id => { clearTimeout(waiting.get(id)?.expiry); waiting.delete(id); });
                    publishWaiting();
                }
            }
        };
        const schedule = () => {
            clearTimeout(timer); timer = undefined;
            if (!ctx.valid() || ctx.blocked || !ctx.focused || !waiting.size || getRealtimeState() === 'open' || fetching) return;
            timer = setTimeout(async () => {
                timer = undefined;
                fetching = true;
                await latest();
                fetching = false;
                schedule();
            }, 3000);
        };
        const armExpiry = (id: string) => {
            const entry = waiting.get(id);
            if (!entry || entry.expiry !== undefined) return;
            entry.expiry = setTimeout(() => {
                // Stop a fallback tick due at the same deadline before the final fetch.
                clearTimeout(timer); timer = undefined;
                void latest([id]);
            }, Math.max(0, entry.deadline - Date.now()));
        };
        ctx.stopPolling = () => {
            generation++;
            latestPage = undefined;
            if (ctx.blocked || !ctx.active) { ctx.queued.clear(); ctx.sendBaseline.clear(); }
            clearTimeout(timer); timer = undefined;
            waiting.forEach(entry => clearTimeout(entry.expiry));
            if (!ctx.focused && ctx.active && !ctx.blocked) {
                waiting.forEach(entry => { entry.expiry = undefined; });
            } else waiting.clear();
            publishWaiting();
        };
        ctx.resumePolling = () => {
            waiting.forEach((_entry, id) => armExpiry(id));
            schedule();
        };
        ctx.waitForAi = question => {
            if (isMockMode() || !ctx.valid() || ctx.blocked) return;
            replies.addQuestion(question);
            if (!waiting.has(question.id)) waiting.set(question.id, { question, deadline: Date.now() + AI_REPLY_WINDOW_MS, expiry: undefined });
            resolveWaiting([]); // POST 응답보다 먼저 온 답변도 짝짓기 규칙으로 바로 소비돼요.
            if (ctx.focused) ctx.resumePolling();
        };
        const offState = isMockMode() ? () => {} : subscribeRealtimeState(schedule);
        let offEvents: () => void = () => {};
        if (!isMockMode() && ctx.valid()) {
            try {
                offEvents = subscribeRoomEvents(roomId, event => {
                    if (!ctx.valid() || ctx.blocked || event.type !== 'MESSAGE_CREATED') return;
                    let message: ChatMessage;
                    try { message = parseChatMessage(event.payload); }
                    catch {
                        if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[chat] drop: invalid MESSAGE_CREATED payload');
                        return;
                    }
                    const duplicate = received.has(message.id);
                    received.add(message.id);
                    ctx.knownIds.add(message.id);
                    if (!duplicate && !ctx.claimedIds.has(message.id) && message.senderType === 'USER' && message.senderId === getSession()?.userId) {
                        // 늦게 온 내 메시지: 재시도 확인과 같은 기준(기준에 없음·본문 일치·가장 오래된 전송 하나)으로 저장을 확인해요(#139).
                        const entry = [...ctx.queued.values()]
                            .filter(item => item.content === message.content && ctx.sendBaseline.has(item.clientId)
                                && !ctx.sendBaseline.get(item.clientId)!.has(message.id))
                            .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
                        if (entry) {
                            ctx.claimedIds.add(message.id);
                            ctx.queued.delete(entry.clientId);
                            ctx.sendBaseline.delete(entry.clientId);
                            update(ctx, previous => ({ ...previous, pending: previous.pending.filter(item => item.clientId !== entry.clientId) }));
                        }
                    }
                    resolveWaiting([message]);
                    update(ctx, previous => ({ ...previous, messages: mergeChatMessages(previous.messages, [message]) }));
                }, {
                    onReconnected: () => { if (ctx.valid() && !ctx.blocked) void refresh(); },
                    onSubscribed: () => {
                        if (!ctx.valid() || ctx.blocked) return;
                        // 구독 전에 시작한 요청은 동기화로 재사용하지 않고, 이후 요청끼리 합쳐요.
                        latestPage = undefined;
                        void latest();
                    },
                    onRejected: code => {
                        if (ctx.valid() && (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND')) block(code);
                    },
                });
            } catch {
                if (typeof __DEV__ !== 'undefined' && __DEV__) console.debug('[chat] realtime subscription unavailable; using REST fallback');
            }
        }

        const unsubscribe = subscribeChat(roomId, () => {
            update(ctx, previous => ({
                ...previous,
                aiPending: getPendingChatAiCount(roomId, scenario),
            }));

            void refresh();
        });

        return () => {
            ctx.active = false;
            ctx.sendBaseline.clear();
            ctx.stopPolling();
            unsubscribe();
            offEvents();
            offState();
        };
    }, [account, roomId, scenario, scope, refresh, update]);

    useFocusEffect(
        useCallback(() => {
            if (context.current) { context.current.focused = true; context.current.resumePolling(); }
            void refresh();
            const ctx = context.current;
            return () => {
                if (ctx && !isMockMode()) {
                    ctx.actionId++;
                    ctx.focused = false;
                    ctx.stopPolling();
                    update(ctx, previous => ({ ...previous, pending: previous.pending.map(entry => entry.status === 'sending'
                        ? { ...entry, status: 'failed', errorMessage: '전송 결과를 확인하지 못했어요. 다시 시도하면 저장 여부를 먼저 확인해요.' } : entry) }));
                }
            };
        }, [refresh, update]),
    );

    const loadOlder = async () => {
        const ctx = context.current;

        if (
            !ctx?.valid() ||
            ctx.scope !== scope ||
            !ctx.loaded ||
            ctx.blocked ||
            ctx.historyLoading ||
            !ctx.hasMore ||
            !ctx.cursor
        ) {
            return;
        }

        ctx.historyLoading = true;
        const actionId = ctx.actionId;

        update(ctx, previous => ({
            ...previous,
            historyLoading: true,
            historyError: null,
        }));

        const requestedCursor = ctx.cursor;
        try {
            const page = await fetchChatMessages(roomId, {
                cursor: requestedCursor,
                mock: scenario,
            });

            if (!ctx.valid() || actionId !== ctx.actionId) return;
            // 그사이 재연결 복구가 목록 범위를 바꿨으면(cursor 변경) 이 페이지는 이어지지 않아 버려요(#137).
            if (ctx.cursor !== requestedCursor) return;

            page.items.forEach(message => { ctx.knownIds.add(message.id); ctx.syncedIds.add(message.id); });
            ctx.cursor = page.nextCursor;
            ctx.hasMore = page.hasMore;

            update(ctx, previous => ({
                ...previous,
                hasMore: page.hasMore,
                messages: mergeChatMessages(
                    previous.messages,
                    [...page.items].reverse(),
                ),
            }));
        } catch (error) {
            if (!ctx.valid() || actionId !== ctx.actionId) return;
            if (denied(error)) {
                ctx.blocked = true;
                ctx.stopPolling();
                update(ctx, previous => ({ ...previous, status: 'error', blocked: true, error: errorText(error), messages: [], pending: [] }));
                return;
            }

            update(ctx, previous => ({
                ...previous,
                historyError: errorText(error),
            }));
        } finally {
            ctx.historyLoading = false;

            update(ctx, previous => ({
                ...previous,
                historyLoading: false,
            }));
        }
    };

    const deliver = async (entry: PendingChatMessage) => {
        const ctx = context.current;

        if (
            !ctx?.valid() ||
            ctx.scope !== scope ||
            !ctx.loaded ||
            ctx.blocked ||
            ctx.sending.has(entry.clientId)
        ) {
            return;
        }

        ctx.sending.add(entry.clientId);
        ctx.queued.set(entry.clientId, entry);
        const actionId = ctx.actionId;

        const queued = {
            ...entry,
            status: 'sending' as const,
            errorMessage: undefined,
        };

        update(ctx, previous => ({
            ...previous,
            inputError: null,
            pending: [
                ...previous.pending.filter(
                    item => item.clientId !== entry.clientId,
                ),
                queued,
            ],
        }));

        try {
            // 응답이 유실된 전송은 다시 보내기 전에 기준점까지 넘겨서 저장 여부를 확인해요(#139).
            // 저장 여부 불명(unconfirmed) 안내를 본 뒤 다시 누른 경우만 확인 없이 보내요.
            if (!isMockMode() && entry.status === 'failed' && !entry.unconfirmed) {
                const myId = getSession()?.userId;
                const check = await checkChatSend(
                    cursor => fetchChatMessages(roomId, { cursor }),
                    ctx.sendBaseline.get(entry.clientId),
                    message => message.senderType === 'USER' && message.senderId === myId
                        && message.content === entry.content && !ctx.claimedIds.has(message.id),
                    () => ctx.valid() && actionId === ctx.actionId,
                );
                if (!check || !ctx.valid() || actionId !== ctx.actionId) return;
                // 받은 범위를 #137 과 같은 방식으로 합쳐요. 이어진 목록과 겹치지 않으면 refresh 로 빈 구간을 채워요.
                check.items.forEach(message => ctx.knownIds.add(message.id));
                update(ctx, previous => ({ ...previous, messages: mergeChatMessages(previous.messages, check.items) }));
                if (check.wholeRoom || check.items.some(message => ctx.syncedIds.has(message.id))) check.items.forEach(message => ctx.syncedIds.add(message.id));
                else if (check.items.length) void refresh();
                ctx.receiveReplies(check.items);
                if (!ctx.queued.has(entry.clientId)) return; // 그사이 WS 로 저장이 확인됐어요.
                if (check.status === 'saved') {
                    ctx.claimedIds.add(check.message.id);
                    ctx.confirmedIds.add(check.message.id);
                    ctx.queued.delete(entry.clientId);
                    ctx.sendBaseline.delete(entry.clientId);
                    update(ctx, previous => ({ ...previous, pending: previous.pending.filter(item => item.clientId !== entry.clientId) }));
                    if (check.message.content.includes('@링크로')) ctx.waitForAi(check.message);
                    return;
                }
                if (check.status === 'unknown') {
                    update(ctx, previous => ({ ...previous, pending: previous.pending.map(item => item.clientId === entry.clientId
                        ? { ...item, status: 'failed', unconfirmed: true, errorMessage: CHAT_SEND_UNCONFIRMED_TEXT } : item) }));
                    return;
                }
            }
            if (!isMockMode() && !ctx.sendBaseline.has(entry.clientId)) {
                ctx.sendBaseline.set(entry.clientId, new Set(ctx.knownIds));
            }
            const result = await sendChatMessage(
                roomId,
                { content: entry.content },
                { clientId: entry.clientId, mock: scenario },
            );

            if (!ctx.valid() || actionId !== ctx.actionId) return;
            ctx.sendBaseline.delete(entry.clientId);
            ctx.queued.delete(entry.clientId);
            ctx.knownIds.add(result.message.id);
            ctx.confirmedIds.add(result.message.id);
            ctx.claimedIds.add(result.message.id);
            if (result.aiPending) ctx.waitForAi(result.message);

            update(ctx, previous => ({
                ...previous,
                messages: mergeChatMessages(
                    previous.messages,
                    [result.message],
                ),
                pending: previous.pending.filter(
                    item => item.clientId !== entry.clientId,
                ),
                aiPending: isMockMode() ? getPendingChatAiCount(roomId, scenario) : ctx.aiPending,
            }));
        } catch (error) {
            if (!ctx.valid() || actionId !== ctx.actionId) return;
            if (denied(error)) { ctx.blocked = true; ctx.stopPolling(); }

            update(ctx, previous =>
                ctx.blocked
                    ? {
                        ...previous,
                        status: 'error',
                        blocked: true,
                        error: errorText(error),
                        messages: [],
                        pending: [],
                        aiPending: 0,
                    }
                    : {
                        ...previous,
                        pending: previous.pending.map(item =>
                            item.clientId === entry.clientId
                                ? {
                                    ...item,
                                    status: 'failed',
                                    // 새로 보낸 요청의 결과도 모르니 다음 재시도는 다시 기준점까지 확인해요.
                                    unconfirmed: undefined,
                                    errorMessage: errorText(error),
                                }
                                : item,
                        ),
                    },
            );
        } finally {
            ctx.sending.delete(entry.clientId);
        }
    };

    const setDraft = (value: string) => {
        const ctx = context.current;

        if (!ctx?.valid() || ctx.scope !== scope) return;

        draftRef.current = value;

        update(ctx, previous => ({
            ...previous,
            draft: value,
            inputError: null,
        }));
    };

    const send = () => {
        const ctx = context.current;

        if (
            !ctx?.valid() ||
            ctx.scope !== scope ||
            !ctx.loaded ||
            ctx.blocked
        ) {
            return;
        }

        const content = isMockMode() ? draftRef.current.trim() : draftRef.current;

        if (!content.trim() || (!isMockMode() && content.includes('\0')) || chatContentLength(content) > 1000) {
            update(ctx, previous => ({
                ...previous,
                inputError: isMockMode() ? '메시지는 1,000자까지 입력해 주세요.' : '공백만 입력할 수 없고 NUL 문자 없이 1,000자까지 입력해 주세요.',
            }));
            return;
        }

        draftRef.current = '';

        update(ctx, previous => ({
            ...previous,
            draft: '',
            inputError: null,
        }));

        void deliver({
            clientId: createChatClientId(),
            content,
            createdAt: new Date().toISOString(),
            status: 'sending',
        });
    };

    const retrySend = (entry: PendingChatMessage) => {
        if (entry.status === 'failed') {
            void deliver(entry);
        }
    };

    const current = state.scope === scope ? state : initial(scope);
    const length = chatContentLength(current.draft);

    return {
        ...current,
        length,
        setDraft,
        send,
        retrySend,
        loadOlder,
        reload: refresh,
        canSend:
            current.status === 'ready' &&
            !current.blocked &&
            length > 0 &&
            !!current.draft.trim() &&
            (isMockMode() || !current.draft.includes('\0')) &&
            length <= 1000,
    };
}
