/**
 * AI 표지판 방향 확인 서비스 (#37, API 명세 v1.12 9.1)
 *
 * 서버 모드: POST /ai/direction-check (multipart/form-data), 인증은 공통 API 클라이언트가 처리합니다.
 * - image: 촬영·선택한 사진 (JPG/PNG, 서버는 저장하지 않음)
 * - route: JSON 문자열 { stationId, lineId, direction?, headsign }
 * - 서버 분석 대기와 업로드 시간을 포함해 요청당 30초를 기다립니다.
 *
 * mock 모드에서는 기존 예시 사진 5종을 사용합니다.
 */

import { post } from '@/services/api/client';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import {
    DirectionCheckError,
    type DirectionCheckResponse,
    type DirectionCheckRoute,
    type SignInfo,
    type DirectionPhoto,
    type DirectionReason,
    type DirectionErrorCode,
} from '@/types/direction';

const MOCK_DELAY_MS = 1500;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 화면에 그릴 표지판 모양 (예시 사진 대신) */
export type SampleSign = {
    lineId: number | null;
    lineName: string;
    headsign: string;
    /** 흐린 사진처럼 보이게 */
    blurred?: boolean;
};

export type SampleId = 'correct' | 'opposite' | 'otherLine' | 'blurry' | 'serverError';

export type Sample = {
    id: SampleId;
    title: string;
    caption: string;
    sign: SampleSign;
};

/** 반대 방면 (mock 표지판을 그릴 때만 사용) */
const OPPOSITE: Record<string, string> = {
    '사당 방면': '성수 방면',
    '성수 방면': '신촌 방면',
    '잠실 방면': '사당 방면',
    '강남 방면': '잠실 방면',
    '석남 방면': '장암 방면',
    '장암 방면': '석남 방면',
    '오이도 방면': '진접 방면',
    '진접 방면': '오이도 방면',
    '오금 방면': '대화 방면',
    '대화 방면': '오금 방면',
};

export const LINE_COLORS: Record<number, string> = {
    1: '#0052A4',
    2: '#00A84D',
    3: '#EF7C1C',
    4: '#00A5DE',
    5: '#996CAC',
    6: '#CD7C2F',
    7: '#747F00',
    8: '#E6186C',
};

type Expected = DirectionCheckRoute & { stationName: string; lineName: string };

/** 사용자 경로에 맞춰 예시 사진 5장을 만듭니다. */
export function buildSamples(expected: Expected): Sample[] {
    const otherLineId = expected.lineId === 3 ? 2 : 3;
    return [
        {
            id: 'correct',
            title: '맞는 방향',
            caption: '경로와 같은 방면',
            sign: { lineId: expected.lineId, lineName: expected.lineName, headsign: expected.headsign },
        },
        {
            id: 'opposite',
            title: '반대 방향',
            caption: '반대 방면 표지판',
            sign: {
                lineId: expected.lineId,
                lineName: expected.lineName,
                headsign: OPPOSITE[expected.headsign] ?? '반대 방면',
            },
        },
        {
            id: 'otherLine',
            title: '다른 노선',
            caption: '경로에 없는 노선',
            sign: { lineId: otherLineId, lineName: `${otherLineId}호선`, headsign: '대화 방면' },
        },
        {
            id: 'blurry',
            title: '흐린 사진',
            caption: '글자를 읽기 어려움',
            sign: { lineId: expected.lineId, lineName: expected.lineName, headsign: expected.headsign, blurred: true },
        },
        {
            id: 'serverError',
            title: '분석 실패',
            caption: 'AI 일시 장애 (503)',
            sign: { lineId: expected.lineId, lineName: expected.lineName, headsign: expected.headsign },
        },
    ];
}

