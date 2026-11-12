/**
 * 약속역 후보 서버 연동 (#101, 명세 7.14~7.17 · BE 계약 기준)
 *
 * room.ts 의 후보 함수 4개(fetchProposals·createProposal·voteProposal·deleteProposal)가 서버 모드에서만 이 파일을 불러요.
 * - POST   /rooms/{roomId}/station-proposals                      7.14 제안 { stationId, resultId? }
 * - GET    /rooms/{roomId}/station-proposals                      7.15 목록 (최신순)
 * - DELETE /rooms/{roomId}/station-proposals/{proposalId}         7.16 삭제 (data: null)
 * - PUT    /rooms/{roomId}/station-proposals/{proposalId}/vote    7.17 참고용 투표 (body 없음, 같은 후보 재요청은 멱등)
 *
 * - 응답은 unknown 으로 받아 화면이 읽는 값만 필수로 검사하고, 형식 오류는 UNKNOWN_ERROR 예요.
 * - station·selectedStation 은 서버가 { id, name } 만 보내요. lines 는 빈 배열, isSupported 는 true 로 채워요(역 상세 추가 조회 안 함).
 * - 제안자 닉네임이 비어 있으면(없음·null·빈 문자열) "알 수 없음"으로 정리해요. 두 화면이 같은 값을 봐요.
 * - 요청 전 계정 범위를 잡고, 응답 뒤 다른 계정으로 바뀌었으면 늦은 응답을 버려요(AUTH_REQUIRED).
 * - NOT_ROOM_MEMBER·ROOM_NOT_FOUND 는 방 캐시를 비우고 같은 RoomError 로 알려요. 화면은 기존 방 접근 불가 화면을 보여줘요.
 * - 인증 오류(TOKEN_*·401)는 A-1 공통 처리에 맡기려고 ApiError 그대로 던져요.
 * - 실시간 갱신(WS)·투표로 자동 확정·최종 약속역 지정(7.10·7.11)은 범위 밖이에요.
 */

import { delete as apiDelete, get, post, put } from '@/services/api/client';
import { ApiError, isAuthError } from '@/services/api/errors';
import { assertRoomCacheScope, getRoomCacheScope, removeCachedRoom } from '@/services/room-cache';
import {
    RoomError,
    type ProposalVoteResult,
    type RoomErrorCode,
    type RoomStation,
    type StationProposal,
    type StationProposalList,
} from '@/types/room';

/** 방당 후보 최대 개수 (서버 기본 9). 응답에 없을 때 쓰는 값이에요. */
const DEFAULT_MAX_PROPOSALS = 9;
/** 탈퇴한 사용자 등 서버 닉네임이 비어 있을 때 보여줄 이름 */
export const UNKNOWN_PROPOSER_NAME = '알 수 없음';

type Action = 'list' | 'create' | 'vote' | 'delete';

