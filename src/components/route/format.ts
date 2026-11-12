import type { RouteStep, RouteSummary } from '@/types/route';

export function formatTotalTime(summary: RouteSummary) {
    const minutes = Math.round((summary.totalWithWaitSec ?? summary.totalTimeSec) / 60);
    return `${summary.totalWithWaitSec != null ? '대기 포함 ' : ''}${summary.totalWithWaitSec != null && summary.waitKind === 'ESTIMATED' ? '약 ' : ''}${minutes}분`;
}

export function formatWait(step: RouteStep, transfer: boolean) {
    if (step.waitSec == null || step.waitKind === 'NONE' || !step.waitKind) return '';
    return `${transfer ? '환승 대기' : '승차 대기'} ${step.waitKind === 'ESTIMATED' ? '약 ' : ''}${Math.round(step.waitSec / 60)}분`;
}

/** 방면 코드를 우선 표시하고 제공된 방면 이름을 덧붙입니다. */
export function formatDirection(step: RouteStep) {
    const labels = { INNER: '내선', OUTER: '외선', UP: '상행', DOWN: '하행', LOOP: '순환' };
    return [step.directionCode ? labels[step.directionCode] : '', step.direction].filter(Boolean).join(' · ');
}

/** 남은 시간이 이 값(초) 미만이면 "곧 도착"으로 표시해요. */
export const ARRIVING_SOON_SEC = 60;

/** 서버 행선지 "성수" → "성수행". 이미 "행"으로 끝나면 그대로 둬요. */
export function formatDestination(name: string) {
    const trimmed = name.trim();
    return trimmed.endsWith('행') ? trimmed : `${trimmed}행`;
}

/**
 * "다음 열차" 한 대의 문구 (#95, 명세 6.3)
 * - secondsUntil 이 숫자이면 message 와 상관없이 카운트다운해요.
 *   남은 초 = max(0, secondsUntil − receivedAt 이후 지난 초). 60초 미만이면 "성수행 곧 도착", 그 밖에는 "성수행 N분 N초"
 * - secondsUntil 이 null 일 때만 message(서버 arvlMsg2 원문)를 시간 대신 보여줘요: "성수행 · 2번째 전역"
 *   message 맨 앞 "[N]" 은 대괄호만 빼요(#103). "[3]번째 전역 (남영)" → "3번째 전역 (남영)". 나머지 글자는 원문 그대로예요.
 *   message 가 이미 "성수행"으로 시작하면 행선지를 한 번만 보여줘요. message 도 비어 있으면 행선지만 보여줘요.
 */
export function formatNextTrain(
    train: { destinationName: string; secondsUntil: number | null; message: string | null },
    elapsedSec: number,
) {
    const destination = formatDestination(train.destinationName);
    if (train.secondsUntil !== null) {
        const seconds = Math.max(0, Math.floor(train.secondsUntil - Math.max(0, elapsedSec)));
        if (seconds < ARRIVING_SOON_SEC) return `${destination} 곧 도착`;
        return `${destination} ${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
    }
    let message = train.message?.trim() ?? '';
    if (message.startsWith(destination)) message = message.slice(destination.length).replace(/^[\s·]+/, '');
    message = message.replace(/^\[(\d+)\]/, '$1');
    return message ? `${destination} · ${message}` : destination;
}