/** 9.1 mock: 고른 예시 사진에 맞는 응답을 돌려줍니다. */
async function checkMockDirection(sample: Sample, expected: Expected): Promise<DirectionCheckResponse> {
    await wait(MOCK_DELAY_MS);

    const expectedInfo: SignInfo = {
        stationName: expected.stationName,
        lineName: expected.lineName,
        headsign: expected.headsign,
    };
    const recognized: SignInfo = {
        stationName: expected.stationName,
        lineName: sample.sign.lineName,
        headsign: sample.sign.headsign,
    };

    switch (sample.id) {
        case 'correct':
            return {
                result: 'CORRECT',
                reason: null,
                recognized,
                expected: expectedInfo,
                message: '올바른 방향입니다. 이 승강장에서 탑승하세요.',
            };
        case 'opposite':
            return {
                result: 'WRONG',
                reason: 'DIRECTION_MISMATCH',
                recognized,
                expected: expectedInfo,
                message: '반대 방향입니다. 내 경로의 방면을 다시 확인하세요.',
            };
        case 'otherLine':
            return {
                result: 'WRONG',
                reason: 'LINE_NOT_ON_ROUTE',
                recognized,
                expected: expectedInfo,
                message: '경로에 없는 노선입니다. 내 경로의 노선을 다시 확인하세요.',
            };
        case 'blurry':
            return {
                result: 'RETAKE',
                reason: 'UNREADABLE',
                recognized: { stationName: null, lineName: null, headsign: null },
                expected: expectedInfo,
                message: '표지판 글자를 읽기 어렵습니다. 가까이에서 다시 촬영해 주세요.',
            };
        case 'serverError':
        default:
            throw new DirectionCheckError('AI_UNAVAILABLE', 'AI가 잠시 응답하지 않아요.');
    }
}

export const DIRECTION_CHECK_TIMEOUT_MS = 30000;
const reasons: readonly string[] = ['LINE_NOT_ON_ROUTE', 'DIRECTION_MISMATCH', 'NOT_A_SIGN', 'UNREADABLE', 'MISSING_INFO'];
const errorCodes: readonly string[] = ['IMAGE_INVALID', 'AI_QUOTA_EXCEEDED', 'AI_UNAVAILABLE', 'STATION_NOT_FOUND', 'VALIDATION_ERROR', 'NETWORK_ERROR'];
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseDirectionResponse(value: unknown): DirectionCheckResponse {
    const invalid = () => new DirectionCheckError('UNKNOWN_ERROR', '분석 응답을 확인하지 못했어요. 다시 시도해 주세요.');
    if (!record(value) || !['CORRECT', 'WRONG', 'RETAKE'].includes(String(value.result)) ||
        typeof value.message !== 'string' || !(value.reason === null || typeof value.reason === 'string') ||
        (value.result === 'CORRECT' && value.reason !== null) || (value.result !== 'CORRECT' && value.reason === null)) throw invalid();
    const sign = (input: unknown, nullable: boolean): SignInfo => {
        if (!record(input)) throw invalid();
        for (const key of ['stationName', 'lineName', 'headsign']) {
            if (typeof input[key] !== 'string' && !(nullable && input[key] === null)) throw invalid();
        }
        return { stationName: input.stationName as string | null, lineName: input.lineName as string | null, headsign: input.headsign as string | null };
    };
    const unknownReason = value.reason !== null && !reasons.includes(value.reason as string);
    return {
        result: value.result as DirectionCheckResponse['result'],
        reason: value.reason === null ? null : unknownReason ? 'UNKNOWN' : value.reason as DirectionReason,
        recognized: sign(value.recognized, true), expected: sign(value.expected, false),
        message: unknownReason ? '표지판과 경로를 다시 확인해 주세요.' : value.message,
    };
}

export function checkDirection(photo: DirectionPhoto, route: DirectionCheckRoute): Promise<DirectionCheckResponse>;
export function checkDirection(sample: Sample, expected: Expected): Promise<DirectionCheckResponse>;
export async function checkDirection(input: DirectionPhoto | Sample, route: DirectionCheckRoute | Expected): Promise<DirectionCheckResponse> {
    if (isMockMode()) return checkMockDirection(input as Sample, route as Expected);
    const photo = input as DirectionPhoto;
    const form = new FormData();
    if (photo.file) form.append('image', photo.file, photo.fileName);
    else form.append('image', { uri: photo.uri, type: photo.mimeType, name: photo.fileName } as unknown as Blob);
    form.append('route', JSON.stringify({ stationId: route.stationId, lineId: route.lineId, headsign: route.headsign, ...(route.direction ? { direction: route.direction } : {}) }));
    try {
        return parseDirectionResponse(await post<unknown>('/ai/direction-check', form, { timeoutMs: DIRECTION_CHECK_TIMEOUT_MS }));
    } catch (error) {
        if (isAuthError(error)) throw error;
        if (error instanceof DirectionCheckError) throw error;
        const code = error instanceof ApiError && errorCodes.includes(error.code) ? error.code as DirectionErrorCode : 'UNKNOWN_ERROR';
        throw new DirectionCheckError(code, '방향을 확인하지 못했어요.');
    }
}
