/**
 * AI 표지판 방향 확인 서비스 (#37, API 명세 v1.12 9.1)
 *
 * TODO: 백엔드 연동 시 POST /ai/direction-check (multipart/form-data) 로 교체합니다.
 * - image: 촬영·선택한 사진 (JPG/PNG, 서버는 저장하지 않음)
 * - route: JSON 문자열 { stationId, lineId, direction?, headsign }
 * - 응답 목표 5초 이내, 오류: IMAGE_INVALID(400) / AI_QUOTA_EXCEEDED(429) / AI_UNAVAILABLE(503)
 *
 * 지금은 실제 촬영·업로드·AI 분석 없이 '예시 사진'을 골라 결과 흐름만 확인합니다.
 */

import {
    DirectionCheckError,
    type DirectionCheckResponse,
    type DirectionCheckRoute,
    type SignInfo,
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
export async function checkDirection(sample: Sample, expected: Expected): Promise<DirectionCheckResponse> {
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