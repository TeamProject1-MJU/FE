import type { DirectionCheckRoute, DirectionCode } from '@/types/direction';
import type { RouteStep } from '@/types/route';

export type DirectionRouteInput = { stationId?: unknown; lineId?: unknown; direction?: unknown; headsign?: unknown };
const DIRECTION_CODES: readonly string[] = ['UP', 'DOWN', 'INNER', 'OUTER', 'LOOP'];

function positiveId(value: unknown) {
    const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** 안내·사진 선택·전송에서 같은 조건을 사용하며 방면 이름을 만들어 넣지 않아요. */
export function directionRouteIssue(input: DirectionRouteInput): string | null {
    if (positiveId(input.stationId) === null || positiveId(input.lineId) === null) {
        return '승차역이나 노선 정보를 확인할 수 없어 표지판으로 방향을 확인할 수 없어요.';
    }
    if (input.direction != null && typeof input.direction !== 'string') return '방향 정보를 확인할 수 없어요. 경로를 다시 선택해 주세요.';
    if (input.headsign != null && typeof input.headsign !== 'string') return '방면 정보를 확인할 수 없어요. 경로를 다시 선택해 주세요.';
    const direction = typeof input.direction === 'string' ? input.direction.trim() : '';
    const headsign = typeof input.headsign === 'string' ? input.headsign.trim() : '';
    if (direction && !DIRECTION_CODES.includes(direction)) return '방향 정보를 확인할 수 없어요. 경로를 다시 선택해 주세요.';
    if (!direction && !headsign) return '이 구간은 방향·방면 정보가 없어 표지판으로 확인할 수 없어요.';
    return null;
}

export function normalizeDirectionRoute(input: DirectionRouteInput): DirectionCheckRoute | null {
    if (directionRouteIssue(input)) return null;
    const direction = typeof input.direction === 'string' ? input.direction.trim() : '';
    const headsign = typeof input.headsign === 'string' ? input.headsign.trim() : '';
    return { stationId: positiveId(input.stationId)!, lineId: positiveId(input.lineId)!,
        ...(headsign ? { headsign } : {}), ...(direction ? { direction: direction as DirectionCode } : {}) };
}

export function directionInputFromStep(step: RouteStep): DirectionRouteInput {
    return { stationId: step.stops[0]?.id, lineId: step.line?.id, direction: step.directionCode, headsign: step.direction };
}

export function directionStepIssue(step: RouteStep): string | null {
    return step.type === 'SUBWAY' ? directionRouteIssue(directionInputFromStep(step)) : '지하철 승차 구간에서 표지판 방향을 확인해 주세요.';
}
