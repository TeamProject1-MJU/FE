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
    slotDate: string | null;
    firstTrain: boolean;
    congestion: Congestion;
};

export type WaitKind = 'REALTIME' | 'ESTIMATED' | 'NONE' | 'TIMETABLE';

/**
 * 경로 단계 (명세 6.1)
 * - 두 SUBWAY 사이의 WALKING 은 환승 단계예요. 시각표 기반 경로(약속방 모드, 8.1)에서는 이 단계의 durationSec 이
 *   도보와 다음 열차 대기를 함께 포함해요(명세 v1.13: 하차부터 다음 승차까지). 도보와 대기를 나누는 필드는 없어요.
 * - 그래서 다음 열차 대기(waitSec)가 따로 표시되지 않는 환승 단계는 "도보"가 아니라 "환승 소요 N분"으로 표시해요.
 *   대기가 따로 표시되면 환승 단계는 걷는 시간만이라 "환승 도보 N분"이에요(#146, components/route/format.ts).
 */
export type RouteStep = {
    waitSec?: number | null;
    waitKind?: WaitKind | null;
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
    departureAt?: string;
    noService: boolean;
    serviceNotice: string | null;
    arrivesAfterAppointment: boolean;
    waitSec?: number | null;
    waitKind?: WaitKind | null;
    transferWaitSec?: number;
    totalWithWaitSec?: number | null;
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
    appointmentPassed: boolean;
    notice: string | null;
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
