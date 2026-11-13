import type { RouteStep, RouteSummary } from '@/types/route';

/** Use Korean service time regardless of the device timezone. */
export function formatClock(iso: string) {
    const time = Date.parse(iso);
    if (!Number.isFinite(time)) return '';
    const date = new Date(time + 9 * 60 * 60 * 1000);
    return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function formatTotalTime(summary: RouteSummary) {
    const minutes = Math.round((summary.totalWithWaitSec ?? summary.totalTimeSec) / 60);
    return `${summary.totalWithWaitSec != null ? '대기 포함 ' : ''}${summary.totalWithWaitSec != null && summary.waitKind === 'ESTIMATED' ? '약 ' : ''}${minutes}분`;
}

/** 승차·환승 대기 줄. waitSec 이 없거나(null) 0 이하이거나 waitKind 가 없으면 줄을 그리지 않아요(빈 문자열). */
export function formatWait(step: RouteStep, transfer: boolean) {
    if (step.waitSec == null || step.waitSec <= 0 || step.waitKind === 'NONE' || !step.waitKind) return '';
    return `${transfer ? '환승 대기' : '승차 대기'} ${step.waitKind === 'ESTIMATED' ? '약 ' : ''}${Math.round(step.waitSec / 60)}분`;
}

/** 방면 코드 표기 (경로 화면·추천 탑승 열차가 같이 써요) */
export const DIRECTION_LABELS = { INNER: '내선', OUTER: '외선', UP: '상행', DOWN: '하행', LOOP: '순환' } as const;

/** 방면 코드를 우선 표시하고 제공된 방면 이름을 덧붙입니다. */
export function formatDirection(step: RouteStep) {
    return [step.directionCode ? DIRECTION_LABELS[step.directionCode] : '', step.direction].filter(Boolean).join(' · ');
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

/**
 * 환승 단계 판별 (#146): 두 SUBWAY 단계 사이에 있는 WALKING 단계예요.
 * 시각표 기반 경로(명세 v1.13)에서는 이 단계의 durationSec 이 도보와 다음 열차 대기를 함께 포함할 수 있어요.
 * routeSource 로 나누지 않아요.
 */
export function isTransferStep(steps: readonly RouteStep[], index: number) {
    if (steps[index]?.type !== 'WALKING') return false;
    return steps.slice(0, index).some(step => step.type === 'SUBWAY') && steps.slice(index + 1).some(step => step.type === 'SUBWAY');
}

/**
 * 환승 단계 뒤 열차의 대기가 화면에 따로 표시되는지.
 * 대기 줄을 그리는 판단(formatWait)을 그대로 써서 두 판단이 어긋나지 않게 해요.
 */
export function hasSeparateTransferWait(steps: readonly RouteStep[], index: number) {
    if (!isTransferStep(steps, index)) return false;
    const next = steps.slice(index + 1).find(step => step.type === 'SUBWAY');
    return !!next && formatWait(next, true) !== '';
}

/** 단계 시간(초) → 분. 0분으로 보이지 않게 최소 1분이에요. 환승·도보 표시가 모두 이 값을 써요. */
export function stepMinutes(durationSec: number) {
    return Math.max(1, Math.round((Number.isFinite(durationSec) ? durationSec : 0) / 60));
}

/** "환승 소요 N분". 대기가 섞여 있을 수 있는 환승 단계에 써요. 도보와 대기를 나누는 필드가 없어 "도보"라고 쓰지 않아요. */
export function formatTransferDuration(step: RouteStep) {
    return `환승 소요 ${stepMinutes(step.durationSec)}분`;
}

/**
 * 펼친 카드에서 지하철 단계 앞 WALKING(steps[index]) 의 문구.
 * - 환승 + 다음 열차 대기가 따로 표시됨: 걷는 시간만이라 "환승 도보 N분"
 * - 환승 + 대기가 따로 표시되지 않음: 대기가 섞여 있을 수 있어 "환승 소요 N분"
 * - 첫 지하철 전 도보: "도보 N분"
 */
export function formatWalkBeforeRide(steps: readonly RouteStep[], index: number) {
    const step = steps[index];
    if (!isTransferStep(steps, index)) return `도보 ${stepMinutes(step.durationSec)}분`;
    return hasSeparateTransferWait(steps, index) ? `환승 도보 ${stepMinutes(step.durationSec)}분` : formatTransferDuration(step);
}

/**
 * 경로 상세의 WALKING 단계 문장.
 * - 환승 + 다음 열차 대기가 따로 표시됨, 또는 환승이 아닌 도보: "{안내} · 도보 N분" (안내 문구는 그대로)
 * - 환승 + 대기가 따로 표시되지 않음: "{안내} · 환승 소요 N분". 안내가 "…환승"으로 끝나면 "환승 … 환승 소요"가 되지 않게
 *   끝의 "환승"을 "이동"으로 바꿔요. 예: "이수역 4호선 승강장으로 환승" → "이수역 4호선 승강장으로 이동 · 환승 소요 3분"
 */
export function formatWalkingStep(steps: readonly RouteStep[], index: number) {
    const step = steps[index];
    const guidance = step.guidance.trim();
    if (!isTransferStep(steps, index) || hasSeparateTransferWait(steps, index)) return `${guidance} · 도보 ${stepMinutes(step.durationSec)}분`;
    const text = /(^|\s)환승$/.test(guidance) ? `${guidance.slice(0, -2)}이동` : guidance;
    return `${text} · ${formatTransferDuration(step)}`;
}
