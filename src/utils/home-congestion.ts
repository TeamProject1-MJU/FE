import type { CongestionResponse, DirectionCode } from '@/types/congestion';
import { toCongestion } from '@/types/congestion';
import type { Congestion } from '@/types/route';
import type { Station, StationLine } from '@/types/station';
import { blockLevel } from '@/utils/congestion-level';
import type { Coordinate } from '@/utils/home-map';
import { formatSeoulTime, seoulDateKey } from '@/utils/seoul-time';

export type HomeCongestionData = {
    station: Pick<Station, 'id' | 'name'>;
    line: StationLine;
    direction: DirectionCode;
    congestion: Congestion;
};

export type HomeCongestionState =
    | { kind: 'off' }
    | { kind: 'loading' }
    | { kind: 'hidden' }
    | { kind: 'empty' }
    | { kind: 'error' }
    | { kind: 'unsupported' }
    | { kind: 'ready'; data: HomeCongestionData };

export function selectedCongestionLabel(state: HomeCongestionState): string {
    switch (state.kind) {
        case 'ready': return state.data.congestion.levelLabel ?? '혼잡도 정보 없음';
        case 'loading': return '혼잡도를 불러오고 있어요';
        case 'error': return '혼잡도를 불러오지 못했어요';
        case 'unsupported': return '지원하지 않는 역이에요';
        default: return '혼잡도 정보 없음';
    }
}

export function nearestHomeStation(location: Coordinate | null, stations: readonly Station[]) {
    if (!location) return null;
    let nearest: Station | null = null;
    let distance = Infinity;
    for (const station of stations) {
        if (!station.isSupported) continue;
        const next = (station.latitude - location.latitude) ** 2 + (station.longitude - location.longitude) ** 2;
        if (next < distance) { nearest = station; distance = next; }
    }
    return nearest;
}

export function homeCongestionDirections(lineName: string): DirectionCode[] {
    return lineName === '2호선' ? ['INNER', 'OUTER'] : ['UP', 'DOWN'];
}

export function highestHomeCongestion(responses: readonly CongestionResponse[]) {
    let best: CongestionResponse | null = null;
    for (const response of responses) {
        if (!response.supported) continue;
        if (!best || blockLevel(response) > blockLevel(best)) best = response;
    }
    return best;
}

export function homeCongestionTime(now: Date) {
    const iso = now.toISOString();
    const date = seoulDateKey(iso)!;
    const time = formatSeoulTime(iso);
    const slot = `${time.slice(0, 3)}${Number(time.slice(3)) < 30 ? '00' : '30'}`;
    return { date, time, slot };
}

/** The query is only a preview in mock mode; server mode always ignores it. */
export function homeCongestionPreview(serverMode: boolean, mock: string | string[] | undefined): HomeCongestionData | null {
    if (serverMode || mock !== 'congestion') return null;
    return {
        station: { id: 201, name: '시청역' },
        line: { lineId: 2, lineName: '2호선', color: '#00A84D', stationCode: '201' },
        direction: 'INNER',
        congestion: toCongestion({ supported: true, level: 'RELAXED', levelLabel: '여유', pct: 42, kind: 'ESTIMATED' }),
    };
}
