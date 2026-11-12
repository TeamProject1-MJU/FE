import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
    chatContentLength,
    fetchChatMessages,
    getPendingChatAiCount,
    parseChatMessage,
    sendChatMessage,
    subscribeChat,
} from '@/services/chat';
import type {
    ChatMessage,
    ChatMockScenario,
    PendingChatMessage,
} from '@/types/chat';
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

const errorText = (error: unknown) =>
    error instanceof RoomError
        ? error.message
        : '요청을 완료하지 못했어요. 다시 시도해 주세요.';

const denied = (error: unknown) =>
    error instanceof RoomError &&
    (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND');

let clientSequence = 1;

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

                const page = await fetchChatMessages(roomId, {
                    mock: scenario,
                });

                if (!ctx.valid() || actionId !== ctx.actionId) return;

                if (!ctx.loaded) {
                    ctx.cursor = page.nextCursor;
                    ctx.hasMore = page.hasMore;
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
        let latestReplyAt = -Infinity;
        const received = ctx.confirmedIds;
        const isReply = (message: ChatMessage) => message.senderType === 'AI'
            || message.senderType === 'SYSTEM' && (message.content.startsWith('AI 사용 한도를 초과해')
                || message.content.startsWith('AI가 답변을 만들지 못했어요'));
        const publishWaiting = () => {
            ctx.aiPending = waiting.size;
            update(ctx, previous => ({ ...previous, aiPending: ctx.aiPending }));
            if (!waiting.size) { clearTimeout(timer); timer = undefined; }
        };
        const resolveWaiting = (messages: ChatMessage[]) => {
            for (const reply of messages.filter(isReply)) latestReplyAt = Math.max(latestReplyAt, Date.parse(reply.createdAt));
            for (const [id, entry] of waiting) {
                if (latestReplyAt > Date.parse(entry.question.createdAt)) {
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
            if (!waiting.has(question.id)) waiting.set(question.id, { question, deadline: Date.now() + 60_000, expiry: undefined });
            resolveWaiting([]); // A reply may have arrived before the POST response.
            if (ctx.focused) ctx.resumePolling();
        };
        const offState = isMockMode() ? () => {} : subscribeRealtimeState(schedule);
        const offEvents = isMockMode() || !ctx.valid() ? () => {} : subscribeRoomEvents(roomId, event => {
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
            if (!duplicate && message.senderType === 'USER' && message.senderId === getSession()?.userId) {
                const entry = [...ctx.queued.values()]
                    .filter(item => item.content === message.content && ctx.sendBaseline.has(item.clientId)
                        && !ctx.sendBaseline.get(item.clientId)!.has(message.id))
                    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
                if (entry) {
                    ctx.queued.delete(entry.clientId);
                    ctx.sendBaseline.delete(entry.clientId);
                    update(ctx, previous => ({ ...previous, pending: previous.pending.filter(item => item.clientId !== entry.clientId) }));
                }
            }
            resolveWaiting([message]);
            update(ctx, previous => ({ ...previous, messages: mergeChatMessages(previous.messages, [message]) }));
        }, {
            onReconnected: () => { if (ctx.valid() && !ctx.blocked) void refresh(); },
            onRejected: code => {
                if (ctx.valid() && (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND')) block(code);
            },
        });

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

        try {
            const page = await fetchChatMessages(roomId, {
                cursor: ctx.cursor,
                mock: scenario,
            });

            if (!ctx.valid() || actionId !== ctx.actionId) return;

            page.items.forEach(message => ctx.knownIds.add(message.id));
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
            // 최초 POST 전 기준을 유지해 새로고침으로 합쳐진 메시지도 저장된 것으로 확인해요.
            if (!isMockMode() && entry.status === 'failed') {
                // 기준이 유실됐다면 최신 목록의 동일 메시지를 우선 확인해 중복 전송을 피합니다.
                const knownIds = ctx.sendBaseline.get(entry.clientId) ?? new Set<string>();
                const latest = await fetchChatMessages(roomId);
                if (!ctx.valid() || actionId !== ctx.actionId) return;
                update(ctx, previous => ({ ...previous, messages: mergeChatMessages(previous.messages, latest.items) }));
                const saved = latest.items.find(message => !knownIds.has(message.id) && message.senderType === 'USER'
                    && message.senderId === getSession()?.userId && message.content === entry.content);
                latest.items.forEach(message => ctx.knownIds.add(message.id));
                ctx.receiveReplies(latest.items);
                if (!ctx.queued.has(entry.clientId)) return;
                if (saved) {
                    ctx.confirmedIds.add(saved.id);
                    ctx.queued.delete(entry.clientId);
                    ctx.sendBaseline.delete(entry.clientId);
                    update(ctx, previous => ({ ...previous, pending: previous.pending.filter(item => item.clientId !== entry.clientId) }));
                    if (saved.content.includes('@링크로')) ctx.waitForAi(saved);
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
            clientId: `chat-client-${Date.now()}-${clientSequence++}`,
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
