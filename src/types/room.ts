/**
 * 약속방 타입 (API 명세 v1.12 7장 /rooms)
 */

/** 방 상태: 약속역(selectedStation)이 있으면 CONFIRMED, 없으면 OPEN (명세 7장) */
export type RoomStatus = 'OPEN' | 'CONFIRMED';
export type RoomRole = 'OWNER' | 'MEMBER';

/**
 * 확정된 약속역
 * 명세 7.3 예시는 null 만 있어 모양이 정해지지 않았습니다. 7.4 departureStation 과 같은 모양으로 가정합니다.
 * TODO: 백엔드와 selectedStation 모양 확인
 */
export type RoomStation = {
    id: number;
    name: string;
    lines?: { lineId: number; lineName: string; color: string }[];
};

/** 7.3 GET /rooms 목록 항목 (초대 코드는 목록에 없음) */
export type RoomSummary = {
    id: string;
    name: string;
    status: RoomStatus;
    myRole: RoomRole;
    memberCount: number;
    /** 4명 고정 */
    maxMembers: number;
    /** ISO-8601, 없으면 null */
    appointmentAt: string | null;
    selectedStation: RoomStation | null;
};

/** 7.6 GET /rooms/{roomId}/members 항목 (7.4 members 와 같은 구조) */
export type RoomMember = {
    userId: string;
    nickname: string;
    role: RoomRole;
    /** ISO-8601 */
    joinedAt: string;
    /** 출발역을 아직 정하지 않았으면 null */
    departureStation: (RoomStation & { isSupported: boolean }) | null;
};

/** 7.1 POST /rooms 요청 */
export type CreateRoomRequest = {
    name: string;
    appointmentAt: string | null;
};

/** 7.1 POST /rooms 응답 (roomCode 는 방장에게만) */
export type CreatedRoom = RoomSummary & { roomCode: string; ownerId: string };

/** 7.4 GET /rooms/{roomId} 상세 (초대 코드는 포함하지 않음, 방장은 7.9 로 따로 조회) */
export type RoomDetail = RoomSummary & {
    ownerId: string;
    /** 약속역을 확정한 시각, 미확정이면 null */
    confirmedAt: string | null;
    members: RoomMember[];
};

/** 약속역 후보 (1인 1표, 투표 변경·취소 없음) */
export type RoomCandidate = {
    id: string;
    station: RoomStation;
    proposerId: string;
    proposerNickname: string;
    voteCount: number;
    votedByMe: boolean;
    /** 추천 결과에서 제안한 경우 그 결과 카드의 resultId (7.14 source_result_id), 직접 제안이면 없음 */
    sourceResultId?: string;
};

/** 7.8 나가기 응답 */
export type LeaveRoomResult = {
    roomDeleted: boolean;
    newOwnerId: string | null;
};

export type RoomErrorCode =
    | 'ROOM_CODE_INVALID'
    | 'ROOM_FULL'
    | 'ALREADY_JOINED'
    | 'ROOM_BUSY'
    | 'ROOM_NOT_FOUND'
    | 'NOT_ROOM_MEMBER'
    | 'NOT_ROOM_OWNER'
    | 'ALREADY_VOTED'
    | 'STATION_NOT_FOUND'
    | 'STATION_UNSUPPORTED'
    | 'VALIDATION_ERROR'
    | 'NETWORK_ERROR';

export class RoomError extends Error {
    code: RoomErrorCode;

    constructor(code: RoomErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}