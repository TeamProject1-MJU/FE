/**
 * 약속방 서비스 (#42, API 명세 v1.12 7.1~7.3, 7.5, 7.8)
 *
 * TODO: 백엔드 연동 시 아래 API 호출로 교체합니다.
 * - GET    /rooms                    내 방 목록
 * - POST   /rooms                    방 생성 { name, appointmentAt } (정원 4명 고정)
 * - POST   /rooms/join               초대 코드로 참여 { roomCode }
 * - PATCH  /rooms/{roomId}           방 정보 수정 (OWNER)
 * - DELETE /rooms/{roomId}/members/me  나가기
 *
 * 지금은 앱이 켜져 있는 동안만 유지되는 mock 목록으로 생성·참여·수정·나가기 결과를 반영합니다.
 */

import {
    RoomError,
    type CreateRoomRequest,
    type CreatedRoom,
    type RoomSummary,
} from '@/types/room';

const MOCK_DELAY_MS = 600;
const MAX_MEMBERS = 4;
/** 방 이름 길이 (명세 부록 A ck_room_name: char_length(btrim(name)) BETWEEN 1 AND 30) */
export const ROOM_NAME_MAX = 30;

/** 방 이름 글자 수: 앞뒤 공백을 빼고 글자 단위로 셉니다(서버와 같은 기준) */
export function roomNameLength(value: string) {
    return Array.from(value.trim()).length;
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 오늘 기준 n일 뒤 시각 (시연 날짜와 상관없이 D-day 가 자연스럽게 보이도록) */
function daysFromToday(days: number, hour: number, minute = 0) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date.toISOString();
}

let seq = 100;
const newId = () => `room-${seq++}`;

let rooms: RoomSummary[] = [
    {
        id: 'room-1',
        name: '기말 끝 파티',
        status: 'CONFIRMED',
        myRole: 'OWNER',
        memberCount: 4,
        maxMembers: MAX_MEMBERS,
        appointmentAt: daysFromToday(7, 18),
        selectedStation: {
            id: 114,
            name: '건대입구',
            lines: [
                { lineId: 2, lineName: '2호선', color: '#00A84D' },
                { lineId: 7, lineName: '7호선', color: '#747F00' },
            ],
        },
    },
    // 홈 화면 '다가오는 약속' mock(constants/home-mock.ts)과 같은 방
    {
        id: 'room-2',
        name: '주말 저녁 모임',
        status: 'CONFIRMED',
        myRole: 'MEMBER',
        memberCount: 3,
        maxMembers: MAX_MEMBERS,
        appointmentAt: daysFromToday(3, 18),
        selectedStation: {
            id: 102,
            name: '시청',
            lines: [
                { lineId: 1, lineName: '1호선', color: '#0052A4' },
                { lineId: 2, lineName: '2호선', color: '#00A84D' },
            ],
        },
    },
    {
        id: 'room-4',
        name: '동아리 회식',
        status: 'OPEN',
        myRole: 'OWNER',
        memberCount: 2,
        maxMembers: MAX_MEMBERS,
        appointmentAt: daysFromToday(5, 19, 30),
        selectedStation: null,
    },
    {
        id: 'room-3',
        name: '스터디 뒤풀이',
        status: 'OPEN',
        myRole: 'MEMBER',
        memberCount: 2,
        maxMembers: MAX_MEMBERS,
        appointmentAt: null,
        selectedStation: null,
    },
];

/** mock 초대 코드 → 참여할 방 */
const JOINABLE: Record<string, () => RoomSummary> = {
    A3K9PZ: () => ({
        id: newId(),
        name: '금요일 저녁',
        status: 'OPEN',
        myRole: 'MEMBER',
        memberCount: 3,
        maxMembers: MAX_MEMBERS,
        appointmentAt: daysFromToday(1, 19),
        selectedStation: null,
    }),
};
/** 정원이 찬 방 코드 (mock) */
const FULL_CODES = new Set(['FULL44']);
/** 참여한 코드 → 방 id (나가면 다시 참여할 수 있도록) */
const joinedCodes = new Map<string, string>();

/** 약속 시각이 빠른 순, 시각이 없는 방은 맨 뒤 */
function sortRooms(list: RoomSummary[]) {
    return [...list].sort((a, b) => {
        if (!a.appointmentAt) return b.appointmentAt ? 1 : 0;
        if (!b.appointmentAt) return -1;
        return new Date(a.appointmentAt).getTime() - new Date(b.appointmentAt).getTime();
    });
}

