/**
 * 경로 검색 타입 (API 명세 6.1 POST /routes/search 기준)
 */

export type StationSummary = {
    id: number;
    name: string;
    /** 이 역을 지나는 노선 번호 */
    lines: number[];
    /** 서비스 지원 여부 (서울 내 1~8호선) */
    isSupported: boolean;
};

export type CongestionLevel =
    | 'COMFORTABLE'
    | 'RELAXED'
    | 'NORMAL'
    | 'CROWDED'
    | 'VERY_CROWDED';

export type Congestion = {
    supported: boolean;
    kind: 'PREDICTED' | 'ESTIMATED' | 'MOCK' | null;
    pct: number | null;
    level: CongestionLevel | null;
    levelLabel: string | null;
};

export type RouteType = 'FASTEST' | 'FEWER_TRANSFERS' | 'CHEAPEST' | null;
export type RouteSource = 'KAKAO' | 'INTERNAL';
export type FareSource = 'KAKAO' | 'ESTIMATED';

export type RouteLine = {
    id: number | null;
    name: string;
    color: string | null;
};

export type RouteStop = {
    id: number;
    name: string;
    order: number;
};

export type RouteStationCongestion = {
    id: number;
    name: string;
    slotStart: string;
    slotDate: string;
    firstTrain: boolean;
    congestion: Congestion;
};

export type WaitKind = 'REALTIME' | 'ESTIMATED' | 'NONE';

export type RouteStep = {
    waitSec?: number | null;
    waitKind?: WaitKind;
    nextTrains?: { destinationLabel: string; secondsUntil: number; message: string | null; receivedAt: string }[];
    type: 'WALKING' | 'SUBWAY';
    guidance: string;
    durationSec: number;
    distanceM: number;
    line: RouteLine | null;
    direction: string | null;
    directionCode: 'UP' | 'DOWN' | 'INNER' | 'OUTER' | 'LOOP' | null;
    stops: RouteStop[];
    path: [number, number][] | null;
    stations?: RouteStationCongestion[];
};

export type RouteSummary = {
    waitSec?: number | null;
    waitKind?: WaitKind;
    transferWaitSec?: number;
    totalWithWaitSec?: number;
    totalTimeSec: number;
    /** ISO-8601 */
    arrivalAt: string;
    fare: number;
    fareSource: FareSource;
    transferCount: number;
    walkingMinutes: number;
    /** 경로 전체 정차역 혼잡도 중 최댓값 */
    congestion: Congestion;
};

export type Route = {
    routeId: string;
    routeType: RouteType;
    summary: RouteSummary;
    steps: RouteStep[];
};

export type RouteSearchRequest = {
    originStationId: number;
    destinationStationId: number;
    roomId?: string;
};

export type RouteSearchResponse = {
    routeSource: RouteSource;
    routes: Route[];
};

/** 명세 2장 에러 코드 중 경로 검색에서 쓰는 것 */
export type RouteErrorCode =
    | 'STATION_NOT_FOUND'
    | 'STATION_UNSUPPORTED'
    | 'ROUTE_NOT_FOUND'
    | 'EXTERNAL_API_ERROR'
    | 'NETWORK_ERROR';

export class RouteSearchError extends Error {
    code: RouteErrorCode;

    constructor(code: RouteErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}
