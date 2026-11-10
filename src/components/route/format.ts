import type { RouteStep } from '@/types/route';

/** 방면 코드를 우선 표시하고 제공된 방면 이름을 덧붙입니다. */
export function formatDirection(step: RouteStep) {
    const labels = { INNER: '내선', OUTER: '외선', UP: '상행', DOWN: '하행', LOOP: '순환' };
    return [step.directionCode ? labels[step.directionCode] : '', step.direction].filter(Boolean).join(' · ');
}
