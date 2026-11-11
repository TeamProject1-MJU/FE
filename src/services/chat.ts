import { fetchRoomDetail, getMyUserId } from '@/services/room';
import { useMock as isMockMode } from '@/services/api/config';
import { assertRoomCacheScope, getRoomCacheScope, readCachedRoomDetail, subscribeRoomCacheReset } from '@/services/room-cache';
import { RoomError, type RoomDetail } from '@/types/room';
import { subscribeRoomMockChanges } from '@/stores/room-mock-events';
import type {
    ChatMessage,
    ChatMessagePage,
    ChatMockScenario,
    SendChatMessageRequest,
    SendChatMessageResult,
} from '@/types/chat';

const wait = (ms: number) =>
    new Promise<void>(resolve => setTimeout(resolve, ms));

const messagesByRoom = new Map<string, ChatMessage[]>();
const pendingAiByRoom = new Map<string, number>();
const completedRequests = new Map<string, SendChatMessageResult>();
const listeners = new Map<string, Set<() => void>>();
const failedOnce = new Set<string>();

let sequence = 1;

subscribeRoomMockChanges(({ roomId, roomDeleted }) => {
    if (roomDeleted) {
        // 마지막 멤버가 나가 방이 삭제됐을 때만 기록을 지워요.
        for (const key of [roomId, `${roomId}:empty`]) {
            messagesByRoom.delete(key);
            pendingAiByRoom.delete(key);
        }

        for (const key of completedRequests.keys()) {
            if (key.startsWith(`${roomId}:`)) {
                completedRequests.delete(key);
            }
        }

        for (const key of failedOnce) {
            if (key.startsWith(`${roomId}:`)) {
                failedOnce.delete(key);
            }
        }
    }

    // 일반 나가기에서는 기록을 유지하고 조회 상태만 갱신해요.
    notify(roomId);
});

/** 화면 표시 이름과 API 호출 키워드를 분리해요. */
export function toChatApiContent(content: string) {
    return content.replace(/@링크로/g, '@linkro');
}

export function toChatDisplayContent(content: string) {
    return content.replace(/@linkro/gi, '@링크로');
}

/** 명세 10.1의 전송 내용 기준으로 글자 수를 계산해요. */
export function chatContentLength(content: string) {
    return Array.from(toChatApiContent(content).trim()).length;
}

function storeKey(roomId: string, mock?: ChatMockScenario) {
    // 빈 상태 확인이 원래 방의 대화를 지우지 않도록 별도 메모리를 사용해요.
    return mock === 'chat-empty' ? `${roomId}:empty` : roomId;
}

function notify(roomId: string) {
    listeners.get(roomId)?.forEach(listener => listener());
}

/** mock 메모리 변경 알림이며 WebSocket 연결은 아니에요. */
export function subscribeChat(roomId: string, listener: () => void) {
    const group = listeners.get(roomId) ?? new Set<() => void>();

    group.add(listener);
    listeners.set(roomId, group);

    return () => {
        group.delete(listener);

        if (group.size === 0) {
            listeners.delete(roomId);
        }
    };
}

export function getPendingChatAiCount(
    roomId: string,
    mock?: ChatMockScenario,
) {
    return pendingAiByRoom.get(storeKey(roomId, mock)) ?? 0;
}

function shouldFail(
    roomId: string,
    requested: ChatMockScenario | undefined,
    expected: ChatMockScenario,
) {
    if (requested !== expected) return false;

    const key = `${roomId}:${expected}`;

    if (failedOnce.has(key)) return false;

    failedOnce.add(key);
    return true;
}

async function requireChatMember(roomId: string) {
    const cached = isMockMode() ? undefined : readCachedRoomDetail(roomId);
    const scope = cached ? getRoomCacheScope() : null;
    const detail = cached ?? await fetchRoomDetail(roomId);
    if (scope) assertRoomCacheScope(scope);

    if (!detail.members.some(member => member.userId === getMyUserId())) {
        throw new RoomError(
            'NOT_ROOM_MEMBER',
            '이 약속방에 참여한 멤버만 대화할 수 있어요.',
        );
    }

    return detail;
}

