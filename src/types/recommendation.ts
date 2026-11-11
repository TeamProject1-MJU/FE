/**
 * 중간역 추천 타입 (API 명세 v1.12 8장 /rooms/{roomId}/recommendations, #99 BE 코드 기준으로 보정)
 *
 * 8.1 POST  /rooms/{roomId}/recommendations            추천 실행
 * 8.2 GET   /rooms/{roomId}/recommendations/latest     최근 실행 (없으면 data: null)
 * 8.3 GET   /rooms/{roomId}/recommendations/{runId}    특정 실행 (최근 실행이 아니면 isStale·staleReasons = null)
 */

import type { CongestionLevel } from '@/types/route';

export type RecommendationCriterion = 'TIME' | 'FARE' | 'DISTANCE';

export type StaleReason = 'APPOINTMENT_CHANGED' | 'MEMBERS_CHANGED';

/** 8.1 요청 filter. conditionText 와 같은 항목이 있으면 filter 가 우선 */
export type RecommendationFilter = {
    maxMinutes?: number;
    maxTransfers?: number;
    maxFareWon?: number;
    excludeStationIds?: number[];
    memberLimits?: { userId: string; maxMinutes: number }[];
};

/** 8.1 요청: 둘 다 선택. 둘 다 생략하면 제약 없이 추천 */
export type RecommendationRequest = {
    conditionText?: string;
    filter?: RecommendationFilter;
};

/**
 * 서버가 최종 적용한 조건 ("이렇게 이해했어요")
 * 서버는 maxMinutes·maxTransfers·maxFareWon 을 null 로, excludeStationIds·memberLimits 를 빈 배열로 보낼 수 있어요.
 * 서비스가 null·빈 배열을 빼서 정리하므로 화면은 "값이 있는 항목 = 적용된 조건"으로 읽어요.
 */
export type AppliedConstraints = RecommendationFilter;

export type RecommendedStation = {
    id: number;
    name: string;
    /** 화면에서 쓰지 않아 서버가 보내지 않으면 비어 있을 수 있어요. */
    latitude?: number;
    longitude?: number;
    isSupported?: boolean;
    /**
     * 화면 노선 배지용 (7.4 departureStation.lines 와 같은 모양).
     * 서버 응답에는 없어서 역 상세(5.3 fetchStation)로 채워요. 조회에 실패하면 비워 두고 배지만 숨겨요.
     */
    lines?: { lineId: number; lineName: string; color: string }[];
};

/** trips 에서 계산해 응답하는 요약. 시간은 분, 요금은 원 (모두 다익스트라 추정치) */
export type RecommendationMetrics = {
    averageMinutes: number;
    maxDifferenceMinutes: number;
    maxMinutes: number;
    /** 1인 평균 예상 요금 */
    averageFare: number;
    /** 화면에서 쓰지 않아요. */
    totalTransfers?: number;
};

export type ParticipantSegment = {
    lineId: number;
    lineName: string;
    color: string;
    /** 화면에서 쓰지 않아요. */
    direction?: 'UP' | 'DOWN' | 'INNER' | 'OUTER' | 'LOOP' | null;
    fromStationName: string;
    toStationName: string;
    stationCount: number;
};

/** 참여자별 이동 정보 (추천용 추정치, 카카오 경로 값이 아님) */
export type ParticipantTime = {
    userId: string;
    nickname: string;
    departureStation: { id: number; name: string };
    travelMinutes: number;
    transferCount: number;
    fareWon: number;
    distanceM: number;
    /** 출발 예정 시각 = 약속 시각 − travelMinutes (약속 시각 없으면 요청 시각), ISO-8601 */
    departureAt: string;
    /** 경로 정차역 혼잡도 최댓값. 데이터가 없으면 null 이에요(화면은 혼잡도 점·라벨을 숨겨요). */
    congestion: { pct?: number; level: CongestionLevel; levelLabel: string } | null;
    segments: ParticipantSegment[];
    /** 서버가 더 보내는 값이에요. 이번 범위에서는 화면에 쓰지 않고 그대로 통과만 시켜요. */
    boardingTrain?: unknown;
    legs?: unknown;
    source?: 'TIMETABLE' | 'ESTIMATE' | string | null;
    arriveAt?: string | null;
    slackSeconds?: number | null;
};

/** 최적역의 노선상 앞·뒤 한 정거장 (2·3위 후보가 아님) */
export type NearbyAlternative = {
    station: { id: number; name: string };
    lineId: number;
    relation: 'PREV' | 'NEXT';
    relationLabel: string;
    maxMinutes: number;
    totalFareWon: number;
};

export type RecommendationResult = {
    /** recommendation_results 행 ID. 후보 제안(7.14)의 sourceResultId 로 씀 */
    resultId: string;
    criterion: RecommendationCriterion;
    recommendedStation: RecommendedStation;
    metrics: RecommendationMetrics;
    participantTimes: ParticipantTime[];
    nearbyAlternatives: NearbyAlternative[];
    explanation: string;
    explanationSource: 'AI' | 'TEMPLATE';
};

/**
 * 8.1 / 8.2 / 8.3 공통 응답
 * - isStale: true(최신 아님) / false(최신) / null(8.3 이전 실행 → 판정 안 함). 반드시 === true / === false 로 비교
 * - results 가 빈 배열이면 "조건에 맞는 역 없음" (에러 아님, message 에 안내)
 */
export type RecommendationRun = {
    runId: string;
    createdAt: string;
    isStale: boolean | null;
    staleReasons: StaleReason[] | null;
    conditionText: string | null;
    appliedConstraints: AppliedConstraints;
    /** 조건 해석 실패·결과 없음 등 안내. 없으면 null */
    message: string | null;
    results: RecommendationResult[];
};

export type RecommendationErrorCode =
    | 'TOO_FEW_MEMBERS'
    | 'DEPARTURE_MISSING'
    | 'STATION_UNSUPPORTED'
    | 'NOT_ROOM_MEMBER'
    | 'ROOM_NOT_FOUND'
    | 'RUN_NOT_FOUND'
    | 'NETWORK_ERROR'
    /** 422 약속 시각이 이미 지남 */
    | 'APPOINTMENT_PASSED'
    /** 422 약속 시각 전 60분 안에 도착하는 열차가 없음 */
    | 'NO_SERVICE_TIME'
    /** 409 같은 방에서 이미 계산 중 */
    | 'RECOMMENDATION_IN_PROGRESS'
    /** 400 요청 값 범위 오류 */
    | 'VALIDATION_ERROR'
    /** 응답 형식 오류·모르는 서버 코드 */
    | 'UNKNOWN_ERROR';

export class RecommendationError extends Error {
    code: RecommendationErrorCode;
    /** DEPARTURE_MISSING 일 때 출발역이 없는 멤버 userId 목록 (명세 8.1 error.details.missingUserIds) */
    missingUserIds?: string[];

    constructor(code: RecommendationErrorCode, message: string, missingUserIds?: string[]) {
        super(message);
        this.code = code;
        this.missingUserIds = missingUserIds;
    }
}
