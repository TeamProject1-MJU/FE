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

/**
 * "다음 열차" 한 대의 문구 (#95, 명세 6.3)
 * - 남은 초 = max(0, secondsUntil − receivedAt 이후 지난 초)
 * - message 가 있으면(공백만 있는 값 제외) 시간 대신 그 문구: "성수행 전역 출발"
 * - message 가 없고 남은 초가 60 미만이면 "성수행 곧 도착", 그 밖에는 "성수행 N분 N초"
 */
export function formatNextTrain(
    train: { destinationLabel: string; secondsUntil: number; message: string | null },
    elapsedSec: number,
) {
    const message = train.message?.trim();
    if (message) return `${train.destinationLabel} ${message}`;
    const seconds = Math.max(0, Math.floor(train.secondsUntil - Math.max(0, elapsedSec)));
    if (seconds < ARRIVING_SOON_SEC) return `${train.destinationLabel} 곧 도착`;
    return `${train.destinationLabel} ${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
}