/** 기존 mock 문구를 그대로 쓰고, mock 에 없던 문구만 새로 정했어요. */
const MESSAGES: Partial<Record<RoomErrorCode, string>> = {
    ALREADY_PROPOSED: '이미 후보에 있는 역이에요. 목록에서 투표해 주세요.',
    PROPOSAL_LIMIT_EXCEEDED: `약속역 후보는 방당 ${DEFAULT_MAX_PROPOSALS}개까지예요. 다른 후보를 지운 뒤 제안해 주세요.`,
    NOT_PROPOSAL_OWNER: '후보를 제안한 사람이나 방장만 지울 수 있어요.',
    ALREADY_VOTED: '이미 다른 후보에 투표했어요. 투표는 바꾸거나 취소할 수 없어요.',
    ROOM_BUSY: '다른 요청을 처리하는 중이에요. 잠시 후 다시 시도해 주세요.',
    PROPOSAL_NOT_FOUND: '이미 삭제된 후보예요.',
    STATION_NOT_FOUND: '역을 찾을 수 없어요.',
    STATION_UNSUPPORTED: '아직 지원하지 않는 역이라 후보로 올릴 수 없어요.',
    RESULT_NOT_FOUND: '추천 결과를 찾을 수 없어요. 추천을 다시 받은 뒤 제안해 주세요.',
    NOT_ROOM_MEMBER: '참여하지 않은 약속방이에요.',
    ROOM_NOT_FOUND: '약속방을 찾을 수 없어요.',
    UNKNOWN_ERROR: '약속역 후보 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

const NETWORK_MESSAGES: Record<Action, string> = {
    list: '네트워크 상태를 확인하고 다시 시도해 주세요.',
    create: '후보를 제안하지 못했어요. 다시 시도해 주세요.',
    vote: '투표하지 못했어요. 다시 시도해 주세요.',
    delete: '후보를 삭제하지 못했어요. 다시 시도해 주세요.',
};

const isAuthFailure = (error: unknown) => error instanceof ApiError && (error.code.startsWith('TOKEN_') || isAuthError(error));

function toRoomError(error: unknown, action: Action): never {
    if (error instanceof RoomError || isAuthFailure(error)) throw error;
    if (error instanceof ApiError && error.code === 'NETWORK_ERROR') throw new RoomError('NETWORK_ERROR', NETWORK_MESSAGES[action]);
    const code = error instanceof ApiError && error.code !== 'UNKNOWN_ERROR' && MESSAGES[error.code as RoomErrorCode]
        ? error.code as RoomErrorCode : 'UNKNOWN_ERROR';
    throw new RoomError(code, MESSAGES[code]!);
}

/* ---------- 응답 검사: 화면이 읽는 값만 필수, 안 쓰는 값은 없거나 달라도 통과 ---------- */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const invalid = (): never => { throw new ApiError('UNKNOWN_ERROR'); };

/** { id, name } 만 와도 통과해요. lines 가 없으면 빈 배열(노선 배지 숨김), isSupported 가 없으면 true 예요. */
function parseStation(value: unknown): RoomStation {
    if (!isRecord(value) || !isNumber(value.id) || typeof value.name !== 'string') return invalid();
    const lines = Array.isArray(value.lines)
        ? value.lines.flatMap(line => isRecord(line) && isNumber(line.lineId) && typeof line.lineName === 'string' && typeof line.color === 'string'
            ? [{ lineId: line.lineId, lineName: line.lineName, color: line.color }] : [])
        : [];
    return { id: value.id, name: value.name, isSupported: typeof value.isSupported === 'boolean' ? value.isSupported : true, lines };
}

/** 닉네임이 없음·null·빈 문자열이면 "알 수 없음"이에요. userId 가 없으면 빈 문자열이라 "내가 제안"·삭제 권한에 걸리지 않아요. */
function parseProposer(value: unknown): StationProposal['proposedBy'] {
    const record = isRecord(value) ? value : {};
    const nickname = typeof record.nickname === 'string' && record.nickname.trim() ? record.nickname : UNKNOWN_PROPOSER_NAME;
    return { userId: typeof record.userId === 'string' ? record.userId : '', nickname };
}

const parseResultId = (value: unknown) => (typeof value === 'string' && value ? value : null);

function parseItem(value: unknown): StationProposal {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !isDate(value.createdAt)
        || typeof value.isSelected !== 'boolean' || !isNumber(value.voteCount) || typeof value.votedByMe !== 'boolean') return invalid();
    return {
        id: value.id,
        station: parseStation(value.station),
        proposedBy: parseProposer(value.proposedBy),
        resultId: parseResultId(value.resultId),
        isSelected: value.isSelected,
        voteCount: value.voteCount,
        votedByMe: value.votedByMe,
        createdAt: value.createdAt,
    };
}

function parseList(value: unknown): StationProposalList {
    if (!isRecord(value) || !Array.isArray(value.items)) return invalid();
    if (value.maxProposals !== undefined && !(isNumber(value.maxProposals) && value.maxProposals > 0)) return invalid();
    const items = value.items.map(parseItem);
    if (new Set(items.map(item => item.id)).size !== items.length) return invalid();
    return {
        selectedStation: value.selectedStation === null || value.selectedStation === undefined ? null : parseStation(value.selectedStation),
        maxProposals: isNumber(value.maxProposals) ? value.maxProposals : DEFAULT_MAX_PROPOSALS,
        items,
    };
}

