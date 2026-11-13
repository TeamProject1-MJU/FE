import type { ChatMessage } from '@/types/chat';

/**
 * @linkro 질문과 AI 답변 짝짓기 (#138)
 *
 * 명세 v1.13 에는 질문과 답변을 잇는 식별자가 없어요(AI 답변은 senderId·nickname null, meta 는 모든 메시지에서 null).
 * 그래서 임시 규칙으로 짝지어요: 답변 하나는 그 답변보다 먼저 작성됐고 아직 답이 없는 가장 오래된 질문 하나만 해제해요.
 * 방에서 보이는 모든 질문(내 것·다른 사람 것)을 같이 세요. 같은 메시지를 여러 번 받아도 id 로 한 번만 세요.
 * 판단은 이 파일에만 모아 두고, 나중에 BE 가 연결 식별자를 주면 pickAnsweredQuestion 에서 그 값을 먼저 써요.
 */

/** 답변이 짝지을 수 있는 질문의 시간 창이자 질문별 대기 마감(60초). 서버 createdAt 끼리만 비교해요. */
export const AI_REPLY_WINDOW_MS = 60_000;

/** AI 호출 실패로 서버가 보내는 SYSTEM 안내의 시작 문구. 입장·퇴장·약속역 같은 다른 SYSTEM 메시지는 답변이 아니에요. */
const AI_FAILURE_PREFIXES = ['AI 사용 한도를 초과해', 'AI가 답변을 만들지 못했어요'];

/** AI 를 부른 질문: @링크로·@linkro 가 들어 있는 USER 메시지 */
export function isAiQuestion(message: ChatMessage) {
    return message.senderType === 'USER' && /@linkro|@링크로/i.test(message.content);
}

/** 질문 하나를 해제하는 메시지: AI 답변, AI 호출 실패 SYSTEM 안내 */
export function isAiReply(message: ChatMessage) {
    return message.senderType === 'AI'
        || (message.senderType === 'SYSTEM' && AI_FAILURE_PREFIXES.some(prefix => message.content.startsWith(prefix)));
}

/** 작성 시각, 같으면 id(UUIDv7 시간순) 순서 */
export function compareChatOrder(a: ChatMessage, b: ChatMessage) {
    return Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * 답변 하나가 해제할 질문. unanswered 는 아직 답이 없는 질문(오래된 순)이에요.
 * 답변보다 먼저 썼고(compareChatOrder) 답변과의 간격이 AI_REPLY_WINDOW_MS 이하인 질문 중 가장 오래된 하나예요.
 * 시간 창이 없으면 답이 영영 오지 않은 옛 질문이 이후 답변을 가로채서 새 질문의 대기가 60초 만료까지 남아요.
 * TODO(BE 연결 식별자): 답변에 질문 id(예: meta.questionId)가 생기면 그 질문만 돌려주고, 없을 때만 아래 순서 규칙을 써요.
 */
export function pickAnsweredQuestion(reply: ChatMessage, unanswered: readonly ChatMessage[]): ChatMessage | null {
    const replyAt = Date.parse(reply.createdAt);
    return unanswered.find(question => compareChatOrder(question, reply) < 0
        && replyAt - Date.parse(question.createdAt) <= AI_REPLY_WINDOW_MS) ?? null;
}

/** 지금까지 본 질문·답변 전체로 답변된 질문 id 를 계산해요. 받은 순서와 상관없이 같은 결과예요. */
export function matchAiReplies(questions: Iterable<ChatMessage>, replies: Iterable<ChatMessage>) {
    const unanswered = [...questions].sort(compareChatOrder);
    const answered = new Set<string>();
    for (const reply of [...replies].sort(compareChatOrder)) {
        const question = pickAnsweredQuestion(reply, unanswered);
        if (!question) continue;
        answered.add(question.id);
        unanswered.splice(unanswered.indexOf(question), 1);
    }
    return answered;
}

/** 방 하나(화면 하나)의 질문·답변을 모아 두는 추적기. REST·WS·복구로 같은 메시지를 다시 받아도 id 로 한 번만 세요. */
export function createAiReplyTracker() {
    const questions = new Map<string, ChatMessage>();
    const replies = new Map<string, ChatMessage>();
    let answered = new Set<string>();
    const recompute = () => { answered = matchAiReplies(questions.values(), replies.values()); };
    return {
        /** 받은 메시지 중 질문·답변을 기록해요. */
        observe(messages: readonly ChatMessage[]) {
            let changed = false;
            for (const message of messages) {
                if (isAiQuestion(message) && !questions.has(message.id)) { questions.set(message.id, message); changed = true; }
                else if (isAiReply(message) && !replies.has(message.id)) { replies.set(message.id, message); changed = true; }
            }
            if (changed) recompute();
        },
        /** 서버가 AI 대기(aiPending)라고 알려 준 내 질문. 본문에 @링크로가 없어도 질문으로 세요. */
        addQuestion(message: ChatMessage) {
            if (questions.has(message.id)) return;
            questions.set(message.id, message);
            recompute();
        },
        isAnswered: (questionId: string) => answered.has(questionId),
    };
}
