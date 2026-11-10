import type { ArrivalsQuery, ArrivalsResponse } from '@/types/arrivals';

export type ArrivalsMock = 'none' | 'fail';

/** 같은 승차 조건은 같은 열차 도착 시각을 공유하는 모듈 수준 mock 상태입니다. */
const arrivalTimes = new Map<string, number>();

export async function fetchArrivals(query: ArrivalsQuery, mock?: ArrivalsMock): Promise<ArrivalsResponse> {
    await new Promise(resolve => setTimeout(resolve, 400));
    if (mock === 'fail') throw new Error('도착정보를 불러오지 못했어요.');
    const base = { stationId: query.stationId, lineId: query.lineId };
    if (mock === 'none') {
        return { ...base, available: false, reason: 'NO_DATA', receivedAt: null, trains: [] };
    }

    const now = Date.now();
    const key = `${query.stationId}:${query.lineId}:${query.nextStationId ?? ''}:${query.directionCode ?? ''}`;
    let firstAt = arrivalTimes.get(key) ?? now + 182000;
    while (firstAt < now) firstAt += 240000;
    arrivalTimes.set(key, firstAt);
    const limit = Math.max(1, Math.min(5, Math.trunc(query.limit ?? 2) || 2));
    const destinationLabel = query.lineId === 7 ? '석남행' : query.lineId === 4 ? '진접행' : '성수행';
    return {
        ...base,
        available: true,
        reason: null,
        receivedAt: new Date(now).toISOString(),
        trains: Array.from({ length: limit }, (_, index) => ({
            destinationLabel,
            directionCode: query.directionCode ?? null,
            nextStationName: null,
            secondsUntil: Math.max(0, Math.ceil((firstAt - now) / 1000)) + index * 240,
            message: null,
        })),
    };
}
