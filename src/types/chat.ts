/**
 * 약속방 채팅 (#52)
 * API 명세 v1.12 10.1 메시지 전송 · 10.2 메시지 조회
 */

/** 서버에서 구분하는 메시지 발신자 유형 */
export type ChatSenderType = 'USER' | 'AI' | 'SYSTEM';

/** API 메시지 객체 */
export type ChatMessage = {
    id: string;
    senderType: ChatSenderType;
    /** AI·SYSTEM 메시지는 null */
    senderId: string | null;
    /** 서버가 저장한 닉네임. AI·SYSTEM은 null */
    nickname: string | null;
    content: string;
    /** ISO 8601 형식 */
    createdAt: string;
    /** 명세 10.1: 현재 사용하는 확장 정보가 없어 null */
    meta: null;
};

/**
 * API 10.2 메시지 목록
 * items는 최신 메시지부터 내려오며, 화면에서는 오래된 순서로 표시해요.
 */
export type ChatMessagePage = {
    items: ChatMessage[];
    nextCursor: string | null;
    hasMore: boolean;
};

/** API 10.1 전송 요청 */
export type SendChatMessageRequest = {
    content: string;
};

/** API 10.1 전송 성공 결과 */
export type SendChatMessageResult = {
    message: ChatMessage;
    aiPending: boolean;
};

/**
 * 전송 중이거나 전송에 실패한 메시지의 화면 상태예요.
 * 서버에 보내는 요청 필드와 분리해서 관리해요.
 */
export type PendingChatMessage = {
    clientId: string;
    content: string;
    createdAt: string;
    status: 'sending' | 'failed';
    errorMessage?: string;
    /**
     * 응답이 유실된 뒤 재시도 전에 저장 여부를 끝까지 확인하지 못했어요(#139).
     * 이 상태에서 다시 누르면 확인 없이 보내요(같은 메시지가 두 번 저장될 수 있다고 안내해요).
     */
    unconfirmed?: boolean;
};

/** 화면 검증용 쿼리 값: ?mock=chat-error 등 */
export type ChatMockScenario =
    | 'chat-empty'
    | 'chat-error'
    | 'chat-send-error'
    | 'chat-ai-error'
    | 'chat-history-error';