/** 7.3 내 방 목록. mock: 'empty' 면 빈 목록, 'error' 면 실패 (화면 확인용) */
export async function fetchMyRooms(mock?: 'empty' | 'error'): Promise<RoomSummary[]> {
    await wait(MOCK_DELAY_MS);
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '약속방 목록을 불러오지 못했어요.');
    if (mock === 'empty') return [];
    return sortRooms(rooms);
}

export function getMockRoom(roomId: string): RoomSummary | undefined {
    return rooms.find(room => room.id === roomId);
}

/** 방장이 볼 수 있는 초대 코드 (방 id → 코드, mock) */
const inviteCodes = new Map<string, string>([['room-1', 'K7Q2MX'], ['room-4', 'B8N3TD']]);

/** 초대 코드 mock 발급: 명세 부록 A ck_room_code '^[A-Z0-9]{6}$' 형식 */
function issueRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 헷갈리는 0·O·1·I 제외
    let code = '';
    do {
        code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    } while ([...inviteCodes.values()].includes(code) || code in JOINABLE || FULL_CODES.has(code));
    return code;
}

/** 7.9 초대 코드 조회 (OWNER 만). 방장이 아니면 undefined */
export async function fetchInviteCode(roomId: string): Promise<string | undefined> {
    await wait(MOCK_DELAY_MS);
    return getMockRoom(roomId)?.myRole === 'OWNER' ? inviteCodes.get(roomId) : undefined;
}

/**
 * 7.1 방 생성 (#43): 만든 사람이 방장(OWNER), 처음 인원 1명, 정원 4명 고정.
 * failForTest 가 true 면 실패를 흉내 냅니다(실패 상태 확인용).
 */
export async function createRoom(request: CreateRoomRequest, failForTest = false): Promise<CreatedRoom> {
    await wait(MOCK_DELAY_MS);
    if (failForTest) throw new RoomError('NETWORK_ERROR', '약속방을 만들지 못했어요. 잠시 후 다시 시도해 주세요.');
    const name = request.name.trim();
    const length = roomNameLength(name);
    if (length === 0) throw new RoomError('VALIDATION_ERROR', '약속방 이름을 입력해 주세요.');
    if (length > ROOM_NAME_MAX) throw new RoomError('VALIDATION_ERROR', `약속방 이름은 ${ROOM_NAME_MAX}자까지 쓸 수 있어요.`);

    const room: RoomSummary = {
        id: newId(),
        name,
        status: 'OPEN',
        myRole: 'OWNER',
        memberCount: 1,
        maxMembers: MAX_MEMBERS,
        appointmentAt: request.appointmentAt,
        selectedStation: null,
    };
    const roomCode = issueRoomCode();
    inviteCodes.set(room.id, roomCode);
    rooms = [...rooms, room];
    // 응답의 roomCode 는 생성자(방장)에게만 내려옵니다 (명세 7.1)
    return { ...room, roomCode, ownerId: 'me' };
}

/** 7.2 초대 코드로 참여. mock 코드: A3K9PZ(참여 가능), FULL44(정원 초과) */
export async function joinRoom(roomCode: string): Promise<{ roomId: string }> {
    await wait(MOCK_DELAY_MS);
    const code = roomCode.trim().toUpperCase();

    if (FULL_CODES.has(code)) throw new RoomError('ROOM_FULL', '정원(4명)이 다 찬 약속방이에요.');
    if (joinedCodes.has(code)) throw new RoomError('ALREADY_JOINED', '이미 참여 중인 약속방이에요.');
    const make = JOINABLE[code];
    if (!make) throw new RoomError('ROOM_CODE_INVALID', '초대 코드를 다시 확인해 주세요.');

    const room = make();
    joinedCodes.set(code, room.id);
    rooms = [...rooms, room];
    return { roomId: room.id };
}

/** 7.5 방 정보 수정 (OWNER) */
export async function updateRoom(
    roomId: string,
    patch: Partial<Pick<RoomSummary, 'name' | 'appointmentAt'>>,
): Promise<RoomSummary | undefined> {
    await wait(MOCK_DELAY_MS);
    rooms = rooms.map(room => (room.id === roomId ? { ...room, ...patch } : room));
    return getMockRoom(roomId);
}

/** 7.8 나가기: 목록에서 빠집니다 */
export async function leaveRoom(roomId: string): Promise<void> {
    await wait(MOCK_DELAY_MS);
    rooms = rooms.filter(room => room.id !== roomId);
    for (const [code, id] of joinedCodes) {
        if (id === roomId) joinedCodes.delete(code);
    }
}