function newMessage(
    senderType: ChatMessage['senderType'],
    content: string,
    senderId: string | null = null,
    nickname: string | null = null,
    createdAt = new Date().toISOString(),
): ChatMessage {
    // mock 식별자예요. 실제 API에서는 서버가 생성한 UUIDv7을 그대로 사용해요.
    return {
        id: `mock-message-${sequence++}`,
        senderType,
        senderId,
        nickname,
        content,
        createdAt,
        meta: null,
    };
}

function getMessages(detail: RoomDetail, mock?: ChatMockScenario) {
    const key = storeKey(detail.id, mock);
    const cached = messagesByRoom.get(key);

    if (cached) return cached;

    const items: ChatMessage[] = [];

    if (mock !== 'chat-empty') {
        const me = detail.members.find(
            member => member.userId === getMyUserId(),
        )!;
        const other =
            detail.members.find(member => member.userId !== me.userId) ?? me;
        const owner =
            detail.members.find(member => member.role === 'OWNER') ?? me;

        const time = (minutes: number) =>
            new Date(Date.now() - minutes * 60_000).toISOString();

        // 이전 메시지 조회를 확인하기 위한 샘플이에요.
        // 실제 방 이벤트와 연결하지 않아요.
        for (let i = 0; i < 34; i++) {
            const sender = i % 2 === 0 ? other : me;

            items.push(
                newMessage(
                    'USER',
                    i % 2 === 0
                        ? '모일 장소를 함께 정해 봐요.'
                        : '추천 결과를 보고 이야기해요.',
                    sender.userId,
                    sender.nickname,
                    time(50 - i),
                ),
            );
        }

        items.push(
            newMessage(
                'SYSTEM',
                `${other.nickname}님이 참여했어요.`,
                null,
                null,
                time(12),
            ),
            newMessage(
                'SYSTEM',
                '이전 참여자가 나갔어요.',
                null,
                null,
                time(11),
            ),
            newMessage(
                'SYSTEM',
                `${owner.nickname}님이 방장이 됐어요.`,
                null,
                null,
                time(10),
            ),
            newMessage(
                'USER',
                '이번에는 어디에서 만날까요?',
                other.userId,
                other.nickname,
                time(8),
            ),
            newMessage(
                'USER',
                '@linkro 약속 장소를 정할 때 무엇을 비교하면 좋을까요?',
                me.userId,
                me.nickname,
                time(7),
            ),
            newMessage(
                'AI',
                '모두의 출발역을 설정한 뒤 추천받기에서 시간·요금·거리를 비교해 봐요. 중간역 계산은 추천받기에서 할 수 있어요.',
                null,
                null,
                time(6),
            ),
        );
    }

    messagesByRoom.set(key, items);
    return items;
}

/**
 * TODO: API v1.12 10.2
 * GET /api/v1/rooms/{roomId}/messages?cursor={uuid}&size=30
 *
 * 실제 API는 서버가 정렬해요.
 * 클라이언트에서 UUID 문자열을 비교하지 않아요.
 * NETWORK_ERROR는 기존 프론트 mock 코드이며 API 서버 오류 코드가 아니에요.
 */
export async function fetchChatMessages(
    roomId: string,
    options: {
        cursor?: string | null;
        size?: number;
        mock?: ChatMockScenario;
    } = {},
): Promise<ChatMessagePage> {
    await wait(350);

    const detail = await requireChatMember(roomId);
    const size = options.size ?? 30;

    if (!Number.isInteger(size) || size < 1) {
        throw new RoomError(
            'VALIDATION_ERROR',
            '메시지 조회 개수를 확인해 주세요.',
        );
    }

    const failure = options.cursor ? 'chat-history-error' : 'chat-error';

    if (shouldFail(roomId, options.mock, failure)) {
        throw new RoomError(
            'NETWORK_ERROR',
            '메시지를 불러오지 못했어요. 다시 시도해 주세요.',
        );
    }

    const messages = getMessages(detail, options.mock);

    const end = options.cursor
        ? messages.findIndex(message => message.id === options.cursor)
        : messages.length;

    if (end < 0) {
        throw new RoomError(
            'VALIDATION_ERROR',
            '이전 메시지의 조회 위치를 확인해 주세요.',
        );
    }

    const start = Math.max(0, end - size);
    const items = messages
        .slice(start, end)
        .reverse()
        .map(message => ({ ...message }));

    return {
        items,
        nextCursor: items.at(-1)?.id ?? null,
        hasMore: start > 0,
    };
}

