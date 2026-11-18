import MemberAvatar, { memberTone } from '@/components/rooms/member-avatar';
import { formatStationName } from '@/utils/station-name';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { Text } from '@/components/app-text';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import InviteCodeSheet from '@/components/rooms/invite-code-sheet';
import RoomLeaveSheet from '@/components/rooms/room-leave-sheet';
import { subscribeRoomMockChanges } from '@/stores/room-mock-events';
import ProposalPanel, { type ProposalState } from '@/components/rooms/proposal-panel';
import SelectedStationControls from '@/components/rooms/selected-station-controls';
import { useSelectedStation } from '@/hooks/use-selected-station';
import RoomChatPanel from '@/components/rooms/chat-panel';
import { useRoomChat } from '@/hooks/use-room-chat';
import { openStationPicker, type Station } from '@/app/station-search';
import { formatDday, formatMonthDay, formatTime } from '@/constants/home-mock';
import {
    fetchInviteCode,
    fetchProposals,
    fetchRoomDetail,
    getMyUserId,
    mockFillProposals,
    mockTransferOwner,
    updateMyDeparture,
    getLeaveMockRoomId,
    mockLeaveRoomMember,
    parseLeaveRoomScenario,
    prepareLeaveMock,
} from '@/services/room';
import { RoomError, type RoomErrorCode, type RoomDetail } from '@/types/room';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import { useRoomEvents, roomEventsScope } from '@/hooks/use-room-events';
import { mergeRoomUpdated, parseSelectedStationEvent } from '@/services/room-events';
import { cacheRoomDetail, clearCachedRoomCode, getRoomCacheScope, removeCachedRoom } from '@/services/room-cache';
import { ROOM_CARD_PADDING } from '@/constants/layout';

const NAVY = '#25212D';
const MINT = '#5C3F78';
const MINT_DEEP = '#5C3F78';
const WHITE = '#ffffff';
const BG = '#F7F5FA';
const SECONDARY = '#83808B';
const BORDER = '#EEEAF2';
const RED = '#d6455d';

type Tab = 'chat' | 'vote';
type Sheet = 'leave' | 'invite' | null;
type LoadError = 'ROOM_NOT_FOUND' | 'NOT_ROOM_MEMBER' | 'UNKNOWN';

/**
 * 약속방 상세 화면 (#45, 상세설계서 그림 28·31·32·35·36·38·39, API 명세 v1.12 7.4~7.11)
 *
 * - 내 역할(myRole)에 따라 조작 범위를 나눕니다.
 *   OWNER: 초대 코드 확인·방 정보 수정·약속역 확정/해제
 *   MEMBER: 후보 제안·투표·채팅·내 출발역 설정·나가기
 * - 일반 상세(7.4)에는 초대 코드가 없고, 방장만 7.9 로 따로 조회합니다.
 * - 다른 멤버의 출발역은 볼 수만 있고 편집 버튼은 내 카드에만 있어요.
 * - 하위 화면(추천·출발역 입력)에서 돌아오면 다시 조회해서 바뀐 상태를 보여줍니다.
 *
 * 테스트용(mock 모드에서만, 서버 모드는 ?mock= 을 쓰지 않아요):
 *   /rooms/room-1?mock=error          → 첫 조회 실패
 *   /rooms/room-4?mock=invite-error   → 초대 코드 첫 조회 실패 (다시 시도하면 성공)
 *   /rooms/room-4?mock=owner-give     → 내 방장을 다른 멤버에게 넘긴 상태로 진입 (초대 코드·수정 버튼 사라짐)
 *   /rooms/room-2?mock=owner-take     → 멤버인 방에서 내가 방장이 된 상태로 진입 (초대 코드 버튼 생김)
 *   /rooms/room-4?mock=departure-error        → 출발역 첫 저장 실패(NETWORK_ERROR), 다시 시도하면 성공 (#48)
 *   /rooms/room-4?mock=departure-unsupported  → 출발역 첫 저장이 STATION_UNSUPPORTED(422)로 거절 (#48)
 *   약속역 후보·투표 (#50, ?tab=vote 로 후보 탭을 바로 열 수 있어요)
 *   /rooms/room-2?tab=vote                       → 나는 MEMBER, 후보 3개(내 제안 1개만 삭제 가능), 아직 투표 안 함
 *   /rooms/room-4?tab=vote                       → 나는 OWNER, 모든 후보 삭제·확정 가능
 *   /rooms/room-1?tab=vote                       → 후보 없음(빈 목록)
 *   /rooms/room-2?tab=vote&mock=proposals-error  → 후보 첫 조회 실패, 다시 시도하면 성공
 *   /rooms/room-4?tab=vote&mock=proposals-full   → 후보 9/9, 제안 버튼 비활성 + 안내
 *   /rooms/room-2?tab=vote&mock=propose-error    → 첫 직접 제안 실패(NETWORK_ERROR), 다시 하면 성공
 *   /rooms/room-2?tab=vote&mock=vote-error       → 첫 투표 실패(NETWORK_ERROR), 다시 하면 성공
 * 서버 모드: 방 정보·멤버·초대 코드·방 수정·출발역·후보·투표는 services/room*.ts 로 서버를 불러요.
 * 서버 모드에서는 방 상태 이벤트를 구독하고 조용히 갱신하며, 재연결 시 놓친 변경을 재조회합니다(#117).
 */
