/**
 * 약속방 서비스 (#42, API 명세 v1.12 7.1~7.3, 7.5, 7.8)
 *
 * TODO: 백엔드 연동 시 아래 API 호출로 교체합니다.
 * - GET    /rooms                    내 방 목록
 * - POST   /rooms                    방 생성 { name, appointmentAt } (정원 4명 고정)
 * - POST   /rooms/join               초대 코드로 참여 { roomCode }
 * - GET    /rooms/{roomId}           방 상세 (7.4, 초대 코드 미포함)
 * - PATCH  /rooms/{roomId}           방 정보 수정 (OWNER)
 * - PATCH  /rooms/{roomId}/members/me  내 출발역 설정/변경 (7.7, #48)
 * - DELETE /rooms/{roomId}/members/me  나가기 (7.8)
 * - GET    /rooms/{roomId}/invite-code  초대 코드 (7.9, OWNER, #47)
 * - PUT    /rooms/{roomId}/selected-station  약속역 확정 (7.10, OWNER)
 * - DELETE /rooms/{roomId}/selected-station  약속역 해제 (7.11, OWNER, 후보는 유지)
 * - POST   /rooms/{roomId}/station-proposals                     후보 제안 (7.14, #50)
 * - GET    /rooms/{roomId}/station-proposals                     후보 목록·득표 (7.15, #50)
 * - DELETE /rooms/{roomId}/station-proposals/{proposalId}        후보 삭제 (7.16, 제안자 또는 OWNER, #50)
 * - PUT    /rooms/{roomId}/station-proposals/{proposalId}/vote   참고용 투표 (7.17, 1인 1표, #50)
 *
 * 지금은 앱이 켜져 있는 동안만 유지되는 mock 목록으로 생성·참여·수정·나가기 결과를 반영합니다.
 */

import { MOCK_STATIONS } from '@/app/station-search';
import {
    RoomError,
    type CreateRoomRequest,
    type CreatedRoom,
    type LeaveRoomResult,
    type ProposalVoteResult,
    type RoomDetail,
    type RoomMember,
    type RoomStation,
    type RoomSummary,
    type StationProposal,
    type StationProposalList,
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
    hongdae: { id: 112, name: '홍대입구', isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
    jamsil: { id: 118, name: '잠실', isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }, { lineId: 8, lineName: '8호선', color: '#E6186C' }] },
    kondae: { id: 114, name: '건대입구', isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }, { lineId: 7, lineName: '7호선', color: '#747F00' }] },
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

function meAs(role: RoomMember['role'], departureStation: RoomMember['departureStation'], daysAgo: number): RoomMember {
    const joinedAt = new Date();
    joinedAt.setDate(joinedAt.getDate() - daysAgo);
    return { ...ME, role, joinedAt: joinedAt.toISOString(), departureStation };
}

/** 방 id → 멤버 목록 (참여 결과를 멤버 목록에 반영). 목록 mock 방(room-1~4)도 인원 수에 맞춰 채워 둡니다. */
const membersByRoom = new Map<string, RoomMember[]>([
    ['room-1', [
        meAs('OWNER', STATION.hongdae, 10),
        member('선호', 'MEMBER', STATION.gangnam, 9),
        member('지우', 'MEMBER', STATION.jamsil, 8),
        member('하은', 'MEMBER', null, 7),
    ]],
    ['room-2', [
        member('선호', 'OWNER', STATION.gangnam, 6),
        meAs('MEMBER', STATION.hongdae, 5),
        member('준호', 'MEMBER', STATION.kondae, 4),
    ]],
    ['room-4', [meAs('OWNER', null, 3), member('유나', 'MEMBER', STATION.jamsil, 2)]],
    ['room-3', [member('도윤', 'OWNER', STATION.gangnam, 3), meAs('MEMBER', null, 2)]],
]);
const ownerOf = (members: RoomMember[]) => members.find(item => item.role === 'OWNER');

