/**
 * 약속방 서비스 (#42, API 명세 v1.12 7.1~7.3, 7.5, 7.8)
 *
 * #94·#97: 7.1 생성·7.2 참여·7.3 목록·7.4 상세·7.6 멤버 조회는 서버 모드를 지원해요.
 * TODO: 나머지 API는 기존 mock을 유지하고 후속 이슈에서 연동해요.
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
 * mock 모드는 앱 실행 중의 메모리 목록에 결과를 반영해요. 서버 생성·참여는 실제 응답을 공용 캐시에 반영해요.
 */

import { MOCK_STATIONS } from '@/mocks/stations';
import { useMock as isMockMode } from '@/services/api/config';
import { fetchStation } from '@/services/station';
import { getSession } from '@/stores/auth-store';
import { createServerRoom, joinServerRoom, fetchServerRoomDetail, fetchServerRoomMembers, fetchServerRooms } from '@/services/room-query';
import { createServerProposal, deleteServerProposal, fetchServerProposals, voteServerProposal } from '@/services/room-proposals';
import { assertRoomCacheScope, getRoomCacheScope, readCachedMembers, readCachedRoom, readCachedRoomCode, subscribeRoomCacheReset } from '@/services/room-cache';
import { emitRoomMockChange } from '@/stores/room-mock-events';
import {
    RoomError,
    type CreateRoomRequest,
    type CreatedRoom,
    type LeaveRoomResult,
    type LeaveRoomMock,
    type LeaveRoomScenario,
    type ProposalVoteResult,
    type RoomDetail,
    type RoomMember,
    type RoomStation,
    type RoomSummary,
    type SelectedStationMock,
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
            isSupported: true,
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
            isSupported: true,
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
            selectedStation: { id: 105, name: '강남', isSupported: true, lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
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
    if (!found) return { id: stationId, name: `역 ${stationId}`, isSupported: false, lines: [] };
    return { id: found.id, name: found.name, isSupported: found.isSupported, lines: found.lines.map(({ lineId, lineName, color }) => ({ lineId, lineName, color })) };
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
    if (!isMockMode()) return sortRooms(await fetchServerRooms());
    await wait(MOCK_DELAY_MS);
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '약속방 목록을 불러오지 못했어요.');
    if (mock === 'empty') return [];
    return sortRooms(rooms);
}

export function getMockRoom(roomId: string): RoomSummary | undefined {
    if (!isMockMode()) return readCachedRoom(roomId);
    return rooms.find(room => room.id === roomId);
}

