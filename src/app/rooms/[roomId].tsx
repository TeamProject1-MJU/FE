import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
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
import { RoomError, type RoomDetail } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const WHITE = '#ffffff';
const BG = '#f3f5f8';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';
const RED = '#d6455d';
const ORANGE = '#c77a00';
const GOLD = '#f2b705';

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
 * - 하위 화면(추천·출발역 입력)에서 돌아오면 다시 조회해서 바뀐 mock 상태를 보여줍니다.
 *
 * 테스트용:
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
 * TODO: 실제 API·권한 검사·WebSocket 채팅은 후속 이슈에서 연동합니다.
 */
export default function RoomDetailScreen() {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ roomId: string; mock?: string; tab?: string }>();
    // 홈 '다가오는 약속' 카드(roomId: preview)는 같은 mock 방(room-2)으로 엽니다.
    const baseRoomId =
        params.roomId === 'preview'
            ? 'room-2'
            : String(params.roomId);

    const leaveScenario = parseLeaveRoomScenario(params.mock);

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

    const [detail, setDetail] = useState<RoomDetail | null>(null);
    const [loadError, setLoadError] = useState<LoadError | null>(null);
    /** 헤더 칩 미리보기용 초대 코드 (7.9). 실패해도 칩은 남겨 두고 시트에서 다시 시도합니다 */
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    /** 약속역 후보 목록 (7.15). 방 상세와 따로 불러와서 실패해도 방 화면은 그대로 보여줘요 */
    const [proposals, setProposals] = useState<ProposalState>({ status: 'loading' });
    const [tab, setTab] = useState<Tab>(params.tab === 'vote' ? 'vote' : 'chat');
    const [sheet, setSheet] = useState<Sheet>(null);
    const [notice, setNotice] = useState('');

    /** 7.15 후보 목록 재조회 (제안·삭제·투표·확정 후, 화면 복귀 시) */
    const loadProposals = useCallback(async () => {
        try {
            if (!proposalsFillApplied.current && params.mock === 'proposals-full') {
                proposalsFillApplied.current = true;
                mockFillProposals(roomId);
            }
            const fail = proposalsFailNext.current;
            proposalsFailNext.current = false; // 다시 시도하면 성공하도록
            const list = await fetchProposals(roomId, fail ? 'error' : undefined);
            setProposals({ status: 'ready', list });
        } catch (error) {
            setProposals({ status: 'error', message: error instanceof RoomError ? error.message : '네트워크 상태를 확인하고 다시 시도해 주세요.' });
        }
    }, [roomId, params.mock]);

    const retryProposals = useCallback(async () => {
        setProposals({ status: 'loading' });
        await loadProposals();
    }, [loadProposals]);

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            prepareLeaveMock(roomId, leaveScenario);

            const fail = failNext.current;
            failNext.current = false; // 다시 시도하면 성공하도록
            // 방장 변경 mock (#47): 진입 시 한 번만 적용. 실제로는 7.8 승계·탈퇴로만 바뀝니다
            if (!ownerMockApplied.current && (params.mock === 'owner-give' || params.mock === 'owner-take')) {
                ownerMockApplied.current = true;
                mockTransferOwner(roomId, params.mock === 'owner-give' ? 'give' : 'take');
            }
            const room = await fetchRoomDetail(roomId, fail ? 'error' : undefined);
            setDetail(room);
            loadProposals();
            // 초대 코드는 현재 OWNER 일 때만 7.9 로 따로 조회 (상세 응답엔 없음). 실패해도 상세는 그대로 보여줍니다
            if (room.myRole === 'OWNER') {
                try {
                    setInviteCode((await fetchInviteCode(roomId)).roomCode);
                } catch {
                    setInviteCode(null);
                }
            } else {
                setInviteCode(null);
            }
        } catch (error) {
            setDetail(null);
            const code = error instanceof RoomError ? error.code : null;
            setLoadError(code === 'ROOM_NOT_FOUND' || code === 'NOT_ROOM_MEMBER' ? code : 'UNKNOWN');
        }
    }, [roomId, params.mock, loadProposals, leaveScenario]);

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
            load();
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
        if (!detail) return;
        setDepartureSaving(station);
        setDepartureFailed(null);
        setNotice('');
        try {
            const fail = departureFailNext.current;
            departureFailNext.current = undefined; // 다시 시도하면 성공하도록
            await updateMyDeparture(detail.id, { departureStationId: station.id }, fail);
            setDepartureSaving(null);
            await load(); // 방 상세·멤버 목록에 반영 (7.4/7.6 재조회)
            setDepartureSaved(`${station.name}으로 설정했어요`);
            setTimeout(() => setDepartureSaved(null), 2500);
        } catch (error) {
            const message = error instanceof RoomError ? error.message : '출발역을 저장하지 못했어요. 다시 시도해 주세요.';
            const retryable = !(error instanceof RoomError) || error.code === 'NETWORK_ERROR' || error.code === 'ROOM_BUSY';
            setDepartureFailed(retryable ? { station, message } : null);
            setNotice(message);
        } finally {
            setDepartureSaving(null);
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
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                contentContainerStyle={[
                    styles.content,
                    { paddingBottom: insets.bottom + 32 },
                ]}
            >
                {/* 방 정보 카드 */}
                <View style={styles.roomCard}>
                    <View style={styles.rowBetween}>
                        <View style={styles.chips}>
                            <View style={[styles.statusChip, station && styles.statusChipDone]}>
                                <Text style={[styles.statusText, station && styles.statusTextDone]}>
                                    {station ? '약속역 확정' : '약속역 정하는 중'}
                                </Text>
                            </View>
                            <View style={styles.roleChip}>
                                <Text style={styles.roleText}>{isOwner ? '내 역할 · 방장' : '내 역할 · 멤버'}</Text>
                            </View>
                        </View>
                        {/* 그림 28 ❾ 방 정보 수정: 방장만 */}
                        {isOwner && (
                            <Pressable style={styles.editButton} onPress={() => router.push(`/rooms/${detail.id}/edit`)} accessibilityRole="button">
                                <Ionicons name="create-outline" size={14} color={WHITE} />
                                <Text style={styles.editText}>수정</Text>
                            </Pressable>
                        )}
                    </View>

                    <Text style={styles.roomName}>{detail.name}</Text>
                    <View style={styles.infoRow}>
                        <Ionicons name="calendar-outline" size={15} color="#c7cfdf" />
                        <Text style={styles.infoText}>
                            {at ? `${formatMonthDay(at)} ${formatTime(at)} · ${formatDday(at)}` : '약속 시각 미정'}
                        </Text>
                        <Ionicons name="people-outline" size={15} color="#c7cfdf" style={{ marginLeft: 10 }} />
                        <Text style={styles.infoText}>{detail.memberCount}/{detail.maxMembers}명</Text>
                    </View>

                    {/* 약속역: 확정 / 미확정 */}
                    <View style={styles.stationStrip}>
                        {station ? (
                            <>
                                <View style={styles.flex}>
                                    <Text style={styles.stripLabel}>약속역</Text>
                                    <View style={styles.stationRow}>
                                        {station.lines?.map(line => (
                                            <View key={line.lineId} style={[styles.lineBadge, { backgroundColor: line.color }]}>
                                                <Text style={styles.lineText}>{line.lineName.replace('호선', '')}</Text>
                                            </View>
                                        ))}
                                        <Text style={styles.stationName}>{station.name}</Text>
                                    </View>
                                </View>
                            </>
                        ) : (
                            <>
                                <View style={styles.flex}>
                                    <Text style={styles.stripLabel}>약속역 미정</Text>
                                    <Text style={styles.stripCaption}>
                                        {proposalItems.length === 0
                                            ? '아직 약속역을 정하지 않았어요'
                                            : leaders.length === 1
                                                ? `후보 ${proposalItems.length}개 · ${leaders[0].station.name}역 ${topVotes}표로 검토 중`
                                                : `후보 ${proposalItems.length}개 검토 중`}
                                    </Text>
                                </View>
                                <Pressable style={[styles.stripButton, styles.stripPrimary]} onPress={openRecommendations}>
                                    <Text style={[styles.stripButtonText, styles.stripPrimaryText]}>추천받기</Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                </View>
                <SelectedStationControls
                    detail={detail}
                    controller={stationManager}
                    bottomInset={insets.bottom}
                />

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
                                <View style={[styles.avatar, mine && styles.avatarMine]}>
                                    <Text style={styles.avatarText}>{Array.from(member.nickname)[0]}</Text>
                                    {member.role === 'OWNER' && (
                                        <View style={styles.crown}>
                                            <Ionicons name="star" size={9} color={WHITE} />
                                        </View>
                                    )}
                                </View>
                                <View style={styles.flex}>
                                    <View style={styles.nameRow}>
                                        <Text style={styles.memberName}>{member.nickname}</Text>
                                        {member.role === 'OWNER' && <Text style={styles.ownerTag}>방장</Text>}
                                        {mine && <Text style={styles.meTag}>나</Text>}
                                    </View>
                                    {mine && departureSaving ? (
                                        <Text style={styles.departureSaving} numberOfLines={1}>{departureSaving.name}으로 저장하는 중…</Text>
                                    ) : member.departureStation ? (
                                        <View style={styles.departureRow}>
                                            <Text style={styles.departure}>출발 · {member.departureStation.name}</Text>
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
                <View style={styles.tabs}>
                    {([
                        ['chat', '채팅', 'chatbubble-ellipses-outline'],
                        ['vote', proposals.status === 'ready' ? `약속역 후보 ${proposalItems.length}` : '약속역 후보', 'checkbox-outline'],
                    ] as const).map(([key, title, icon]) => (
                        <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => { setTab(key); setNotice(''); }}>
                            <Ionicons name={icon} size={17} color={tab === key ? NAVY : SECONDARY} />
                            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{title}</Text>
                        </Pressable>
                    ))}
                </View>

                {tab === 'chat' ? (
                    <RoomChatPanel
                        key={chat.scope}
                        controller={chat}
                        myUserId={myUserId}
                        members={detail.members}
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
                        state={proposals}
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
                    <View style={styles.notice}>
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
    header: { backgroundColor: WHITE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1, borderColor: BORDER },
    headerTitle: { position: 'absolute', left: 0, right: 0, bottom: 20, textAlign: 'center', fontSize: 18, fontWeight: '800', color: NAVY },
    headerSide: { minWidth: 36, alignItems: 'flex-end' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
    codeChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 30, borderRadius: 15, backgroundColor: '#eafbf5', borderWidth: 1, borderColor: '#bfeedd' },
    codeText: { color: NAVY, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
    content: { padding: 16, gap: 12 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 28 },
    stateTitle: { color: NAVY, fontSize: 17, fontWeight: '800', marginTop: 6 },
    caption: { color: SECONDARY, fontSize: 12.5, lineHeight: 19, textAlign: 'center' },
    primaryButton: { marginTop: 10, paddingHorizontal: 22, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: NAVY },
    primaryText: { color: WHITE, fontSize: 14.5, fontWeight: '800' },
    linkButton: { padding: 10 },
    linkText: { color: SECONDARY, fontSize: 13, fontWeight: '700' },

    roomCard: { padding: 18, backgroundColor: NAVY, borderRadius: 20 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    chips: { flexDirection: 'row', gap: 6, flexShrink: 1, flexWrap: 'wrap' },
    statusChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9, backgroundColor: '#2a3a63' },
    statusChipDone: { backgroundColor: '#1d4a4a' },
    statusText: { color: '#c7cfdf', fontSize: 11, fontWeight: '800' },
    statusTextDone: { color: MINT },
    roleChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9, borderWidth: 1, borderColor: '#3a4a73' },
    roleText: { color: '#dfe5f1', fontSize: 11, fontWeight: '700' },
    editButton: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 10, height: 28, borderRadius: 9, backgroundColor: '#2a3a63' },
    editText: { color: WHITE, fontSize: 12, fontWeight: '800' },
    roomName: { marginTop: 14, color: WHITE, fontSize: 22, fontWeight: '900' },
    infoRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
    infoText: { color: '#dfe5f1', fontSize: 13, fontWeight: '600' },
    stationStrip: { marginTop: 16, padding: 12, borderRadius: 14, backgroundColor: '#1b2b55', flexDirection: 'row', alignItems: 'center', gap: 10 },
    stripLabel: { color: '#aeb8cf', fontSize: 11.5, fontWeight: '700' },
    stripCaption: { marginTop: 3, color: WHITE, fontSize: 14, fontWeight: '700' },
    stationRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 5 },
    lineBadge: { minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    lineText: { color: WHITE, fontSize: 11, fontWeight: '900' },
    stationName: { marginLeft: 2, color: WHITE, fontSize: 17, fontWeight: '900' },
    stripButton: { paddingHorizontal: 13, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#4a5a83' },
    stripButtonText: { color: WHITE, fontSize: 13, fontWeight: '800' },
    stripPrimary: { backgroundColor: MINT, borderColor: MINT },
    stripPrimaryText: { color: NAVY },

    panel: { backgroundColor: WHITE, borderWidth: 1, borderColor: BORDER, borderRadius: 18, padding: 16 },
    cardTitle: { color: NAVY, fontSize: 16, fontWeight: '800', marginBottom: 6 },
    counter: { color: SECONDARY, fontSize: 12, fontWeight: '700' },
    memberRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, borderTopWidth: 1, borderTopColor: '#f0f2f6' },
    avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#eef1f6', alignItems: 'center', justifyContent: 'center' },
    avatarMine: { backgroundColor: '#e3f8f0' },
    avatarText: { color: NAVY, fontSize: 15, fontWeight: '800' },
    crown: { position: 'absolute', right: -2, top: -2, width: 16, height: 16, borderRadius: 8, backgroundColor: GOLD, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: WHITE },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    memberName: { color: NAVY, fontSize: 14.5, fontWeight: '800' },
    ownerTag: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: '#fff4cf', color: '#9a6a00', fontSize: 10.5, fontWeight: '800' },
    meTag: { overflow: 'hidden', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, backgroundColor: '#e3f8f0', color: MINT_DEEP, fontSize: 10.5, fontWeight: '800' },
    departureRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, flexWrap: 'wrap' },
    departure: { color: SECONDARY, fontSize: 12.5, fontWeight: '600' },
    departureSaving: { marginTop: 3, color: SECONDARY, fontSize: 12.5, fontWeight: '600' },
    departureError: { marginTop: 3, color: RED, fontSize: 12, fontWeight: '600' },
    departureSaved: { marginTop: 3, color: MINT_DEEP, fontSize: 12, fontWeight: '700' },
    lineDot: { minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
    lineDotText: { color: WHITE, fontSize: 10, fontWeight: '800' },
    smallButtonBusy: { width: 76, borderColor: BORDER },
    smallButtonRetry: { backgroundColor: RED, borderColor: RED },
    departureEmpty: { marginTop: 3, color: ORANGE, fontSize: 12.5, fontWeight: '700' },
    smallButton: { paddingHorizontal: 10, height: 32, borderRadius: 9, borderWidth: 1, borderColor: NAVY, alignItems: 'center', justifyContent: 'center' },
    smallButtonText: { color: NAVY, fontSize: 12, fontWeight: '800' },

    tabs: { flexDirection: 'row', gap: 8 },
    tab: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: WHITE, height: 42, borderRadius: 12, borderWidth: 1, borderColor: BORDER },
    tabActive: { backgroundColor: '#eafbf5', borderColor: MINT },
    tabText: { color: SECONDARY, fontSize: 13, fontWeight: '700' },
    tabTextActive: { color: NAVY, fontWeight: '800' },

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

    notice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#e9edf5' },
    noticeText: { flex: 1, color: NAVY, fontSize: 12.5, lineHeight: 19 },

    backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,28,63,0.45)' },
    sheet: { paddingHorizontal: 20, paddingTop: 22, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: WHITE },
    sheetTitle: { color: NAVY, fontSize: 19, fontWeight: '900', marginBottom: 12 },
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