/**
 * 방 id → 약속역 후보 (mock)
 * 투표는 후보마다 투표한 userId 목록(voterIds)으로 들고 있어요. 후보를 지우면 그 표도 함께 사라집니다 (명세 7.17 cascade)
 */
type StoredProposal = Omit<StationProposal, 'isSelected' | 'voteCount' | 'votedByMe'> & { voterIds: string[] };

/** 방당 후보 최대 개수 (명세 7.14 기본 9, 서버 설정값) */
const MAX_PROPOSALS = 9;

function stationRef(stationId: number): RoomStation {
    const found = MOCK_STATIONS.find(item => item.id === stationId);
    if (!found) return { id: stationId, name: `역 ${stationId}` };
    return { id: found.id, name: found.name, lines: found.lines.map(({ lineId, lineName, color }) => ({ lineId, lineName, color })) };
}

let proposalSeq = 1;
function seedProposal(roomId: string, stationId: number, proposer: string, voters: string[], minutesAgo: number): StoredProposal {
    const members = membersByRoom.get(roomId) ?? [];
    const userOf = (nickname: string) => members.find(item => item.nickname === nickname)?.userId ?? `user-${nickname}`;
    return {
        id: `proposal-${proposalSeq++}`,
        station: stationRef(stationId),
        proposedBy: { userId: userOf(proposer), nickname: proposer },
        resultId: null,
        createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        voterIds: voters.map(userOf),
    };
}

const proposalsByRoom = new Map<string, StoredProposal[]>([
    // room-2: 나는 MEMBER (설계서 그림 39). 준호가 제안한 건대입구에 2표, 내가 제안한 뚝섬은 내가 지울 수 있어요
    ['room-2', [
        seedProposal('room-2', 116, ME.nickname, [], 20),
        seedProposal('room-2', 115, '선호', [], 40),
        seedProposal('room-2', 114, '준호', ['선호', '준호'], 90),
    ]],
    // room-4: 나는 OWNER (설계서 그림 38). 모든 후보를 지울 수 있어요
    ['room-4', [
        seedProposal('room-4', 109, ME.nickname, [], 30),
        seedProposal('room-4', 119, '유나', ['유나'], 60),
    ]],
    ['room-3', [seedProposal('room-3', 105, '도윤', ['도윤'], 45)]],
]);

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

