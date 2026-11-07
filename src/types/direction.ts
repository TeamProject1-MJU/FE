/**
 * AI 표지판 방향 확인 타입 (API 명세 v1.12 9.1 POST /ai/direction-check)
 */

import type { RouteStep } from '@/types/route';

export type DirectionCode = NonNullable<RouteStep['directionCode']>;

/** multipart 의 route 파트: 사용자가 이동하려는 노선·방향 */
export type DirectionCheckRoute = {
    stationId: number;
    lineId: number;
    /** 모르면 생략 → 서버가 headsign 으로 비교 */
    direction?: DirectionCode;
    headsign: string;
};

export type DirectionResult = 'CORRECT' | 'WRONG' | 'RETAKE';

export type DirectionReason =
    | 'LINE_NOT_ON_ROUTE'
    | 'DIRECTION_MISMATCH'
    | 'NOT_A_SIGN'
    | 'UNREADABLE'
    | 'MISSING_INFO';

export type SignInfo = {
    stationName: string | null;
    lineName: string | null;
    headsign: string | null;
};

export type DirectionCheckResponse = {
    result: DirectionResult;
    /** CORRECT 이면 null */
    reason: DirectionReason | null;
    recognized: SignInfo;
    expected: SignInfo;
    message: string;
};

/** 9.1 오류 코드 */
export type DirectionErrorCode = 'IMAGE_INVALID' | 'AI_QUOTA_EXCEEDED' | 'AI_UNAVAILABLE' | 'NETWORK_ERROR';

export class DirectionCheckError extends Error {
    code: DirectionErrorCode;

    constructor(code: DirectionErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}