export default function RoomDetailScreen() {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ roomId: string; mock?: string; tab?: string }>();
    // 홈 '다가오는 약속' 카드(roomId: preview)는 같은 mock 방(room-2)으로 엽니다.
    const baseRoomId =
        isMockMode() && params.roomId === 'preview'
            ? 'room-2'
            : String(params.roomId);

    const leaveScenario = isMockMode() ? parseLeaveRoomScenario(params.mock) : undefined;

    const roomId = getLeaveMockRoomId(
        baseRoomId,
        leaveScenario,
    );

    const leaveMock =
        leaveScenario === 'leave-error' ||
        leaveScenario === 'leave-busy'
            ? leaveScenario
            : undefined;
    const failNext = useRef(params.mock === 'error');
    const [inviteFailNext, setInviteFailNext] = useState(
        params.mock === 'invite-error',
    );
    const departureFailNext = useRef<'error' | 'unsupported' | undefined>(
        params.mock === 'departure-error' ? 'error' : params.mock === 'departure-unsupported' ? 'unsupported' : undefined,
    );
    /** 출발역 저장 상태 (#48): 저장 중인 역 / 실패한 역(다시 시도용) */
    const [departureSaving, setDepartureSaving] = useState<Station | null>(null);
    const [departureFailed, setDepartureFailed] = useState<{ station: Station; message: string } | null>(null);
    const [departureSaved, setDepartureSaved] = useState<string | null>(null);
    const ownerMockApplied = useRef(false);
    const proposalsFailNext = useRef(params.mock === 'proposals-error');
    const proposalsFillApplied = useRef(false);
    const myUserId = getMyUserId();
    const requestId = useRef(0);
    const proposalsRequestId = useRef(0);
    const active = useRef(true);
    const departureLock = useRef(false);
    const departureId = useRef(0);
    const departureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [detail, setDetail] = useState<RoomDetail | null>(null);
    const [loadError, setLoadError] = useState<LoadError | null>(null);
    /** 헤더 칩 미리보기용 초대 코드 (7.9). 실패해도 칩은 남겨 두고 시트에서 다시 시도합니다 */
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    /** 약속역 후보 목록 (7.15). 방 상세와 따로 불러와서 실패해도 방 화면은 그대로 보여줘요 */
    const [proposals, setProposals] = useState<ProposalState>({ status: 'loading' });
    const [tab, setTab] = useState<Tab>(params.tab === 'vote' ? 'vote' : 'chat');
    const [sheet, setSheet] = useState<Sheet>(null);
    const [notice, setNotice] = useState('');
    /** 확정 약속역 "내 경로 보기"에서 내 출발역이 없을 때 안내 (#140) */
    const [routeHint, setRouteHint] = useState('');
    const accountScope = roomEventsScope();
    const stationEvent = useRef({ roomId, at: -Infinity, revision: 0 });
    const summaryEvent = useRef<{ revision: number; payload: unknown }>({ revision: 0, payload: null });
    useEffect(() => { stationEvent.current = { roomId, at: -Infinity, revision: 0 }; }, [roomId, accountScope]);
    useEffect(() => { summaryEvent.current = { revision: 0, payload: null }; }, [roomId, accountScope]);
    const detailRef = useRef(detail);
    useEffect(() => { detailRef.current = detail; }, [detail]);

    const rejectRoom = useCallback((code: 'NOT_ROOM_MEMBER' | 'ROOM_NOT_FOUND' = 'NOT_ROOM_MEMBER') => {
        requestId.current++; proposalsRequestId.current++;
        if (!isMockMode()) { try { removeCachedRoom(roomId, getRoomCacheScope()); } catch {} }
        setDetail(null); setInviteCode(null); setSheet(null); setLoadError(code);
        router.replace('/rooms');
    }, [roomId]);

    const handleAccessError = useCallback(async (code: RoomErrorCode) => {
        if (code === 'NOT_ROOM_MEMBER' || code === 'ROOM_NOT_FOUND') { router.replace('/rooms'); return; }
        if (code !== 'NOT_ROOM_OWNER') return;
        setInviteCode(null);
        const id = requestId.current;
        try {
            const latest = await fetchRoomDetail(roomId);
            if (active.current && id === requestId.current) setDetail(latest);
        } catch (error) {
            if (active.current && id === requestId.current && error instanceof RoomError && error.code === 'NOT_ROOM_MEMBER') router.replace('/rooms');
        }
    }, [roomId]);

    /** 7.15 후보 목록 재조회 (제안·삭제·투표·확정 후, 화면 복귀 시) */
    const loadProposals = useCallback(async (quiet = false) => {
        const id = ++proposalsRequestId.current;
        const scope = roomEventsScope();
        const current = () => id === proposalsRequestId.current && scope === roomEventsScope();
        try {
            if (!proposalsFillApplied.current && params.mock === 'proposals-full') {
                proposalsFillApplied.current = true;
                mockFillProposals(roomId);
            }
            const fail = proposalsFailNext.current;
            proposalsFailNext.current = false; // 다시 시도하면 성공하도록
            const list = await fetchProposals(roomId, fail ? 'error' : undefined);
            if (current()) setProposals({ status: 'ready', list });
        } catch (error) {
            if (!current()) return;
            // 인증 오류는 A-1 공통 처리에 맡기고 패널에 따로 안내하지 않아요.
            if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            // 서버가 방 접근 불가(403·404)라고 하면 방 상세와 같은 접근 불가 화면을 보여줘요(방 캐시는 서비스가 비워요).
            if (error instanceof RoomError && (error.code === 'ROOM_NOT_FOUND' || error.code === 'NOT_ROOM_MEMBER')) {
                if (isMockMode()) { requestId.current++; setDetail(null); setLoadError(error.code); }
                else rejectRoom(error.code);
                return;
            }
            setProposals(previous => quiet && previous.status === 'ready' ? previous
                : { status: 'error', message: error instanceof RoomError ? error.message : '네트워크 상태를 확인하고 다시 시도해 주세요.' });
        }
    }, [roomId, params.mock, rejectRoom]);

    const retryProposals = useCallback(async () => {
        setProposals({ status: 'loading' });
        await loadProposals();
    }, [loadProposals]);

    const load = useCallback(async (quiet = false) => {
        const id = ++requestId.current;
        const scope = accountScope;
        const revision = stationEvent.current.revision;
        const summaryRevision = summaryEvent.current.revision;
        const current = () => id === requestId.current && scope === roomEventsScope();
        setLoadError(null);
        try {
            prepareLeaveMock(roomId, leaveScenario);

            const fail = failNext.current;
            failNext.current = false; // 다시 시도하면 성공하도록
            // 방장 변경 mock (#47): 진입 시 한 번만 적용. 실제로는 7.8 승계·탈퇴로만 바뀝니다
            if (isMockMode() && !ownerMockApplied.current && (params.mock === 'owner-give' || params.mock === 'owner-take')) {
                ownerMockApplied.current = true;
                mockTransferOwner(roomId, params.mock === 'owner-give' ? 'give' : 'take');
            }
            let room = await fetchRoomDetail(roomId, fail ? 'error' : undefined);
            if (!current()) return;
            if (summaryRevision !== summaryEvent.current.revision) room = mergeRoomUpdated(room, summaryEvent.current.payload, false) ?? room;
            if (revision !== stationEvent.current.revision && detailRef.current) {
                room = { ...room, selectedStation: detailRef.current.selectedStation, confirmedAt: detailRef.current.confirmedAt, status: detailRef.current.status };
            }
            if (!isMockMode()) cacheRoomDetail(room, getRoomCacheScope());
            detailRef.current = room;
            setDetail(room);
            if (!quiet) void loadProposals();
            // 초대 코드는 현재 OWNER 일 때만 7.9 로 따로 조회 (상세 응답엔 없음). 실패해도 상세는 그대로 보여줍니다
            if (room.myRole === 'OWNER') {
                try {
                    const code = (await fetchInviteCode(roomId)).roomCode;
                    if (current()) setInviteCode(code);
                } catch (error) {
                    if (error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) throw error;
                    if (current()) {
                        setInviteCode(null);
                        if (error instanceof RoomError) await handleAccessError(error.code);
                    }
                }
            } else {
                setInviteCode(null);
                setSheet(previous => previous === 'invite' ? null : previous);
                if (!isMockMode()) clearCachedRoomCode(roomId, getRoomCacheScope());
            }
        } catch (error) {
            if (!current() || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            if (!isMockMode() && error instanceof RoomError && (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND')) { rejectRoom(error.code); return; }
            if (quiet) return;
            setDetail(null);
            const code = error instanceof RoomError ? error.code : null;
            setLoadError(code === 'ROOM_NOT_FOUND' || code === 'NOT_ROOM_MEMBER' ? code : 'UNKNOWN');
            if (code === 'NOT_ROOM_MEMBER') router.replace('/rooms');
        }
    }, [roomId, params.mock, loadProposals, leaveScenario, handleAccessError, rejectRoom, accountScope]);

    useRoomEvents(roomId, {
        rejected: rejectRoom,
        refresh: async target => {
            if (target === 'detail') await load(true);
            if (target === 'proposals') await loadProposals(true);
            // This screen does not display recommendation results.
        },
        receive: event => {
            if (event.type !== 'ROOM_UPDATED' && event.type !== 'SELECTED_STATION_CHANGED') return;
            const previous = detailRef.current;
            if (!previous) return ['detail'];
            const includeStation = Date.parse(event.at) >= stationEvent.current.at;
            const selected = event.type === 'SELECTED_STATION_CHANGED' ? parseSelectedStationEvent(event.payload) : null;
            const next = event.type === 'ROOM_UPDATED' ? mergeRoomUpdated(previous, event.payload, includeStation)
                : selected ? { ...previous, ...(includeStation ? selected : {}),
                    ...(includeStation ? { status: selected.selectedStation ? 'CONFIRMED' as const : 'OPEN' as const } : {}) } : null;
            if (!next) return ['detail'];
            if (event.type === 'ROOM_UPDATED') summaryEvent.current = { revision: summaryEvent.current.revision + 1, payload: event.payload };
            if (includeStation) { stationEvent.current.at = Date.parse(event.at); stationEvent.current.revision++; }
            detailRef.current = next;
            cacheRoomDetail(next, getRoomCacheScope());
            setDetail(next);
        },
    });

    useEffect(() => {
        return subscribeRoomMockChanges(change => {
            if (
                change.roomId !== roomId ||
                change.leftUserId === myUserId
            ) {
                return;
            }

            void load();
        });
    }, [roomId, myUserId, load]);

    useEffect(() => {
        // leave-successor 쿼리에서만 다른 방장의 퇴장을 재현해요.
        if (
            leaveScenario !== 'leave-successor' ||
            !detail ||
            detail.id !== roomId ||
            detail.myRole !== 'MEMBER'
        ) {
            return;
        }

        const ownerId = detail.ownerId;

        const timer = setTimeout(() => {
            try {
                mockLeaveRoomMember(roomId, ownerId);
            } catch (error) {
                setNotice(
                    error instanceof RoomError
                        ? error.message
                        : '방 상태를 갱신하지 못했어요.',
                );

                void load();
            }
        }, 2000);

        return () => clearTimeout(timer);
    }, [detail, leaveScenario, roomId, load]);

    useFocusEffect(
        useCallback(() => {
            active.current = true;
            if (!departureLock.current) setDepartureSaving(null);
            void load();
            // 화면을 떠나거나 다른 방을 열면 이전 조회·저장 화면 갱신을 무효화해요.
            return () => {
                active.current = false;
                requestId.current++; proposalsRequestId.current++; departureId.current++;
                if (departureTimer.current) clearTimeout(departureTimer.current);
            };
        }, [load]),
    );

    const back = () => (router.canGoBack() ? router.back() : router.replace('/rooms'));
    const isOwner = detail?.myRole === 'OWNER';

    const stationManager = useSelectedStation({
        detail,
        mock: params.mock,
        onChanged: load,
    });

    const chat = useRoomChat(roomId, params.mock);
    const roomScroll = useRef<ScrollView>(null);
    const [scrollHeight, setScrollHeight] = useState(0);
    const [tabsHeight, setTabsHeight] = useState(0);
    const [noticeHeight, setNoticeHeight] = useState(0);
    const scrollBottomPadding = insets.bottom + (tab === 'chat' ? 12 : 32);
    // Keep the existing gap above the tabs and between the tabs and panel.
    const chatPanelHeight = scrollHeight > 0 && tabsHeight > 0
        ? Math.max(360, scrollHeight - tabsHeight - styles.content.gap * 2 - scrollBottomPadding
            - (notice ? noticeHeight + styles.content.gap : 0))
        : undefined;

    /** 추천받기·내 출발역 설정: 출발역·조건 입력 화면 (그림 30) */
    const openRecommendations = () => {
        if (!detail) return;
        router.push({
            pathname: '/rooms/[roomId]/recommendations',
            params: { roomId: detail.id, roomName: detail.name, maxMembers: String(detail.maxMembers) },
        });
    };

    /**
     * 내 출발역 설정/변경 (#48, 그림 28 ❼·그림 30 ❹, 명세 7.7)
     * 공통 역 검색 화면(#33)을 열고, 고른 역을 7.7 로 저장합니다. 미제공 역은 역 검색 화면에서 이미 막히고,
     * 서비스에서도 STATION_UNSUPPORTED 로 한 번 더 거절합니다. 실패하면 기존 출발역은 그대로예요.
     */
    const saveDeparture = async (station: Station) => {
        if (!detail || departureLock.current) return;
        departureLock.current = true;
        const id = ++departureId.current;
        setDepartureSaving(station);
        setDepartureFailed(null);
        setNotice('');
        try {
            const fail = departureFailNext.current;
            departureFailNext.current = undefined; // 다시 시도하면 성공하도록
            await updateMyDeparture(detail.id, { departureStationId: station.id }, fail);
            if (!active.current || id !== departureId.current) return;
            setDepartureSaving(null);
            await load(); // 방 상세·멤버 목록에 반영 (7.4/7.6 재조회)
            if (!active.current || id !== departureId.current) return;
            setDepartureSaved(`${formatStationName(station.name)}으로 설정했어요`);
            departureTimer.current = setTimeout(() => { if (active.current) setDepartureSaved(null); }, 2500);
        } catch (error) {
            if (!active.current || id !== departureId.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            if (error instanceof RoomError && (error.code === 'NOT_ROOM_MEMBER' || error.code === 'ROOM_NOT_FOUND')) { await handleAccessError(error.code); return; }
            const message = error instanceof RoomError ? error.message : '출발역을 저장하지 못했어요. 다시 시도해 주세요.';
            const retryable = !(error instanceof RoomError) || error.code === 'NETWORK_ERROR' || error.code === 'ROOM_BUSY';
            setDepartureFailed(retryable ? { station, message } : null);
            setNotice(message);
        } finally {
            departureLock.current = false;
            if (active.current) setDepartureSaving(null);
        }
    };

    const pickDeparture = () => {
        if (!detail) return;
        const me = detail.members.find(item => item.userId === myUserId);
        openStationPicker(
            { purpose: 'departure', contextLabel: detail.name, selectedStationId: me?.departureStation?.id },
            saveDeparture,
        );
    };

    if (!detail) {
        return (
            <View style={styles.root}>
                <StatusBar style="dark" />
                <Header topInset={insets.top} onBack={back} />
                {loadError ? <ErrorState error={loadError} onRetry={load} /> : (
                    <View style={styles.center}>
                        <ActivityIndicator color={NAVY} />
                        <Text style={styles.caption}>약속방을 불러오는 중이에요</Text>
                    </View>
                )}
            </View>
        );
    }

    const at = detail.appointmentAt ? new Date(detail.appointmentAt) : null;
    const station = detail.selectedStation;

    /**
     * 확정 약속역까지 내 경로 (#140). OWNER·MEMBER 모두 써요.
     * 출발 = 로그인한 나의 이 방 출발역(내 userId 로 찾아요), 도착 = 확정 약속역, roomId = 이 방(약속방 모드, 방 약속 시각 반영).
     * 역은 ID 로 넘겨 이름 재검색 없이 정확한 역으로 요청해요. 출발역과 약속역이 같으면 경로 화면의 같은 역 안내(#141)에 맡겨요.
     * 내 출발역이 없으면 경로 화면으로 가지 않고 안내와 함께 기존 출발역 설정(역 검색)을 바로 열어요.
     */
    const openMyRoute = () => {
        if (!detail.selectedStation) return;
        const myDeparture = detail.members.find(item => item.userId === myUserId)?.departureStation;
        if (!myDeparture) {
            setRouteHint('내 출발역을 먼저 설정해 주세요.');
            pickDeparture();
            return;
        }
        setRouteHint('');
        router.push({
            pathname: '/route-search',
            params: {
                departureId: String(myDeparture.id),
                departure: myDeparture.name,
                destinationId: String(detail.selectedStation.id),
                destination: detail.selectedStation.name,
                roomId: detail.id,
            },
        });
    };
    const setCount = detail.members.filter(item => item.departureStation).length;
    const proposalItems = proposals.status === 'ready' ? proposals.list.items : [];
    // 방 카드 요약: 최다 득표 후보 (동점이면 개수만). 투표는 참고용이라 확정과는 무관해요
    const topVotes = Math.max(0, ...proposalItems.map(item => item.voteCount));
    const leaders = topVotes > 0 ? proposalItems.filter(item => item.voteCount === topVotes) : [];

    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior="padding"
            enabled={Platform.OS === 'ios'}
        >
            <StatusBar style="dark" />
            <Header
                topInset={insets.top}
                onBack={back}
                right={
                    <View style={styles.headerRight}>
                        {/* 그림 28 ❻ 초대 코드: 현재 방장(myRole)에게만 보입니다 (명세 7.9). 누르면 초대 코드 시트 */}
                        {isOwner && (
                            <Pressable
                                style={styles.codeChip}
                                onPress={() => setSheet('invite')}
                                accessibilityRole="button"
                                accessibilityLabel={inviteCode ? `초대 코드 ${inviteCode.split('').join(' ')} 보기` : '초대 코드 보기'}
                            >
                                <Ionicons name="key-outline" size={14} color={NAVY} />
                                <Text style={styles.codeText}>{inviteCode ?? '초대 코드'}</Text>
                            </Pressable>
                        )}
                        {/* 그림 28 ❽ 나가기: 모든 멤버 */}
                        <Pressable style={styles.iconButton} onPress={() => setSheet('leave')} accessibilityLabel="약속방 나가기">
                            <Ionicons name="exit-outline" size={23} color={NAVY} />
                        </Pressable>
                    </View>
                }
            />

            <ScrollView
                ref={roomScroll}
                onLayout={({ nativeEvent }) => setScrollHeight(nativeEvent.layout.height)}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: scrollBottomPadding },
                ]}
            >
                <View style={styles.titleBlock}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.roomName}>{detail.name}</Text>
                        {isOwner && (
                            <Pressable style={styles.editButton} onPress={() => router.push(`/rooms/${detail.id}/edit`)} accessibilityRole="button">
                                <Ionicons name="create-outline" size={14} color={MINT} />
                                <Text style={styles.editText}>수정</Text>
                            </Pressable>
                        )}
                    </View>
                    <View style={styles.infoRow}>
                        <Ionicons name="calendar-outline" size={15} color="#6F6B78" />
                        <Text style={styles.infoText}>
                            {at ? `${formatMonthDay(at)} ${formatTime(at)} · ${formatDday(at)}` : '약속 시각 미정'}
                        </Text>
                        <Ionicons name="people-outline" size={15} color="#6F6B78" style={{ marginLeft: 10 }} />
                        <Text style={styles.infoText}>{detail.memberCount}/{detail.maxMembers}명</Text>
                    </View>

                </View>
                <View style={styles.roomCard}>
                    <View style={[styles.statusChip, station && styles.statusChipDone]}>
                        <Text style={[styles.statusText, station && styles.statusTextDone]}>{station ? '약속역 확정' : '약속역 정하는 중'}</Text>
                    </View>
                    {/* 약속역: 확정 / 미확정 */}
                    <View style={styles.stationStrip}>
                        {station ? (
                            <>
                                <View style={styles.flex}>
                                    <Text style={styles.stripLabel}>약속역</Text>
                                    <View style={styles.stationRow}>
                                        <Text style={styles.stationName}>{formatStationName(station.name)}</Text>
                                        {station.lines?.map(line => (
                                            <View key={line.lineId} style={[styles.lineBadge, { backgroundColor: line.color }]}>
                                                <Text style={styles.lineText}>{line.lineName.replace('호선', '')}</Text>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                                <Pressable style={[styles.stripButton, styles.stripPrimary]} onPress={openMyRoute} accessibilityRole="button" accessibilityLabel="확정 약속역까지 내 경로 보기">
                                    <Text style={[styles.stripButtonText, styles.stripPrimaryText]}>내 경로 보기</Text>
                                </Pressable>
                            </>
                        ) : (
                            <>
                                <View style={styles.flex}>
                                    <Text style={styles.stripLabel}>약속역 미정</Text>
                                    <Text style={styles.stripCaption}>
                                        {proposalItems.length === 0
                                            ? '아직 약속역을 정하지 않았어요'
                                            : leaders.length === 1
                                                ? `후보 ${proposalItems.length}개 · ${formatStationName(leaders[0].station.name)} ${topVotes}표로 검토 중`
                                                : `후보 ${proposalItems.length}개 검토 중`}
                                    </Text>
                                </View>
                                <Pressable style={[styles.stripButton, styles.stripPrimary]} onPress={openRecommendations}>
                                    <Text style={[styles.stripButtonText, styles.stripPrimaryText]}>추천받기</Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                    <SelectedStationControls
                        detail={detail}
                        controller={stationManager}
                        bottomInset={insets.bottom}
                        embedded
                    />
                </View>
                {/* 출발역을 설정하면 안내는 저절로 사라져요. */}
                {!!station && !!routeHint && !detail.members.find(item => item.userId === myUserId)?.departureStation && (
                    <View style={styles.routeHint} accessibilityRole="alert">
                        <Ionicons name="information-circle-outline" size={16} color={MINT} />
                        <Text style={styles.routeHintText}>{routeHint}</Text>
                    </View>
                )}

                {/* 멤버 · 출발역 (그림 28 ❼) */}
                <View style={styles.panel}>
                    <View style={styles.rowBetween}>
                        <Text style={styles.cardTitle}>멤버</Text>
                        <Text style={styles.counter}>출발역 {setCount}/{detail.members.length}명 설정</Text>
                    </View>
                    {detail.members.map(member => {
                        const mine = member.userId === myUserId;
                        return (
                            <View key={member.userId} style={styles.memberRow}>
                                <MemberAvatar tone={memberTone(member.userId, myUserId)} size={32} isOwner={member.userId === detail.ownerId} />
                                <View style={styles.flex}>
                                    <View style={styles.nameRow}>
                                        <Text style={styles.memberName}>{member.nickname}</Text>
                                        {mine && <Text style={styles.meTag}>나</Text>}
                                    </View>
                                    {mine && departureSaving ? (
                                        <Text style={styles.departureSaving} numberOfLines={1}>{formatStationName(departureSaving.name)}으로 저장하는 중…</Text>
                                    ) : member.departureStation ? (
                                        <View style={styles.departureRow}>
                                            <Text style={styles.departure}>출발 · {formatStationName(member.departureStation.name)}</Text>
                                            {/* 노선 표시: 7.4 members[].departureStation.lines 의 color 그대로 */}
                                            {member.departureStation.lines?.map(line => (
                                                <View key={line.lineId} style={[styles.lineDot, { backgroundColor: line.color }]} accessibilityLabel={line.lineName}>
                                                    <Text style={styles.lineDotText}>{line.lineName.replace(/호선$/, '').slice(0, 2)}</Text>
                                                </View>
                                            ))}
                                        </View>
                                    ) : (
                                        <Text style={styles.departureEmpty}>출발역 미설정</Text>
                                    )}
                                    {mine && departureFailed && !departureSaving && (
                                        <Text style={styles.departureError} numberOfLines={2}>{departureFailed.message}</Text>
                                    )}
                                    {mine && departureSaved && !departureSaving && (
                                        <Text style={styles.departureSaved}>✓ {departureSaved}</Text>
                                    )}
                                </View>
                                {/* 출발역 편집은 내 카드에만 (명세 7.6). OWNER·MEMBER 모두 본인 것만 */}
                                {mine && (
                                    departureSaving ? (
                                        <View style={[styles.smallButton, styles.smallButtonBusy]}>
                                            <ActivityIndicator size="small" color={NAVY} />
                                        </View>
                                    ) : departureFailed ? (
                                        <Pressable style={[styles.smallButton, styles.smallButtonRetry]} onPress={() => saveDeparture(departureFailed.station)} accessibilityRole="button">
                                            <Text style={[styles.smallButtonText, { color: WHITE }]}>다시 시도</Text>
                                        </Pressable>
                                    ) : (
                                        <Pressable style={styles.smallButton} onPress={pickDeparture} accessibilityRole="button" accessibilityLabel={member.departureStation ? '내 출발역 변경' : '내 출발역 설정'}>
                                            <Text style={styles.smallButtonText}>{member.departureStation ? '출발역 변경' : '출발역 설정'}</Text>
                                        </Pressable>
                                    )
                                )}
                            </View>
                        );
                    })}
                </View>

                {/* 채팅 · 후보/투표 */}
                <View style={styles.tabs} onLayout={({ nativeEvent }) => setTabsHeight(nativeEvent.layout.height)}>
                    {([
                        ['chat', '채팅', 'chatbubble-ellipses-outline'],
                        ['vote', proposals.status === 'ready' ? `약속역 후보 ${proposalItems.length}` : '약속역 후보', 'checkbox-outline'],
                    ] as const).map(([key, title, icon]) => (
                        <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => { setTab(key); setNotice(''); }}>
                            <Ionicons name={icon} size={17} color={tab === key ? MINT : SECONDARY} />
                            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{title}</Text>
                        </Pressable>
                    ))}
                </View>

                {tab === 'chat' ? (
                    <RoomChatPanel
                        key={chat.scope}
                        controller={chat}
                        roomId={detail.id}
                        myUserId={myUserId}
                        members={detail.members}
                        ownerId={detail.ownerId}
                        panelHeight={chatPanelHeight}
                        onInputFocus={() => {
                            roomScroll.current?.scrollToEnd({
                                animated: true,
                            });
                        }}
                    />
                ) : (
                    <ProposalPanel
                        roomId={detail.id}
                        roomName={detail.name}
                        isOwner={isOwner}
                        myUserId={myUserId}
                        memberCount={detail.memberCount}
                        state={!isMockMode() && proposals.status === 'ready' ? {
                            ...proposals,
                            list: { ...proposals.list, selectedStation: detail.selectedStation,
                                items: proposals.list.items.map(item => ({ ...item, isSelected: item.station.id === detail.selectedStation?.id })) },
                        } : proposals}
                        onReload={
                            proposals.status === 'error'
                                ? retryProposals
                                : loadProposals
                        }
                        onConfirm={stationManager.choose}
                        confirmBusy={stationManager.busy}
                        onOpenRecommendations={openRecommendations}
                        mockProposeError={params.mock === 'propose-error'}
                        mockVoteError={params.mock === 'vote-error'}
                    />
                )}

                {!!notice && (
                    <View style={styles.notice} onLayout={({ nativeEvent }) => setNoticeHeight(nativeEvent.layout.height)}>
                        <Ionicons name="information-circle-outline" size={18} color={NAVY} />
                        <Text style={styles.noticeText}>{notice}</Text>
                    </View>
                )}
            </ScrollView>
            {detail && (
                <InviteCodeSheet
                    visible={sheet === 'invite'}
                    roomId={detail.id}
                    roomName={detail.name}
                    bottomInset={insets.bottom}
                    mockError={inviteFailNext}
                    onAccessError={handleAccessError}
                    onClose={() => {
                        setInviteFailNext(false);
                        setSheet(null);
                    }}
                />
            )}
            {sheet === 'leave' && (
                <RoomLeaveSheet
                    detail={detail}
                    bottomInset={insets.bottom}
                    mock={leaveMock}
                    onClose={() => setSheet(null)}
                    onLeft={result => {
                        setSheet(null);

                        const nextOwnerName = result.newOwnerId
                            ? detail.members.find(
                            member =>
                                member.userId === result.newOwnerId,
                        )?.nickname ?? '다른 참여자'
                            : '';

                        if (router.canDismiss()) {
                            router.dismissAll();
                        }

                        router.replace({
                            pathname: '/rooms',
                            params: {
                                leaveResult: result.roomDeleted
                                    ? 'deleted'
                                    : result.newOwnerId
                                        ? 'transferred'
                                        : 'left',
                                nextOwnerName,
                            },
                        });
                    }}
                />
            )}
        </KeyboardAvoidingView>
    );
}

function Header({ topInset, onBack, right }: { topInset: number; onBack: () => void; right?: ReactNode }) {
    return (
        <View style={[styles.header, { paddingTop: topInset + 10 }]}>
            <Text style={styles.headerTitle} pointerEvents="none">약속방</Text>
            <Pressable style={styles.iconButton} onPress={onBack} accessibilityLabel="뒤로 가기">
                <Ionicons name="chevron-back" size={25} color={NAVY} />
            </Pressable>
            <View style={styles.headerSide}>{right}</View>
        </View>
    );
}

function ErrorState({ error, onRetry }: { error: LoadError; onRetry: () => void }) {
    const content = {
        ROOM_NOT_FOUND: {
            icon: 'search-outline' as const,
            title: '약속방을 찾을 수 없어요',
            body: '삭제되었거나 없는 약속방이에요.',
            action: '약속방 목록으로',
            onPress: () => router.replace('/rooms'),
        },
        NOT_ROOM_MEMBER: {
            icon: 'lock-closed-outline' as const,
            title: '참여하지 않은 약속방이에요',
            body: '초대 코드를 받아 입장하면 볼 수 있어요.',
            action: '초대 코드로 입장',
            onPress: () => router.replace('/rooms/join'),
        },
        UNKNOWN: {
            icon: 'cloud-offline-outline' as const,
            title: '약속방 정보를 불러오지 못했어요',
            body: '네트워크 상태를 확인하고 다시 시도해 주세요.',
            action: '다시 시도',
            onPress: onRetry,
        },
    }[error];

    return (
        <View style={styles.center}>
            <Ionicons name={content.icon} size={40} color={SECONDARY} />
            <Text style={styles.stateTitle}>{content.title}</Text>
            <Text style={styles.caption}>{content.body}</Text>
            <Pressable style={styles.primaryButton} onPress={content.onPress}>
                <Text style={styles.primaryText}>{content.action}</Text>
            </Pressable>
            {error !== 'ROOM_NOT_FOUND' && (
                <Pressable onPress={() => router.replace('/rooms')} style={styles.linkButton}>
                    <Text style={styles.linkText}>약속방 목록으로</Text>
                </Pressable>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: BG },
    flex: { flex: 1 },
    header: { backgroundColor: BG, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
    headerTitle: { position: 'absolute', left: 0, right: 0, bottom: 18, textAlign: 'center', fontSize: 15, fontWeight: '600', color: NAVY },
    headerSide: { minWidth: 36, alignItems: 'flex-end' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
    codeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: '#EDE8F3' },
    codeText: { color: MINT, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
    content: { paddingHorizontal: 16, paddingTop: 8, gap: 10 },
    center: { flex: 1, margin: 16, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24, borderRadius: 24, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE },
    stateTitle: { color: NAVY, fontSize: 17, fontWeight: '800', marginTop: 6 },
    caption: { color: SECONDARY, fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
    primaryButton: { marginTop: 10, paddingHorizontal: 22, height: 46, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: MINT },
    primaryText: { color: WHITE, fontSize: 14.5, fontWeight: '800' },
    linkButton: { padding: 10 },
    linkText: { color: SECONDARY, fontSize: 13, fontWeight: '700' },

    // #224 글자 줄 맞춤: 카드 밖 제목·날짜 줄을 카드 안 글자 시작선에 맞춰요.
    titleBlock: { paddingHorizontal: ROOM_CARD_PADDING },
    roomCard: { padding: 14, backgroundColor: WHITE, borderRadius: 24, borderWidth: 1, borderColor: BORDER },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    chips: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
    statusChip: { alignSelf: 'flex-start', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9, backgroundColor: '#EDE8F3' },
    statusChipDone: { backgroundColor: '#EDE8F3' },
    statusText: { color: MINT, fontSize: 11, fontWeight: '700' },
    statusTextDone: { color: MINT },
    editButton: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, height: 28, borderRadius: 14, backgroundColor: '#EDE8F3' },
    editText: { color: MINT, fontSize: 12, fontWeight: '700' },
    roomName: { flex: 1, color: NAVY, fontSize: 26, fontWeight: '800' },
    infoRow: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
    infoText: { color: '#6F6B78', fontSize: 12, fontWeight: '600' },
    stationStrip: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
    stripLabel: { color: SECONDARY, fontSize: 11.5, fontWeight: '700' },
    stripCaption: { marginTop: 3, color: NAVY, fontSize: 14, fontWeight: '700' },
    stationRow: { marginTop: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 },
    lineBadge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    lineText: { color: WHITE, fontSize: 11, fontWeight: '800' },
    stationName: { color: NAVY, fontSize: 32, fontWeight: '800' },
    routeHint: { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#F4F1F7' },
    routeHintText: { flex: 1, color: '#6F6B78', fontSize: 12, fontWeight: '600' },
    stripButton: { paddingHorizontal: 13, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: MINT },
    stripButtonText: { color: WHITE, fontSize: 13, fontWeight: '800' },
    stripPrimary: { backgroundColor: MINT, borderColor: MINT },
    stripPrimaryText: { color: WHITE },

    panel: { paddingHorizontal: ROOM_CARD_PADDING, paddingVertical: 4 },
    cardTitle: { color: NAVY, fontSize: 14, fontWeight: '800', marginBottom: 2 },
    counter: { color: SECONDARY, fontSize: 12, fontWeight: '700' },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#ECE8F0' },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    memberName: { color: NAVY, fontSize: 14.5, fontWeight: '800' },
    meTag: { color: MINT, fontSize: 10.5, fontWeight: '700' },
    departureRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
    departure: { color: SECONDARY, fontSize: 12.5, fontWeight: '600' },
    departureSaving: { marginTop: 3, color: SECONDARY, fontSize: 12.5, fontWeight: '600' },
    departureError: { marginTop: 3, color: RED, fontSize: 12, fontWeight: '600' },
    departureSaved: { marginTop: 3, color: MINT_DEEP, fontSize: 12, fontWeight: '700' },
    lineDot: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    lineDotText: { color: WHITE, fontSize: 10, fontWeight: '800' },
    smallButtonBusy: { width: 76, borderColor: BORDER },
    smallButtonRetry: { backgroundColor: RED, borderColor: RED },
    departureEmpty: { marginTop: 3, color: '#A8A3B0', fontSize: 12.5 },
    smallButton: { paddingHorizontal: 10, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#D9CCE4', backgroundColor: WHITE, alignItems: 'center', justifyContent: 'center' },
    smallButtonText: { color: MINT, fontSize: 12, fontWeight: '700' },

    tabs: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: 22, backgroundColor: '#EDE8F3' },
    tab: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', height: 36, borderRadius: 18 },
    tabActive: { backgroundColor: WHITE },
    tabText: { color: SECONDARY, fontSize: 13, fontWeight: '700' },
    tabTextActive: { color: MINT, fontWeight: '800' },

    chatEmpty: { alignItems: 'center', paddingVertical: 22, gap: 6 },
    chatEmptyTitle: { color: NAVY, fontSize: 15, fontWeight: '800' },
    chatList: { gap: 8, paddingVertical: 8 },
    messageRow: { alignSelf: 'flex-start', maxWidth: '85%' },
    messageRowMine: { alignSelf: 'flex-end' },
    bubble: { backgroundColor: '#edf0f6', borderRadius: 15, paddingHorizontal: 13, paddingVertical: 9 },
    bubbleMine: { backgroundColor: NAVY },
    bubbleText: { color: NAVY, fontSize: 13.5, lineHeight: 20 },
    bubbleTextMine: { color: WHITE },
    composer: { marginTop: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
    chatInput: { flex: 1, height: 44, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, color: NAVY, backgroundColor: '#fafbfc', fontSize: 13.5 },
    sendButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: NAVY, borderRadius: 12 },
    mockNote: { marginTop: 8, color: '#a1a8b8', fontSize: 11.5 },

    disabled: { opacity: 0.45 },

    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#EDE8F3' },
    noticeText: { flex: 1, color: NAVY, fontSize: 12.5, lineHeight: 19 },

    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,28,63,0.45)' },
    sheet: { paddingHorizontal: 20, paddingTop: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: WHITE },
    sheetTitle: { color: NAVY, fontSize: 19, fontWeight: '800', marginBottom: 12 },
    sheetBody: { color: '#3c4559', fontSize: 14.5, lineHeight: 22, fontWeight: '600' },
    sheetHint: { marginTop: 8, color: SECONDARY, fontSize: 12.5, lineHeight: 19 },
    sheetButtons: { marginTop: 20, flexDirection: 'row', gap: 10 },
    sheetButton: { flex: 1, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    sheetCancel: { backgroundColor: '#eef1f5' },
    sheetCancelText: { color: NAVY, fontSize: 15, fontWeight: '800' },
    sheetPrimary: { backgroundColor: NAVY },
    sheetDanger: { backgroundColor: RED },
    sheetConfirmText: { color: WHITE, fontSize: 15, fontWeight: '800' },
    errorText: { marginTop: 10, color: RED, fontSize: 13, fontWeight: '700' },
});