/** 멤버 목록 동기 조회 (추천 mock 이 isStale 판정·출발역 검사에 씀, #49) */
export function getMockMembers(roomId: string): RoomMember[] {
    return membersByRoom.get(roomId) ?? [];
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

/** 초대 코드 조회 실패를 흉내 내는 방 (mock, #47 화면 확인용). 한 번 실패한 뒤 다시 시도하면 성공합니다. */
const inviteFailOnce = new Set<string>();

/**
 * 7.9 GET /rooms/{roomId}/invite-code (OWNER, #47)
 * - 응답은 { roomCode } (명세 7.9). 방 목록(7.3)·상세(7.4) 응답에는 코드가 없고 이 API 로만 받습니다.
 * - 현재 OWNER(meeting_members.role) 기준입니다. 최초 생성자(created_by)여도 방장이 위임됐으면 NOT_ROOM_OWNER(403)
 * - 없는 방 ROOM_NOT_FOUND(404), 참여하지 않은 방 NOT_ROOM_MEMBER(403)
 * mock: 'error' 면 한 번 NETWORK_ERROR (다시 시도하면 성공)
 * TODO: 실제 연동 시 GET /rooms/{roomId}/invite-code 호출로 교체
 */
export async function fetchInviteCode(roomId: string, mock?: 'error'): Promise<{ roomCode: string }> {
    await wait(MOCK_DELAY_MS);
    if (mock) inviteFailOnce.add(roomId);

    const room = getMockRoom(roomId);
    if (!room) {
        const invited = Object.values(INVITE_ONLY).some(item => item.room.id === roomId);
        if (invited) throw new RoomError('NOT_ROOM_MEMBER', '참여하지 않은 약속방이에요.');
        throw new RoomError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
    }
    if (room.myRole !== 'OWNER') throw new RoomError('NOT_ROOM_OWNER', '초대 코드는 방장만 볼 수 있어요.');

    if (inviteFailOnce.has(roomId)) {
        inviteFailOnce.delete(roomId); // 다시 시도하면 성공하도록
        throw new RoomError('NETWORK_ERROR', '초대 코드를 불러오지 못했어요.');
    }

    let roomCode = inviteCodes.get(roomId);
    if (!roomCode) {
        // 초대 코드로 들어간 방의 코드는 INVITE_ONLY 의 키입니다 (방장이 위임된 경우 대비)
        roomCode = Object.entries(INVITE_ONLY).find(([, item]) => item.room.id === roomId)?.[0] ?? issueRoomCode();
        inviteCodes.set(roomId, roomCode);
    }
    return { roomCode };
}

/**
 * 방장 변경 mock (#47 화면 확인용). 실제로는 7.8 나가기 승계나 회원 탈퇴로만 바뀝니다.
 * - 'give'  : 내가 방장인 방에서 가장 먼저 들어온 다른 멤버에게 방장을 넘기고 나는 MEMBER 가 됩니다
 * - 'take'  : 내가 멤버인 방에서 내가 방장이 되고 기존 방장은 MEMBER 가 됩니다
 * 바뀐 역할은 7.4 상세(myRole)·7.9 초대 코드 조회에 바로 반영됩니다.
 */
export function mockTransferOwner(roomId: string, direction: 'give' | 'take') {
    const room = getMockRoom(roomId);
    const members = membersByRoom.get(roomId);
    if (!room || !members) return;
    const iAmOwner = room.myRole === 'OWNER';
    if ((direction === 'give' && !iAmOwner) || (direction === 'take' && iAmOwner)) return;

    const sorted = [...members].sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
    const nextOwnerId = direction === 'take' ? ME.userId : sorted.find(item => item.userId !== ME.userId)?.userId;
    if (!nextOwnerId) return;

    membersByRoom.set(roomId, members.map(item => ({ ...item, role: item.userId === nextOwnerId ? 'OWNER' : 'MEMBER' })));
    rooms = rooms.map(item => (item.id === roomId ? { ...item, myRole: nextOwnerId === ME.userId ? 'OWNER' : 'MEMBER' } : item));
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

/** 출발역 변경 실패를 흉내 내는 방 (mock, #48 화면 확인용). 한 번 실패한 뒤 다시 시도하면 성공합니다. */
const departureFailOnce = new Map<string, 'error' | 'unsupported'>();

export type UpdateMyDepartureRequest = {
    /** 7.7 요청 본문 { departureStationId } — 역 검색 화면(5.2)에서 고른 역의 id */
    departureStationId: number;
};

/**
 * 7.7 PATCH /rooms/{roomId}/members/me (멤버, #48)
 * - OWNER·MEMBER 모두 **본인** 출발역만 설정/변경합니다. 다른 멤버 출발역은 건드리지 않아요.
 * - 없는 역 STATION_NOT_FOUND(404), isSupported=false(미제공) STATION_UNSUPPORTED(422), 참여하지 않은 방 NOT_ROOM_MEMBER(403)
 * - 실패하면 기존 출발역을 그대로 둡니다. 명세에 출발역 해제(null) API 는 없어요.
 * - 성공하면 바뀐 내 멤버 정보를 돌려주고, 7.4 상세·7.6 멤버 목록 mock 에 바로 반영됩니다.
 *   TODO: 실제 연동 시 WS DEPARTURE_UPDATED 수신 → 7.6 재조회·8.2 재조회(isStale) (이번 범위 밖)
 * mock: 'error' 면 한 번 NETWORK_ERROR, 'unsupported' 면 한 번 STATION_UNSUPPORTED (다시 시도하면 성공)
 */
export async function updateMyDeparture(
    roomId: string,
    request: UpdateMyDepartureRequest,
    mock?: 'error' | 'unsupported',
): Promise<RoomMember> {
    await wait(MOCK_DELAY_MS);
    if (mock) departureFailOnce.set(roomId, mock);

    const room = getMockRoom(roomId);
    const members = membersByRoom.get(roomId);
    if (!room || !members) throw new RoomError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
    const meIndex = members.findIndex(item => item.userId === ME.userId);
    if (meIndex < 0) throw new RoomError('NOT_ROOM_MEMBER', '참여하지 않은 약속방이에요.');

    const station = MOCK_STATIONS.find(item => item.id === request.departureStationId);
    if (!station) throw new RoomError('STATION_NOT_FOUND', '선택한 역을 찾을 수 없어요.');

    const failure = departureFailOnce.get(roomId);
    if (failure) departureFailOnce.delete(roomId); // 다시 시도하면 성공하도록

    if (!station.isSupported || failure === 'unsupported') {
        throw new RoomError('STATION_UNSUPPORTED', `${station.name}역은 아직 경로·혼잡도 데이터가 제공되지 않아 출발역으로 설정할 수 없어요.`);
    }
    if (failure === 'error') throw new RoomError('NETWORK_ERROR', '출발역을 저장하지 못했어요. 다시 시도해 주세요.');

    const updated: RoomMember = {
        ...members[meIndex],
        departureStation: {
            id: station.id,
            name: station.name,
            isSupported: station.isSupported,
            lines: station.lines.map(line => ({ lineId: line.lineId, lineName: line.lineName, color: line.color })),
        },
    };
    const next = [...members];
    next[meIndex] = updated;
    membersByRoom.set(roomId, next);
    return updated;
}

/** 확정 시각 (mock): 처음부터 확정돼 있던 방은 하루 전으로 둡니다 */
const confirmedAtByRoom = new Map<string, string>();

/**
 * 7.4 방 상세 (#45)
 * - 없는 방 ROOM_NOT_FOUND(404), 참여하지 않은 방 NOT_ROOM_MEMBER(403)
 * - 초대 코드는 포함하지 않습니다 (방장은 7.9 fetchInviteCode 로 따로 조회)
 * mock: 'error' 면 조회 실패 (화면 확인용)
 */
export async function fetchRoomDetail(roomId: string, mock?: 'error'): Promise<RoomDetail> {
    await wait(MOCK_DELAY_MS);
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '약속방 정보를 불러오지 못했어요.');
    const room = getMockRoom(roomId);
    if (!room) {
        const invited = Object.values(INVITE_ONLY).some(item => item.room.id === roomId);
        if (invited) throw new RoomError('NOT_ROOM_MEMBER', '참여하지 않은 약속방이에요.');
        throw new RoomError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
    }
    const members = membersByRoom.get(roomId) ?? [];
    const confirmedAt = room.selectedStation
        ? confirmedAtByRoom.get(roomId) ?? new Date(Date.now() - 86_400_000).toISOString()
        : null;
    return {
        ...room,
        memberCount: members.length || room.memberCount,
        ownerId: ownerOf(members)?.userId ?? ME.userId,
        confirmedAt,
        members,
    };
}

export function getMyUserId() {
    return ME.userId;
}

function requireOwner(roomId: string) {
    const room = getMockRoom(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
    if (room.myRole !== 'OWNER') throw new RoomError('NOT_ROOM_OWNER', '방장만 할 수 있어요.');
    return room;
}

/** 7.5 PATCH /rooms/{roomId} 요청: 모든 필드 선택. 생략하면 유지, appointmentAt null 은 해제 */
export type UpdateRoomPatch = {
    name?: string;
    appointmentAt?: string | null;
};

/** 수정 요청 실패를 흉내 내는 방 (mock, 화면 확인용). 한 번 실패한 뒤 다시 시도하면 성공합니다. */
const updateFailOnce = new Map<string, 'error' | 'busy'>();

/**
 * 7.5 방 정보 수정 (OWNER, #46)
 * - 수정할 수 있는 필드는 name·appointmentAt 뿐 (정원 4명 고정, 명세 7.5)
 * - 생략한 필드는 그대로 두고, appointmentAt: null 은 약속 시각 해제로 처리합니다
 *   (명세 7.5 "모든 필드 선택". TODO: 백엔드와 null = 해제인지 확인)
 * - 이름은 앞뒤 공백 제거 후 1~30자 (명세 부록 A ck_room_name), 아니면 VALIDATION_ERROR(400)
 * - 방장이 아니면 NOT_ROOM_OWNER(403), 없는 방 ROOM_NOT_FOUND(404), 락 대기 초과 ROOM_BUSY(409, 7.12)
 * - 약속 시각을 바꿔도 추천을 새로 만들지 않고 기존 추천·후보·확정 약속역은 그대로 둡니다 (명세 7.5).
 *   TODO: 실제 연동 시 WS ROOM_UPDATED 수신 → 8.2 재조회로 isStale 갱신 (이번 범위 밖)
 * mock: 'error' 면 한 번 NETWORK_ERROR, 'busy' 면 한 번 ROOM_BUSY (다시 시도하면 성공)
 */
export async function updateRoom(
    roomId: string,
    patch: UpdateRoomPatch,
    mock?: 'error' | 'busy',
): Promise<RoomSummary> {
    await wait(MOCK_DELAY_MS);
    if (mock) updateFailOnce.set(roomId, mock);

    const room = requireOwner(roomId);

    const next: UpdateRoomPatch = {};
    if (patch.name !== undefined) {
        const length = roomNameLength(patch.name);
        if (length === 0) throw new RoomError('VALIDATION_ERROR', '약속방 이름을 입력해 주세요.');
        if (length > ROOM_NAME_MAX) throw new RoomError('VALIDATION_ERROR', `약속방 이름은 ${ROOM_NAME_MAX}자까지 쓸 수 있어요.`);
        next.name = patch.name.trim();
    }
    if (patch.appointmentAt !== undefined) {
        if (patch.appointmentAt !== null && Number.isNaN(new Date(patch.appointmentAt).getTime())) {
            throw new RoomError('VALIDATION_ERROR', '약속 시각 형식이 올바르지 않아요.');
        }
        next.appointmentAt = patch.appointmentAt;
    }

    const failure = updateFailOnce.get(roomId);
    if (failure) {
        updateFailOnce.delete(roomId); // 다시 시도하면 성공하도록
        if (failure === 'busy') throw new RoomError('ROOM_BUSY', '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.');
        throw new RoomError('NETWORK_ERROR', '변경 내용을 저장하지 못했어요. 다시 시도해 주세요.');
    }

    // 바꾸지 않은 필드(selectedStation·status·memberCount 등)는 그대로 유지합니다
    const updated: RoomSummary = { ...room, ...next };
    rooms = rooms.map(item => (item.id === roomId ? updated : item));
    return updated;
}

/** 7.10 약속역 확정 / 7.11 해제 (OWNER). 해제해도 후보 목록은 그대로 둡니다. */
export async function setSelectedStation(roomId: string, station: RoomStation | null): Promise<void> {
    await wait(MOCK_DELAY_MS);
    requireOwner(roomId);
    if (station) confirmedAtByRoom.set(roomId, new Date().toISOString());
    else confirmedAtByRoom.delete(roomId);
    rooms = rooms.map(room =>
        room.id === roomId
            ? { ...room, selectedStation: station, status: station ? 'CONFIRMED' : 'OPEN' }
            : room,
    );
}

/* ───────────────── 약속역 후보 · 투표 (7.14~7.17, #50) ───────────────── */

function requireMember(roomId: string) {
    const room = getMockRoom(roomId);
    if (!room) throw new RoomError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
    return room;
}

function toProposal(roomId: string, stored: StoredProposal): StationProposal {
    const { voterIds, ...rest } = stored;
    const selected = getMockRoom(roomId)?.selectedStation ?? null;
    return {
        ...rest,
        isSelected: selected?.id === stored.station.id,
        voteCount: voterIds.length,
        votedByMe: voterIds.includes(ME.userId),
    };
}

/** 7.15 후보 목록 (최신 제안 순). 득표순 정렬은 화면에서 해요 */
export async function fetchProposals(roomId: string, mock?: 'error'): Promise<StationProposalList> {
    await wait(MOCK_DELAY_MS / 2);
    const room = requireMember(roomId);
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '네트워크 상태를 확인하고 다시 시도해 주세요.');
    const items = [...(proposalsByRoom.get(roomId) ?? [])]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map(item => toProposal(roomId, item));
    return { selectedStation: room.selectedStation, maxProposals: MAX_PROPOSALS, items };
}

/**
 * 7.14 후보 제안 (모든 멤버)
 * - resultId: 추천 결과 카드에서 제안한 경우 그 결과의 resultId, 직접 제안이면 생략 (TODO: 서버가 RESULT_NOT_FOUND 검증)
 * - 같은 역 중복 ALREADY_PROPOSED(409), 미제공 역 STATION_UNSUPPORTED(422), 9개 초과 PROPOSAL_LIMIT_EXCEEDED(422)
 */
export async function createProposal(
    roomId: string,
    stationId: number,
    resultId?: string,
    mock?: 'error' | 'busy',
): Promise<StationProposal> {
    await wait(MOCK_DELAY_MS / 2);
    requireMember(roomId);
    if (mock === 'busy') throw new RoomError('ROOM_BUSY', '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.');
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '후보를 제안하지 못했어요. 다시 시도해 주세요.');
    const station = MOCK_STATIONS.find(item => item.id === stationId);
    if (!station) throw new RoomError('STATION_NOT_FOUND', '역을 찾을 수 없어요.');
    if (!station.isSupported) throw new RoomError('STATION_UNSUPPORTED', `${station.name}역은 아직 지원하지 않는 역이라 후보로 올릴 수 없어요.`);
    const list = proposalsByRoom.get(roomId) ?? [];
    if (list.some(item => item.station.id === stationId)) throw new RoomError('ALREADY_PROPOSED', `${station.name}역은 이미 후보에 있어요.`);
    if (list.length >= MAX_PROPOSALS) throw new RoomError('PROPOSAL_LIMIT_EXCEEDED', `약속역 후보는 방당 ${MAX_PROPOSALS}개까지예요. 다른 후보를 지운 뒤 제안해 주세요.`);
    const stored: StoredProposal = {
        id: `proposal-${proposalSeq++}`,
        station: stationRef(stationId),
        proposedBy: { userId: ME.userId, nickname: ME.nickname },
        resultId: resultId ?? null,
        createdAt: new Date().toISOString(),
        voterIds: [],
    };
    proposalsByRoom.set(roomId, [...list, stored]);
    return toProposal(roomId, stored);
}

