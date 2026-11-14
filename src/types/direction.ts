/**
 * AI 표지판 방향 확인 타입 (API 명세 v1.12 9.1 POST /ai/direction-check)
 */

import type { RouteStep } from '@/types/route';

export type DirectionCode = NonNullable<RouteStep['directionCode']>;

/** multipart 의 route 파트: 사용자가 이동하려는 노선·방향 */
export type DirectionCheckRoute = {
    stationId: number;
    lineId: number;
    /** headsign이 없으면 필수예요. 경로의 directionCode를 그대로 보내요. */
    direction?: DirectionCode;
    /** 알려진 방면 이름만 보내고, 모르면 생략하거나 null로 둬요. */
    headsign?: string | null;
};

export type DirectionResult = 'CORRECT' | 'WRONG' | 'RETAKE';

export type DirectionReason =
    | 'UNKNOWN'
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
    /** 방면 이름이 없는 요청은 expected.headsign이 명시적 null이에요. */
    expected: SignInfo;
    message: string;
};

/** 9.1 오류 코드 */
export type DirectionErrorCode = 'IMAGE_INVALID' | 'AI_QUOTA_EXCEEDED' | 'AI_UNAVAILABLE' | 'NETWORK_ERROR' | 'STATION_NOT_FOUND' | 'VALIDATION_ERROR' | 'UNKNOWN_ERROR';

export type DirectionPhoto = { uri: string; mimeType: 'image/jpeg' | 'image/png'; fileName: string; file?: Blob };

export class DirectionCheckError extends Error {
    code: DirectionErrorCode;

    constructor(code: DirectionErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}