async function finishMockAi(
    roomId: string,
    key: string,
    messages: ChatMessage[],
    fail: boolean,
) {
    try {
        await wait(1800);

        if (messagesByRoom.get(key) !== messages) return;

        const detail = await requireChatMember(roomId);

        if (messagesByRoom.get(key) !== messages) return;

        if (fail) {
            messages.push(
                newMessage(
                    'SYSTEM',
                    '@linkro가 지금 답변하지 못했어요. 잠시 후 다시 질문해 주세요.',
                ),
            );
        } else {
            const departures = detail.members
                .map(
                    member =>
                        `${member.nickname}: ${
                            member.departureStation?.name ?? '출발역 미설정'
                        }`,
                )
                .join(', ');

            messages.push(
                newMessage(
                    'AI',
                    `현재 출발역은 ${departures}이에요. 중간역 후보와 계산 결과는 추천받기에서 확인해 봐요.`,
                ),
            );
        }
    } catch {
        // 나갔거나 삭제된 방에는 뒤늦은 mock AI 메시지를 추가하지 않아요.
    } finally {
        // 삭제된 방의 대기 상태를 다시 만들지 않아요.
        if (messagesByRoom.get(key) === messages) {
            pendingAiByRoom.set(
                key,
                Math.max(0, (pendingAiByRoom.get(key) ?? 1) - 1),
            );
            notify(roomId);
        }
    }
}

/**
 * TODO: API v1.12 10.1
 * POST /api/v1/rooms/{roomId}/messages { content }
 *
 * AI 수신은 추후 명세 11장 MESSAGE_CREATED에 연결해요.
 * 현재는 mock 비동기 응답이에요.
 *
 * clientId는 로컬 재시도 중복 방지용이며 API 요청 본문에 추가하지 않아요.
 * 실제 서버 전송 결과를 모르는 네트워크 실패의 중복 방지는
 * 백엔드와 확인해야 해요.
 */
export async function sendChatMessage(
    roomId: string,
    request: SendChatMessageRequest,
    options: {
        clientId?: string;
        mock?: ChatMockScenario;
    } = {},
): Promise<SendChatMessageResult> {
    const content = toChatApiContent(request.content).trim();

    if (!content || Array.from(content).length > 1000) {
        throw new RoomError(
            'VALIDATION_ERROR',
            '메시지는 공백을 제외한 내용이 있어야 하며 1,000자까지 보낼 수 있어요.',
        );
    }

    await wait(400);

    const detail = await requireChatMember(roomId);
    const key = storeKey(roomId, options.mock);
    const requestKey = options.clientId
        ? `${key}:${options.clientId}`
        : null;

    const previous = requestKey
        ? completedRequests.get(requestKey)
        : undefined;

    if (previous) {
        if (previous.message.content !== content) {
            throw new RoomError(
                'VALIDATION_ERROR',
                '재시도할 메시지 내용이 바뀌었어요. 새 메시지로 보내 주세요.',
            );
        }

        return {
            ...previous,
            message: { ...previous.message },
        };
    }

    if (shouldFail(roomId, options.mock, 'chat-send-error')) {
        throw new RoomError(
            'NETWORK_ERROR',
            '메시지를 보내지 못했어요. 다시 시도해 주세요.',
        );
    }

    const me = detail.members.find(
        member => member.userId === getMyUserId(),
    )!;

    const messages = getMessages(detail, options.mock);
    const message = newMessage('USER', content, me.userId, me.nickname);

    messages.push(message);

    const aiPending = content.toLowerCase().includes('@linkro');
    const result = { message, aiPending };

    if (requestKey) {
        completedRequests.set(requestKey, result);
    }

    if (aiPending) {
        pendingAiByRoom.set(key, (pendingAiByRoom.get(key) ?? 0) + 1);

        const fail = shouldFail(roomId, options.mock, 'chat-ai-error');
        void finishMockAi(roomId, key, messages, fail);
    }

    notify(roomId);

    return {
        ...result,
        message: { ...message },
    };
}
subscribeRoomCacheReset(() => {
    messagesByRoom.clear();
    pendingAiByRoom.clear();
    completedRequests.clear();
    failedOnce.clear();
});