/**
 * 7.17 참고용 투표 (모든 멤버, 본인 제안 후보도 가능)
 * 같은 후보에 다시 투표하면 상태 그대로 200(멱등), 다른 후보에 투표하면 ALREADY_VOTED(409)
 */
export async function voteProposal(roomId: string, proposalId: string, mock?: 'error'): Promise<ProposalVoteResult> {
    await wait(MOCK_DELAY_MS / 2);
    requireMember(roomId);
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '투표하지 못했어요. 다시 시도해 주세요.');
    const list = proposalsByRoom.get(roomId) ?? [];
    const target = list.find(item => item.id === proposalId);
    if (!target) throw new RoomError('PROPOSAL_NOT_FOUND', '이미 삭제된 후보예요.');
    if (!target.voterIds.includes(ME.userId)) {
        if (list.some(item => item.voterIds.includes(ME.userId))) {
            throw new RoomError('ALREADY_VOTED', '이미 다른 후보에 투표했어요. 투표는 바꾸거나 취소할 수 없어요.');
        }
        target.voterIds = [...target.voterIds, ME.userId];
    }
    return { proposalId, voteCount: target.voterIds.length, votedByMe: true };
}

/** 7.16 후보 삭제 (제안자 본인 또는 OWNER). 그 후보의 표도 함께 사라지고, 확정된 약속역은 바뀌지 않아요 */
export async function deleteProposal(roomId: string, proposalId: string): Promise<void> {
    await wait(MOCK_DELAY_MS / 2);
    const room = requireMember(roomId);
    const list = proposalsByRoom.get(roomId) ?? [];
    const target = list.find(item => item.id === proposalId);
    if (!target) throw new RoomError('PROPOSAL_NOT_FOUND', '이미 삭제된 후보예요.');
    if (target.proposedBy.userId !== ME.userId && room.myRole !== 'OWNER') {
        throw new RoomError('NOT_PROPOSAL_OWNER', '후보를 제안한 사람이나 방장만 지울 수 있어요.');
    }
    proposalsByRoom.set(roomId, list.filter(item => item.id !== proposalId));
}