/** 7.14 응답에는 isSelected·voteCount·votedByMe 가 없어서 false·0·false 로 채워요. 화면은 제안 뒤 7.15 로 다시 맞춰요. */
function parseCreated(value: unknown): StationProposal {
    if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return invalid();
    return {
        id: value.id,
        station: parseStation(value.station),
        proposedBy: parseProposer(value.proposedBy),
        resultId: parseResultId(value.resultId),
        isSelected: false,
        voteCount: 0,
        votedByMe: false,
        createdAt: isDate(value.createdAt) ? value.createdAt : invalid(),
    };
}

function parseVote(value: unknown, proposalId: string): ProposalVoteResult {
    if (!isRecord(value) || !isNumber(value.voteCount) || typeof value.votedByMe !== 'boolean') return invalid();
    return { proposalId: typeof value.proposalId === 'string' && value.proposalId ? value.proposalId : proposalId, voteCount: value.voteCount, votedByMe: value.votedByMe };
}

/* ---------- 요청 ---------- */

const proposalsPath = (roomId: string) => `/rooms/${encodeURIComponent(roomId)}/station-proposals`;
const proposalPath = (roomId: string, proposalId: string) => `${proposalsPath(roomId)}/${encodeURIComponent(proposalId)}`;

/**
 * 요청 전 계정 범위(sessionGeneration:userId)를 잡고, 성공·실패 응답 모두 같은 계정일 때만 반영해요.
 * 방 접근 불가(403·404)는 그 계정의 방 캐시를 비워요.
 */
async function request<T>(roomId: string, action: Action, call: () => Promise<unknown>, parse: (raw: unknown) => T): Promise<T> {
    try {
        if (!roomId) throw new RoomError('ROOM_NOT_FOUND', MESSAGES.ROOM_NOT_FOUND!);
        const scope = getRoomCacheScope();
        let raw: unknown;
        try {
            raw = await call();
        } catch (error) {
            if (isAuthFailure(error)) throw error;
            assertRoomCacheScope(scope);
            if (error instanceof ApiError && (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND')) removeCachedRoom(roomId, scope);
            throw error;
        }
        assertRoomCacheScope(scope);
        return parse(raw);
    } catch (error) {
        return toRoomError(error, action);
    }
}

export function fetchServerProposals(roomId: string): Promise<StationProposalList> {
    return request(roomId, 'list', () => get<unknown>(proposalsPath(roomId)), parseList);
}

export function createServerProposal(roomId: string, stationId: number, resultId?: string): Promise<StationProposal> {
    return request(roomId, 'create', () => {
        // 존재·지원 여부·중복·상한은 서버가 판단해요. 잘못된 ID 로 요청을 보내지는 않아요.
        if (!Number.isSafeInteger(stationId) || stationId <= 0) throw new ApiError('STATION_NOT_FOUND', null, null, 404);
        return post<unknown>(proposalsPath(roomId), { stationId, ...(resultId ? { resultId } : {}) });
    }, parseCreated);
}

export function voteServerProposal(roomId: string, proposalId: string): Promise<ProposalVoteResult> {
    return request(roomId, 'vote', () => {
        if (!proposalId) throw new ApiError('PROPOSAL_NOT_FOUND', null, null, 404);
        return put<unknown>(`${proposalPath(roomId, proposalId)}/vote`);
    }, raw => parseVote(raw, proposalId));
}

/** 7.16 은 data: null 로 성공해요. 본문은 쓰지 않아요. */
export async function deleteServerProposal(roomId: string, proposalId: string): Promise<void> {
    await request(roomId, 'delete', () => {
        if (!proposalId) throw new ApiError('PROPOSAL_NOT_FOUND', null, null, 404);
        return apiDelete<unknown>(proposalPath(roomId, proposalId));
    }, () => undefined);
}
