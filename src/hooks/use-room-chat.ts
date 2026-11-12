import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import {
    chatContentLength,
    fetchChatMessages,
    getPendingChatAiCount,
    sendChatMessage,
    subscribeChat,
} from '@/services/chat';
import type {
    ChatMessage,
    ChatMockScenario,
    PendingChatMessage,
} from '@/types/chat';
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
    poll: (message: ChatMessage) => void;
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
            poll: () => {},
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
        };

        context.current = ctx;
        draftRef.current = '';

        // REST 1단계 전용 임시 수신: 3초 간격, 최대 60초. 실시간 수신 도입 시 이 블록을 교체해요.
        let timer: ReturnType<typeof setTimeout> | undefined;
        let expiry: ReturnType<typeof setTimeout> | undefined;
        let pollId = 0;
        const waiting = new Map<string, ChatMessage>();
        ctx.stopPolling = () => {
            pollId++;
            clearTimeout(timer);
            clearTimeout(expiry);
            waiting.clear();
            ctx.aiPending = 0;
            update(ctx, previous => ({ ...previous, aiPending: 0 }));
        };
        ctx.poll = message => {
            if (isMockMode() || !ctx.valid() || ctx.blocked || !ctx.focused) return;
            const running = waiting.size > 0;
            waiting.set(message.id, message);
            ctx.aiPending = waiting.size;
            update(ctx, previous => ({ ...previous, aiPending: ctx.aiPending }));
            if (running) return;
            clearTimeout(timer);
            clearTimeout(expiry);
            const id = ++pollId;
            expiry = setTimeout(() => ctx.stopPolling(), 60_000);
            const tick = async () => {
                if (!ctx.valid() || id !== pollId) return;
                try {
                    const page = await fetchChatMessages(roomId);
                    if (!ctx.valid() || id !== pollId) return;
                    const replies = page.items.filter(item => item.senderType === 'AI'
                        || item.senderType === 'SYSTEM' && /AI|링크로|답변/.test(item.content));
                    for (const [key, question] of waiting) {
                        if (replies.some(reply => Date.parse(reply.createdAt) > Date.parse(question.createdAt))) waiting.delete(key);
                    }
                    ctx.aiPending = waiting.size;
                    update(ctx, previous => ({ ...previous, messages: mergeChatMessages(previous.messages, page.items), aiPending: ctx.aiPending }));
                } catch (error) {
                    if (!ctx.valid() || id !== pollId) return;
                    if (denied(error)) {
                        ctx.blocked = true;
                        ctx.stopPolling();
                        update(ctx, previous => ({ ...previous, status: 'error', blocked: true, error: errorText(error), messages: [], pending: [] }));
                        return;
                    }
                }
                if (ctx.valid() && id === pollId && waiting.size) timer = setTimeout(tick, 3000);
                else if (id === pollId) ctx.stopPolling();
            };
            timer = setTimeout(tick, 3000);
        };

        const unsubscribe = subscribeChat(roomId, () => {
            update(ctx, previous => ({
                ...previous,
                aiPending: getPendingChatAiCount(roomId, scenario),
            }));

            void refresh();
        });

        return () => {
            ctx.active = false;
            ctx.stopPolling();
            unsubscribe();
        };
    }, [account, roomId, scenario, scope, refresh, update]);

    useFocusEffect(
        useCallback(() => {
            if (context.current) context.current.focused = true;
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
            // 결과를 모르는 실패의 재전송은 먼저 서버 저장 여부를 확인해요. 본문·작성자·시각을 함께 비교해요.
            if (!isMockMode() && entry.status === 'failed') {
                const latest = await fetchChatMessages(roomId);
                if (!ctx.valid() || actionId !== ctx.actionId) return;
                update(ctx, previous => ({ ...previous, messages: mergeChatMessages(previous.messages, latest.items) }));
                const saved = latest.items.find(message => message.senderType === 'USER'
                    && message.senderId === getSession()?.userId && message.content === entry.content
                    && Date.parse(message.createdAt) >= Date.parse(entry.createdAt));
                if (saved) {
                    update(ctx, previous => ({ ...previous, pending: previous.pending.filter(item => item.clientId !== entry.clientId) }));
                    if (saved.content.includes('@링크로')) ctx.poll(saved);
                    return;
                }
            }
            const result = await sendChatMessage(
                roomId,
                { content: entry.content },
                { clientId: entry.clientId, mock: scenario },
            );

            if (!ctx.valid() || actionId !== ctx.actionId) return;
            if (result.aiPending) ctx.poll(result.message);

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
