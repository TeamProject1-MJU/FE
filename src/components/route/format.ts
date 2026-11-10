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