/** 화면 확인용(?mock=proposals-full): 다른 멤버가 제안한 후보로 9개를 채워요 */
export function mockFillProposals(roomId: string) {
    const list = proposalsByRoom.get(roomId) ?? [];
    const other = (membersByRoom.get(roomId) ?? []).find(item => item.userId !== ME.userId);
    const free = MOCK_STATIONS.filter(item => item.isSupported && !list.some(p => p.station.id === item.id));
    const added = free.slice(0, Math.max(0, MAX_PROPOSALS - list.length)).map((station, index) => ({
        id: `proposal-${proposalSeq++}`,
        station: stationRef(station.id),
        proposedBy: { userId: other?.userId ?? 'user-x', nickname: other?.nickname ?? '멤버' },
        resultId: null,
        createdAt: new Date(Date.now() - (120 + index) * 60_000).toISOString(),
        voterIds: [],
    }));
    proposalsByRoom.set(roomId, [...list, ...added]);
}

/**
 * 7.8 나가기
 * - 방장이 나가면 가장 먼저 들어온(joinedAt) 멤버가 방장이 됩니다.
 * - 마지막 멤버가 나가면 방이 삭제됩니다.
 */
export async function leaveRoom(roomId: string): Promise<LeaveRoomResult> {
    await wait(MOCK_DELAY_MS);
    rooms = rooms.filter(room => room.id !== roomId);
    // 나간 방은 같은 코드로 다시 참여할 수 있도록 내 멤버 정보를 지웁니다.
    const members = membersByRoom.get(roomId) ?? [];
    const wasOwner = ownerOf(members)?.userId === ME.userId;
    const rest = members
        .filter(item => item.userId !== ME.userId)
        .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());

    if (rest.length === 0) {
        membersByRoom.delete(roomId);
        proposalsByRoom.delete(roomId);
        return { roomDeleted: true, newOwnerId: null };
    }
    let newOwnerId: string | null = null;
    if (wasOwner) {
        newOwnerId = rest[0].userId;
        rest[0] = { ...rest[0], role: 'OWNER' };
    }
    membersByRoom.set(roomId, rest);
    // 나간 멤버의 투표는 함께 삭제돼요 (7.17 cascade). 내가 제안한 후보는 그대로 남아요 (7.14)
    for (const item of proposalsByRoom.get(roomId) ?? []) item.voterIds = item.voterIds.filter(id => id !== ME.userId);
    return { roomDeleted: false, newOwnerId };
}

/** 나가기 확인 문구용: 내가 나가면 누가 방장이 되는지, 방이 삭제되는지 */
export function previewLeave(detail: RoomDetail) {
    const rest = detail.members
        .filter(item => item.userId !== ME.userId)
        .sort((a, b) => new Date(a.joinedAt).getTime() - new Date(b.joinedAt).getTime());
    return {
        willDelete: rest.length === 0,
        nextOwner: detail.myRole === 'OWNER' ? rest[0]?.nickname ?? null : null,
    };
}