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
    type RoomMember,
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

/** 내 mock 사용자 (services/user.ts mockUser 와 같은 사람) */
const ME = { userId: '0192f3a4-7b1c-7c3e-9a10-5d2e8f6b1a01', nickname: '민지' };

const STATION = {
    gangnam: { id: 105, name: '강남', isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
    hongdae: { id: 106, name: '홍대입구', isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
    jamsil: { id: 107, name: '잠실', isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
};

let memberSeq = 1;
function member(nickname: string, role: RoomMember['role'], departureStation: RoomMember['departureStation'], daysAgo = 1): RoomMember {
    const joinedAt = new Date();
    joinedAt.setDate(joinedAt.getDate() - daysAgo);
    return { userId: `user-${memberSeq++}`, nickname, role, joinedAt: joinedAt.toISOString(), departureStation };
}

/**
 * 초대 코드로만 들어갈 수 있는 mock 방 (아직 내가 참여하지 않은 방)
 * - A3K9PZ: 진행 중(OPEN) 방, 3/4명
 * - CFM7Q2: 약속역이 확정된(CONFIRMED) 방, 2/4명 → 명세 7.2 '방 상태와 무관하게 참여'
 * - FULL44: 정원(4명)이 찬 방
 * - BUSY99: 다른 요청을 처리 중인 방 (ROOM_BUSY 확인용, 다시 시도하면 참여됨)
 */
const INVITE_ONLY: Record<string, { room: RoomSummary; members: RoomMember[] }> = {
    A3K9PZ: {
        room: {
            id: 'room-11',
            name: '금요일 저녁',
            status: 'OPEN',
            myRole: 'MEMBER',
            memberCount: 3,
            maxMembers: MAX_MEMBERS,
            appointmentAt: daysFromToday(1, 19),
            selectedStation: null,
        },
        members: [
            member('선호', 'OWNER', STATION.gangnam, 3),
            member('지우', 'MEMBER', STATION.hongdae, 2),
            member('하은', 'MEMBER', null, 1),
        ],
    },
    CFM7Q2: {
        room: {
            id: 'room-12',
            name: '토요일 점심',
            status: 'CONFIRMED',
            myRole: 'MEMBER',
            memberCount: 2,
            maxMembers: MAX_MEMBERS,
            appointmentAt: daysFromToday(2, 12),
            selectedStation: { id: 105, name: '강남', lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
        },
        members: [member('도윤', 'OWNER', STATION.jamsil, 4), member('서연', 'MEMBER', STATION.gangnam, 2)],
    },
    FULL44: {
        room: {
            id: 'room-13',
            name: '동기 모임',
            status: 'OPEN',
            myRole: 'MEMBER',
            memberCount: 4,
            maxMembers: MAX_MEMBERS,
            appointmentAt: daysFromToday(4, 18),
            selectedStation: null,
        },
        members: [
            member('준호', 'OWNER', STATION.gangnam, 5),
            member('유나', 'MEMBER', null, 4),
            member('태오', 'MEMBER', STATION.jamsil, 3),
            member('나린', 'MEMBER', null, 2),
        ],
    },
    BUSY99: {
        room: {
            id: 'room-14',
            name: '스터디 모임',
            status: 'OPEN',
            myRole: 'MEMBER',
            memberCount: 1,
            maxMembers: MAX_MEMBERS,
            appointmentAt: null,
            selectedStation: null,
        },
        members: [member('시우', 'OWNER', null, 1)],
    },
};
const BUSY_ONCE = new Set(['BUSY99']);

/** 방 id → 멤버 목록 (참여 결과를 멤버 목록에 반영) */
const membersByRoom = new Map<string, RoomMember[]>();

/** 초대 코드 → 방 id (내가 이미 들어가 있는 방 포함, ALREADY_JOINED 판단용) */
const codeToRoomId = new Map<string, string>([
    ['K7Q2MX', 'room-1'],
    ['B8N3TD', 'room-4'],
]);

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
    } while (codeToRoomId.has(code) || code in INVITE_ONLY);
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
    codeToRoomId.set(roomCode, room.id);
    membersByRoom.set(room.id, [{ ...ME, role: 'OWNER', joinedAt: new Date().toISOString(), departureStation: null }]);
    rooms = [...rooms, room];
    // 응답의 roomCode 는 생성자(방장)에게만 내려옵니다 (명세 7.1)
    return { ...room, roomCode, ownerId: 'me' };
}

/** 초대 코드 정규화: 앞뒤 공백 제거 + 대문자 (명세 부록 A ck_room_code '^[A-Z0-9]{6}$') */
export function normalizeRoomCode(value: string) {
    return value.trim().toUpperCase();
}

/** 초대 코드 형식 검사: 영문 대문자·숫자 6자리 */
export function isValidRoomCode(code: string) {
    return /^[A-Z0-9]{6}$/.test(code);
}

/**
 * 7.2 초대 코드로 참여 (#44)
 * - 신규 참여자는 MEMBER, 출발역 없음(null)
 * - 방장 포함 4명이면 ROOM_FULL, 이미 참여한 방이면 ALREADY_JOINED (409 를 성공으로 바꾸지 않음)
 * - 없는 코드 ROOM_CODE_INVALID(404), 다른 요청 처리 중 ROOM_BUSY(409)
 * - 성공하면 방 목록과 멤버 목록에 반영하고 roomId 를 돌려줍니다.
 */
export async function joinRoom(roomCode: string): Promise<{ roomId: string }> {
    await wait(MOCK_DELAY_MS);
    const code = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(code)) throw new RoomError('VALIDATION_ERROR', '초대 코드는 영문과 숫자 6자리예요.');

    const joinedRoomId = codeToRoomId.get(code);
    if (joinedRoomId && getMockRoom(joinedRoomId)) {
        throw new RoomError('ALREADY_JOINED', '이미 참여 중인 약속방이에요.');
    }

    const target = INVITE_ONLY[code];
    if (!target) throw new RoomError('ROOM_CODE_INVALID', '없는 초대 코드예요. 코드를 다시 확인해 주세요.');

    if (BUSY_ONCE.has(code)) {
        BUSY_ONCE.delete(code); // 다시 시도하면 참여되도록
        throw new RoomError('ROOM_BUSY', '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.');
    }

    const members = membersByRoom.get(target.room.id) ?? target.members;
    if (members.length >= target.room.maxMembers) {
        throw new RoomError('ROOM_FULL', `정원(${target.room.maxMembers}명)이 다 찬 약속방이에요.`);
    }

    const nextMembers: RoomMember[] = [
        ...members,
        { ...ME, role: 'MEMBER', joinedAt: new Date().toISOString(), departureStation: null },
    ];
    membersByRoom.set(target.room.id, nextMembers);
    codeToRoomId.set(code, target.room.id);
    rooms = [...rooms, { ...target.room, myRole: 'MEMBER', memberCount: nextMembers.length }];
    return { roomId: target.room.id };
}

/** 7.6 멤버 목록 (mock). 목록을 모르는 기존 mock 방은 빈 배열 */
export async function fetchRoomMembers(roomId: string): Promise<RoomMember[]> {
    await wait(MOCK_DELAY_MS);
    return membersByRoom.get(roomId) ?? [];
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
    // 나간 방은 같은 코드로 다시 참여할 수 있도록 내 멤버 정보를 지웁니다.
    const members = membersByRoom.get(roomId);
    if (members) membersByRoom.set(roomId, members.filter(item => item.userId !== ME.userId));
}