/** 멤버 목록 동기 조회 (추천 mock 이 isStale 판정·출발역 검사에 씀, #49) */
export function getMockMembers(roomId: string): RoomMember[] {
    if (!isMockMode()) return readCachedMembers(roomId);
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
    if (!isMockMode()) {
        const room = getMockRoom(roomId);
        if (!room) throw new RoomError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
        if (room.myRole !== 'OWNER') throw new RoomError('NOT_ROOM_OWNER', '초대 코드는 방장만 볼 수 있어요.');
        const roomCode = readCachedRoomCode(roomId);
        if (roomCode) return { roomCode };
        // TODO(#97 범위 밖, C-3): 7.9 조회 연동 전에는 가짜 코드를 발급하지 않아요.
        throw new RoomError('UNKNOWN_ERROR', '초대 코드 조회는 아직 준비 중이에요.');
    }
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
    if (!isMockMode()) {
        const name = typeof request?.name === 'string' ? request.name.trim() : '';
        if (roomNameLength(name) === 0) throw new RoomError('VALIDATION_ERROR', '약속방 이름을 입력해 주세요.');
        if (roomNameLength(name) > ROOM_NAME_MAX) throw new RoomError('VALIDATION_ERROR', `약속방 이름은 ${ROOM_NAME_MAX}자까지 쓸 수 있어요.`);
        return createServerRoom({ name, appointmentAt: request.appointmentAt });
    }
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
    if (!isMockMode()) {
        const code = typeof roomCode === 'string' ? normalizeRoomCode(roomCode) : '';
        if (!isValidRoomCode(code)) throw new RoomError('VALIDATION_ERROR', '초대 코드는 영문과 숫자 6자리예요.');
        return joinServerRoom(code);
    }
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

/** 7.6 멤버 목록. 나간 방과 참여하지 않은 방은 조회할 수 없어요. */
export async function fetchRoomMembers(
    roomId: string,
): Promise<RoomMember[]> {
    if (!isMockMode()) return fetchServerRoomMembers(roomId);
    await wait(MOCK_DELAY_MS);
    requireMember(roomId);

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

    requireMember(roomId);

    const members = membersByRoom.get(roomId);

    if (!members) {
        throw new RoomError(
            'ROOM_NOT_FOUND',
            '약속방을 찾을 수 없어요.',
        );
    }
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
    if (!isMockMode()) return fetchServerRoomDetail(roomId);
    await wait(MOCK_DELAY_MS);
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '약속방 정보를 불러오지 못했어요.');
    const room = getMockRoom(roomId);
    if (!room) {
        const invited = Object.values(INVITE_ONLY).some(item => item.room.id === roomId);
        if (invited) throw new RoomError('NOT_ROOM_MEMBER', '참여하지 않은 약속방이에요.');
        throw new RoomError('ROOM_NOT_FOUND', '약속방을 찾을 수 없어요.');
    }
    const members = membersByRoom.get(roomId) ?? [];
    // 초기 확정 시각은 한 번만 저장하고, 이후 조회에서도 유지해요.
    if (room.selectedStation && !confirmedAtByRoom.has(roomId)) {
        confirmedAtByRoom.set(
            roomId,
            new Date(Date.now() - 86_400_000).toISOString(),
        );
    }

    const confirmedAt = room.selectedStation
        ? confirmedAtByRoom.get(roomId)!
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
    return isMockMode() ? ME.userId : getSession()?.userId ?? '';
}

