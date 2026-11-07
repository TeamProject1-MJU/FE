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

/** 7.1 POST /rooms 요청 */
export type CreateRoomRequest = {
    name: string;
    appointmentAt: string | null;
};

/** 7.1 POST /rooms 응답 (roomCode 는 방장에게만) */
export type CreatedRoom = RoomSummary & { roomCode: string; ownerId: string };

export type RoomErrorCode =
    | 'ROOM_CODE_INVALID'
    | 'ROOM_FULL'
    | 'ALREADY_JOINED'
    | 'VALIDATION_ERROR'
    | 'NETWORK_ERROR';

export class RoomError extends Error {
    code: RoomErrorCode;

    constructor(code: RoomErrorCode, message: string) {
        super(message);
        this.code = code;
    }
}