function requireOwner(roomId: string) {
    const room = requireMember(roomId);

    if (room.myRole !== 'OWNER') {
        throw new RoomError(
            'NOT_ROOM_OWNER',
            '방장만 할 수 있어요.',
        );
    }

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

/** 같은 방에서 약속역을 동시에 변경하지 않도록 막아요. */
const selectedStationInFlight = new Set<string>();

/**
 * #51 / API v1.12
 * 7.10 PUT /api/v1/rooms/{roomId}/selected-station { stationId }
 * 7.11 DELETE /api/v1/rooms/{roomId}/selected-station
 *
 * TODO: 실제 API로 교체해요. 기존 Promise<void> 반환 형태를 유지해요.
 * TODO: SELECTED_STATION_CHANGED·SYSTEM 메시지 연동은 이번 범위 밖이에요.
 *
 * 현재 OWNER 권한과 역의 지원 여부를 저장 직전에 확인해요.
 * 후보와 투표는 변경하지 않아요.
 * mock은 첫 요청에만 전달하고 재시도할 때는 생략해요.
 */
export async function setSelectedStation(
    roomId: string,
    station: RoomStation | null,
    mock?: SelectedStationMock,
): Promise<void> {
    if (selectedStationInFlight.has(roomId)) {
        throw new RoomError(
            'ROOM_BUSY',
            '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.',
        );
    }

    selectedStationInFlight.add(roomId);

    try {
        await wait(MOCK_DELAY_MS);

        const room = getMockRoom(roomId);

        if (!room) {
            const invited = Object.values(INVITE_ONLY).some(
                item => item.room.id === roomId,
            );

            throw new RoomError(
                invited ? 'NOT_ROOM_MEMBER' : 'ROOM_NOT_FOUND',
                invited
                    ? '참여하지 않은 약속방이에요.'
                    : '약속방을 찾을 수 없어요.',
            );
        }

        if (mock === 'owner-lost') {
            mockTransferOwner(roomId, 'give');
        }

        const me = membersByRoom
            .get(roomId)
            ?.find(item => item.userId === ME.userId);

        if (!me) {
            throw new RoomError(
                'NOT_ROOM_MEMBER',
                '참여하지 않은 약속방이에요.',
            );
        }

        if (me.role !== 'OWNER') {
            throw new RoomError(
                'NOT_ROOM_OWNER',
                '방장만 약속역을 정하거나 해제할 수 있어요.',
            );
        }

        let selected: RoomStation | null = null;

        if (station !== null) {
            const found = MOCK_STATIONS.find(item => item.id === station.id);

            if (!found || mock === 'missing') {
                throw new RoomError(
                    'STATION_NOT_FOUND',
                    '선택한 역을 찾을 수 없어요. 역을 다시 선택해 주세요.',
                );
            }

            if (!found.isSupported || mock === 'unsupported') {
                throw new RoomError(
                    'STATION_UNSUPPORTED',
                    '이 역은 아직 약속역으로 정할 수 없어요. 다른 지원 역을 선택해 주세요.',
                );
            }

            // 이름과 노선은 공통 역 데이터를 기준으로 저장해요.
            selected = {
                id: found.id,
                name: found.name,
                isSupported: found.isSupported,
                lines: found.lines.map(line => ({
                    lineId: line.lineId,
                    lineName: line.lineName,
                    color: line.color,
                })),
            };
        }

        if (mock === 'busy') {
            throw new RoomError(
                'ROOM_BUSY',
                '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.',
            );
        }

        if (selected) {
            confirmedAtByRoom.set(roomId, new Date().toISOString());
        } else {
            confirmedAtByRoom.delete(roomId);
        }

        rooms = rooms.map(item =>
            item.id === roomId
                ? {
                    ...item,
                    selectedStation: selected,
                    status: selected ? 'CONFIRMED' : 'OPEN',
                }
                : item,
        );
    } finally {
        selectedStationInFlight.delete(roomId);
    }
}
/* ───────────────── 약속역 후보 · 투표 (7.14~7.17, #50) ───────────────── */

function requireMember(roomId: string) {
    const room = getMockRoom(roomId);

    if (!room) {
        const exists = Object.values(INVITE_ONLY).some(
            item => item.room.id === roomId,
        );

        throw new RoomError(
            exists ? 'NOT_ROOM_MEMBER' : 'ROOM_NOT_FOUND',
            exists
                ? '참여하지 않은 약속방이에요.'
                : '약속방을 찾을 수 없어요.',
        );
    }

    if (
        !getMockMembers(roomId).some(item => item.userId === getMyUserId())
    ) {
        throw new RoomError(
            'NOT_ROOM_MEMBER',
            '참여하지 않은 약속방이에요.',
        );
    }

    return room;
}

function toProposal(roomId: string, stored: StoredProposal): StationProposal {
    const { voterIds, ...rest } = stored;
    const selected = getMockRoom(roomId)?.selectedStation ?? null;
    return {
        ...rest,
        isSelected: selected?.id === stored.station.id,
        voteCount: voterIds.length,
        votedByMe: voterIds.includes(getMyUserId()),
    };
}

/** 7.15 후보 목록 (최신 제안 순). 득표순 정렬은 화면에서 해요. 서버 모드는 services/room-proposals.ts (#101), mock 인자는 무시해요 */
export async function fetchProposals(roomId: string, mock?: 'error'): Promise<StationProposalList> {
    if (!isMockMode()) return fetchServerProposals(roomId);
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
 * - resultId: 추천 결과 카드(주변 대안역 포함)에서 제안한 경우 그 결과의 resultId, 직접 제안이면 생략 (서버가 RESULT_NOT_FOUND 검증)
 * - 같은 역 중복 ALREADY_PROPOSED(409), 미제공 역 STATION_UNSUPPORTED(422), 9개 초과 PROPOSAL_LIMIT_EXCEEDED(422)
 * - 서버 모드는 services/room-proposals.ts (#101): 역 확인은 서버가 하고 mock 인자는 무시해요
 */
export async function createProposal(
    roomId: string,
    stationId: number,
    resultId?: string,
    mock?: 'error' | 'busy',
): Promise<StationProposal> {
    if (!isMockMode()) return createServerProposal(roomId, stationId, resultId);
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
        station: { id: station.id, name: station.name, isSupported: station.isSupported, lines: station.lines.map(({ lineId, lineName, color }) => ({ lineId, lineName, color })) },
        proposedBy: { userId: getMyUserId(), nickname: ME.nickname },
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
 * 서버 모드는 services/room-proposals.ts (#101, body 없음), mock 인자는 무시해요
 */
export async function voteProposal(roomId: string, proposalId: string, mock?: 'error'): Promise<ProposalVoteResult> {
    if (!isMockMode()) return voteServerProposal(roomId, proposalId);
    await wait(MOCK_DELAY_MS / 2);
    requireMember(roomId);
    if (mock === 'error') throw new RoomError('NETWORK_ERROR', '투표하지 못했어요. 다시 시도해 주세요.');
    const list = proposalsByRoom.get(roomId) ?? [];
    const target = list.find(item => item.id === proposalId);
    if (!target) throw new RoomError('PROPOSAL_NOT_FOUND', '이미 삭제된 후보예요.');
    if (!target.voterIds.includes(getMyUserId())) {
        if (list.some(item => item.voterIds.includes(getMyUserId()))) {
            throw new RoomError('ALREADY_VOTED', '이미 다른 후보에 투표했어요. 투표는 바꾸거나 취소할 수 없어요.');
        }
        target.voterIds = [...target.voterIds, getMyUserId()];
    }
    return { proposalId, voteCount: target.voterIds.length, votedByMe: true };
}

/** 7.16 후보 삭제 (제안자 본인 또는 OWNER). 그 후보의 표도 함께 사라지고, 확정된 약속역은 바뀌지 않아요. 서버 모드는 services/room-proposals.ts (#101) */
export async function deleteProposal(roomId: string, proposalId: string): Promise<void> {
    if (!isMockMode()) return deleteServerProposal(roomId, proposalId);
    await wait(MOCK_DELAY_MS / 2);
    const room = requireMember(roomId);
    const list = proposalsByRoom.get(roomId) ?? [];
    const target = list.find(item => item.id === proposalId);
    if (!target) throw new RoomError('PROPOSAL_NOT_FOUND', '이미 삭제된 후보예요.');
    if (target.proposedBy.userId !== getMyUserId() && room.myRole !== 'OWNER') {
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

/* ───────────────── 방 나가기·승계·삭제 (#53) ───────────────── */

const leaveFailureUsed = new Set<string>();
const membershipRowIds = new Map<string, Map<string, string>>();

let membershipRowSequence = 1;

/**
 * mock 서버 내부의 멤버 행 ID예요. userId와 구분해요.
 * TODO: 명세 7.8의 동률 기준 id 필드는 백엔드와 확인해요.
 * 실제 승계 결과는 서버 응답 newOwnerId를 기준으로 반영해요.
 */
function ensureMembershipIds(roomId: string, members: RoomMember[]) {
    const ids =
        membershipRowIds.get(roomId) ?? new Map<string, string>();

    for (const member of members) {
        if (!ids.has(member.userId)) {
            ids.set(
                member.userId,
                `mock-membership-${String(
                    membershipRowSequence++,
                ).padStart(12, '0')}`,
            );
        }
    }

    membershipRowIds.set(roomId, ids);
    return ids;
}

for (const [roomId, members] of membersByRoom) {
    ensureMembershipIds(roomId, members);
}

function sortLeaveMembers(roomId: string, members: RoomMember[]) {
    const ids = ensureMembershipIds(roomId, members);

    return [...members].sort((a, b) => {
        const time =
            Date.parse(a.joinedAt) - Date.parse(b.joinedAt);

        if (time) return time;

        const left = ids.get(a.userId)!;
        const right = ids.get(b.userId)!;

        return left < right ? -1 : left > right ? 1 : 0;
    });
}

function leaveTarget(roomId: string, userId: string) {
    const invited = Object.values(INVITE_ONLY).find(
        item => item.room.id === roomId,
    );
    const room = getMockRoom(roomId) ?? invited?.room;

    if (!room) {
        throw new RoomError(
            'ROOM_NOT_FOUND',
            '약속방을 찾을 수 없어요.',
        );
    }

    const members =
        membersByRoom.get(roomId) ?? invited?.members ?? [];
    const member = members.find(item => item.userId === userId);

    if (!member) {
        throw new RoomError(
            'NOT_ROOM_MEMBER',
            '이미 나갔거나 참여하지 않은 약속방이에요.',
        );
    }

    return { room, members, member };
}

/** 검증이 끝난 뒤 한 번에 mock 상태를 반영해요. 중간에 await하지 않아요. */
function applyRoomLeave(
    roomId: string,
    userId: string,
): LeaveRoomResult {
    const { room, members, member } = leaveTarget(roomId, userId);

    const rest = sortLeaveMembers(roomId, members).filter(
        item => item.userId !== userId,
    );

    const newOwnerId =
        member.role === 'OWNER' && rest.length > 0
            ? rest[0].userId
            : null;

    const result: LeaveRoomResult = {
        roomDeleted: rest.length === 0,
        newOwnerId,
    };

    if (result.roomDeleted) {
        rooms = rooms.filter(item => item.id !== roomId);

        membersByRoom.delete(roomId);
        proposalsByRoom.delete(roomId);
        confirmedAtByRoom.delete(roomId);
        inviteCodes.delete(roomId);
        inviteFailOnce.delete(roomId);
        departureFailOnce.delete(roomId);
        updateFailOnce.delete(roomId);
        membershipRowIds.delete(roomId);

        for (const [code, id] of codeToRoomId) {
            if (id === roomId) {
                codeToRoomId.delete(code);
                BUSY_ONCE.delete(code);
            }
        }

        for (const [code, target] of Object.entries(INVITE_ONLY)) {
            if (target.room.id === roomId) {
                delete INVITE_ONLY[code];
                BUSY_ONCE.delete(code);
            }
        }

        for (const key of leaveFailureUsed) {
            if (key.startsWith(`${roomId}:`)) {
                leaveFailureUsed.delete(key);
            }
        }
    } else {
        // 내 목록에서 없어져도 다른 멤버의 방과 기록은 유지해요.
        const nextMembers = rest.map(item =>
            newOwnerId
                ? {
                    ...item,
                    role:
                        item.userId === newOwnerId
                            ? ('OWNER' as const)
                            : ('MEMBER' as const),
                }
                : { ...item },
        );

        const me = nextMembers.find(
            item => item.userId === ME.userId,
        );

        const nextRoom: RoomSummary = {
            ...room,
            memberCount: nextMembers.length,
            myRole: me?.role ?? 'MEMBER',
        };

        const code =
            inviteCodes.get(roomId) ??
            [...codeToRoomId].find(
                ([, id]) => id === roomId,
            )?.[0] ??
            Object.entries(INVITE_ONLY).find(
                ([, item]) => item.room.id === roomId,
            )?.[0] ??
            issueRoomCode();

        membersByRoom.set(roomId, nextMembers);
        membershipRowIds.get(roomId)?.delete(userId);

        // 나간 사람의 투표만 제거하고, 그 사람이 제안한 후보는 유지해요.
        for (const proposal of proposalsByRoom.get(roomId) ?? []) {
            proposal.voterIds = proposal.voterIds.filter(
                id => id !== userId,
            );
        }

        inviteCodes.set(roomId, code);
        codeToRoomId.set(code, roomId);

        // 나간 뒤에도 기존 초대 코드로 다시 참여할 수 있어요.
        INVITE_ONLY[code] = {
            room: nextRoom,
            members: nextMembers,
        };

        rooms = rooms.filter(item => item.id !== roomId);

        if (me) {
            rooms = [...rooms, nextRoom];
        }
    }

    // 채팅·추천 메모리 정리와 남은 멤버 화면 재조회에 사용해요.
    // 실제 WebSocket 이벤트는 아니에요.
    emitRoomMockChange({
        roomId,
        leftUserId: userId,
        ...result,
    });

    return result;
}

/**
 * TODO: API v1.12 7.8
 * DELETE /api/v1/rooms/{roomId}/members/me
 *
 * 응답 { roomDeleted, newOwnerId }와
 * 기존 Promise<LeaveRoomResult>를 유지해요.
 *
 * DB 트랜잭션·실제 SYSTEM 메시지·WebSocket 처리는 이번 범위 밖이에요.
 * 실패 주입은 방별 첫 요청에만 적용해요.
 * 실패 전에 방 상태를 바꾸지 않아요.
 */
export async function leaveRoom(
    roomId: string,
    mock?: LeaveRoomMock,
): Promise<LeaveRoomResult> {
    if (selectedStationInFlight.has(roomId)) {
        throw new RoomError(
            'ROOM_BUSY',
            '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.',
        );
    }

    selectedStationInFlight.add(roomId);

    try {
        await wait(MOCK_DELAY_MS);

        leaveTarget(roomId, ME.userId);

        const key = `${roomId}:${mock ?? ''}`;

        if (mock && !leaveFailureUsed.has(key)) {
            leaveFailureUsed.add(key);

            throw new RoomError(
                mock === 'leave-busy' ? 'ROOM_BUSY' : 'NETWORK_ERROR',
                '나가기를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.',
            );
        }

        return applyRoomLeave(roomId, ME.userId);
    } finally {
        selectedStationInFlight.delete(roomId);
    }
}

/** 나가기 확인 문구와 실제 승계에 같은 정렬 기준을 사용해요. */
export function previewLeave(detail: RoomDetail) {
    const me = detail.members.find(
        item => item.userId === ME.userId,
    );

    const rest = sortLeaveMembers(
        detail.id,
        detail.members,
    ).filter(item => item.userId !== ME.userId);

    const next =
        me?.role === 'OWNER' ? rest[0] : undefined;

    return {
        willDelete: !!me && rest.length === 0,
        nextOwner: next?.nickname ?? null,
        nextOwnerId: next?.userId ?? null,
    };
}

/** 확인용 방은 한 번만 준비하고, 삭제 후 다시 만들지 않아요. */
const preparedLeaveRooms = new Set<string>();

export function parseLeaveRoomScenario(
    value?: string,
): LeaveRoomScenario | undefined {
    switch (value) {
        case 'leave-error':
        case 'leave-busy':
        case 'leave-last':
        case 'leave-tie':
        case 'leave-successor':
            return value;
    }
}

/** 확인용 방을 원래 방과 분리해 기존 데이터를 변경하지 않아요. */
export function getLeaveMockRoomId(
    roomId: string,
    scenario?: LeaveRoomScenario,
) {
    switch (scenario) {
        case 'leave-last':
            return 'room-leave-last';
        case 'leave-tie':
            return 'room-leave-tie';
        case 'leave-successor':
            return 'room-leave-successor';
        default:
            return roomId;
    }
}

/** 명시한 mock 쿼리에서만 확인용 방을 준비해요. */
export function prepareLeaveMock(
    roomId: string,
    scenario?: LeaveRoomScenario,
) {
    const names = {
        'leave-last': '마지막 멤버 확인',
        'leave-tie': '같은 입장 시각 승계 확인',
        'leave-successor': '남은 멤버 권한 확인',
    };

    if (
        !scenario ||
        !(scenario in names) ||
        roomId !== getLeaveMockRoomId('', scenario)
    ) {
        return;
    }

    if (preparedLeaveRooms.has(roomId)) return;

    preparedLeaveRooms.add(roomId);

    const joinedAt = new Date(
        Date.now() - 86_400_000,
    ).toISOString();

    const earlier = new Date(
        Date.now() - 172_800_000,
    ).toISOString();

    const me: RoomMember = {
        ...ME,
        role: scenario === 'leave-successor' ? 'MEMBER' : 'OWNER',
        joinedAt: earlier,
        departureStation: STATION.gangnam,
    };

    let members: RoomMember[] = [me];

    if (scenario === 'leave-tie') {
        members = [
            me,
            {
                userId: 'leave-user-a',
                nickname: '준호',
                role: 'MEMBER',
                joinedAt,
                departureStation: STATION.hongdae,
            },
            {
                userId: 'leave-user-z',
                nickname: '유나',
                role: 'MEMBER',
                joinedAt,
                departureStation: STATION.jamsil,
            },
        ];
    } else if (scenario === 'leave-successor') {
        members = [
            {
                userId: 'leave-owner',
                nickname: '선호',
                role: 'OWNER',
                joinedAt: new Date(
                    Date.now() - 259_200_000,
                ).toISOString(),
                departureStation: STATION.hongdae,
            },
            me,
            {
                userId: 'leave-member',
                nickname: '준호',
                role: 'MEMBER',
                joinedAt,
                departureStation: STATION.jamsil,
            },
        ];
    }

    const room: RoomSummary = {
        id: roomId,
        name: names[scenario as keyof typeof names],
        status: 'OPEN',
        myRole: me.role,
        memberCount: members.length,
        maxMembers: MAX_MEMBERS,
        appointmentAt: daysFromToday(2, 19),
        selectedStation: null,
    };

    membersByRoom.set(roomId, members);
    ensureMembershipIds(roomId, members);

    if (scenario === 'leave-tie') {
        // userId 순서와 반대로 설정해서 멤버 행 ID 기준인지 확인해요.
        membershipRowIds
            .get(roomId)!
            .set('leave-user-a', 'mock-tie-row-0002');

        membershipRowIds
            .get(roomId)!
            .set('leave-user-z', 'mock-tie-row-0001');
    }

    const code = issueRoomCode();

    inviteCodes.set(roomId, code);
    codeToRoomId.set(code, roomId);

    rooms = [...rooms, room];

    const owner = ownerOf(members)!;

    proposalsByRoom.set(roomId, [
        seedProposal(
            roomId,
            105,
            owner.nickname,
            [owner.nickname],
            30,
        ),
    ]);
}

/**
 * 남은 내 화면에서 다른 멤버의 퇴장을 재현하는 mock 전용 함수예요.
 * 실제 API가 아니에요.
 */
export function mockLeaveRoomMember(
    roomId: string,
    userId: string,
): LeaveRoomResult {
    if (userId === ME.userId) {
        throw new RoomError(
            'VALIDATION_ERROR',
            '내 나가기는 확인창에서 진행해 주세요.',
        );
    }

    leaveTarget(roomId, ME.userId);

    if (selectedStationInFlight.has(roomId)) {
        throw new RoomError(
            'ROOM_BUSY',
            '다른 요청을 처리하고 있어요.',
        );
    }

    selectedStationInFlight.add(roomId);

    try {
        return applyRoomLeave(roomId, userId);
    } finally {
        selectedStationInFlight.delete(roomId);
    }
}
// 서버 캐시의 계정이 바뀌면 이전 사용자의 임시 후보·초대 코드를 재사용하지 않아요.
subscribeRoomCacheReset(() => {
    if (isMockMode()) return;
    proposalsByRoom.clear();
    inviteCodes.clear();
});
