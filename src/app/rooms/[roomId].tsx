import { useCallback, useRef, useState, type ReactNode } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { CalendarModal, TimeWheelModal } from '@/components/rooms/appointment-picker';
import InviteCodeSheet from '@/components/rooms/invite-code-sheet';
import { formatDday, formatMonthDay, formatTime } from '@/constants/home-mock';
import {
    deleteCandidate,
    fetchCandidates,
    fetchInviteCode,
    fetchRoomDetail,
    getMyUserId,
    leaveRoom,
    mockTransferOwner,
    previewLeave,
    proposeCandidate,
    ROOM_NAME_MAX,
    roomNameLength,
    setSelectedStation,
    updateRoom,
    voteCandidate,
} from '@/services/room';
import { RoomError, type RoomCandidate, type RoomDetail, type RoomStation } from '@/types/room';

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
type ChatMessage = { id: string; mine: boolean; sender: string; text: string };
type Sheet = 'edit' | 'leave' | 'station' | 'invite' | null;
type LoadError = 'ROOM_NOT_FOUND' | 'NOT_ROOM_MEMBER' | 'UNKNOWN';

/** 후보 제안용 예시 역 (TODO: 역 검색 화면 연결 후 stationId 로 교체) */
const STATION_OPTIONS: RoomStation[] = [
    { id: 105, name: '강남', lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
    { id: 108, name: '왕십리', lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
    { id: 109, name: '사당', lines: [{ lineId: 4, lineName: '4호선', color: '#00A5DE' }] },
    { id: 106, name: '홍대입구', lines: [{ lineId: 2, lineName: '2호선', color: '#00A84D' }] },
    { id: 110, name: '서울역', lines: [{ lineId: 1, lineName: '1호선', color: '#0052A4' }] },
];

const pad = (value: number) => String(value).padStart(2, '0');
const toDateValue = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

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
 * TODO: 실제 API·권한 검사·WebSocket 채팅은 후속 이슈에서 연동합니다.
 */
export default function RoomDetailScreen() {
    const insets = useSafeAreaInsets();
    const params = useLocalSearchParams<{ roomId: string; mock?: string }>();
    // 홈 '다가오는 약속' 카드(roomId: preview)는 같은 mock 방(room-2)으로 엽니다.
    const roomId = params.roomId === 'preview' ? 'room-2' : String(params.roomId);
    const failNext = useRef(params.mock === 'error');
    const inviteFailNext = useRef(params.mock === 'invite-error');
    const ownerMockApplied = useRef(false);
    const myUserId = getMyUserId();

    const [detail, setDetail] = useState<RoomDetail | null>(null);
    const [loadError, setLoadError] = useState<LoadError | null>(null);
    /** 헤더 칩 미리보기용 초대 코드 (7.9). 실패해도 칩은 남겨 두고 시트에서 다시 시도합니다 */
    const [inviteCode, setInviteCode] = useState<string | null>(null);
    const [candidates, setCandidates] = useState<RoomCandidate[]>([]);
    const [tab, setTab] = useState<Tab>('chat');
    const [sheet, setSheet] = useState<Sheet>(null);
    const [notice, setNotice] = useState('');
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [messageInput, setMessageInput] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const fail = failNext.current;
            failNext.current = false; // 다시 시도하면 성공하도록
            // 방장 변경 mock (#47): 진입 시 한 번만 적용. 실제로는 7.8 승계·탈퇴로만 바뀝니다
            if (!ownerMockApplied.current && (params.mock === 'owner-give' || params.mock === 'owner-take')) {
                ownerMockApplied.current = true;
                mockTransferOwner(roomId, params.mock === 'owner-give' ? 'give' : 'take');
            }
            const room = await fetchRoomDetail(roomId, fail ? 'error' : undefined);
            setDetail(room);
            const list = await fetchCandidates(roomId);
            setCandidates(list);
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
    }, [roomId, params.mock]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load]),
    );

    const back = () => (router.canGoBack() ? router.back() : router.replace('/rooms'));
    const isOwner = detail?.myRole === 'OWNER';

    const run = async (task: () => Promise<void>, success?: string) => {
        setBusy(true);
        setNotice('');
        try {
            await task();
            await load();
            if (success) setNotice(success);
        } catch (error) {
            setNotice(error instanceof RoomError ? error.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.');
        } finally {
            setBusy(false);
        }
    };


    /** 추천받기·내 출발역 설정: 출발역·조건 입력 화면 (그림 30) */
    const openRecommendations = () => {
        if (!detail) return;
        router.push({
            pathname: '/rooms/[roomId]/recommendations',
            params: { roomId: detail.id, roomName: detail.name, maxMembers: String(detail.maxMembers) },
        });
    };

    const sendMessage = () => {
        const value = messageInput.trim();
        if (!value) return;
        const me = detail?.members.find(item => item.userId === myUserId);
        setMessages(prev => [...prev, { id: `m-${Date.now()}`, mine: true, sender: me?.nickname ?? '나', text: value }]);
        setMessageInput('');
        if (value.toLowerCase().includes('@linkro')) setNotice('@LinkRo AI 응답은 채팅·AI API 연동 후 받을 수 있어요.');
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
    const iVoted = candidates.some(item => item.votedByMe);

    return (
        <View style={styles.root}>
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

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
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
                            <Pressable style={styles.editButton} onPress={() => setSheet('edit')} accessibilityRole="button">
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
                                {isOwner && (
                                    <Pressable style={styles.stripButton} onPress={() => setSheet('station')}>
                                        <Text style={styles.stripButtonText}>관리</Text>
                                    </Pressable>
                                )}
                            </>
                        ) : (
                            <>
                                <View style={styles.flex}>
                                    <Text style={styles.stripLabel}>약속역 미정</Text>
                                    <Text style={styles.stripCaption}>아직 약속역을 정하지 않았어요</Text>
                                </View>
                                <Pressable style={[styles.stripButton, styles.stripPrimary]} onPress={openRecommendations}>
                                    <Text style={[styles.stripButtonText, styles.stripPrimaryText]}>추천받기</Text>
                                </Pressable>
                            </>
                        )}
                    </View>
                </View>

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
                                    {member.departureStation ? (
                                        <Text style={styles.departure}>출발 · {member.departureStation.name}</Text>
                                    ) : (
                                        <Text style={styles.departureEmpty}>출발역 미설정</Text>
                                    )}
                                </View>
                                {/* 출발역 편집은 내 카드에만 */}
                                {mine && (
                                    <Pressable style={styles.smallButton} onPress={openRecommendations} accessibilityRole="button">
                                        <Text style={styles.smallButtonText}>{member.departureStation ? '출발역 변경' : '출발역 설정'}</Text>
                                    </Pressable>
                                )}
                            </View>
                        );
                    })}
                </View>

                {/* 채팅 · 후보/투표 */}
                <View style={styles.tabs}>
                    {([
                        ['chat', '채팅', 'chatbubble-ellipses-outline'],
                        ['vote', `약속역 후보 ${candidates.length}`, 'checkbox-outline'],
                    ] as const).map(([key, title, icon]) => (
                        <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => { setTab(key); setNotice(''); }}>
                            <Ionicons name={icon} size={17} color={tab === key ? NAVY : SECONDARY} />
                            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{title}</Text>
                        </Pressable>
                    ))}
                </View>

                {tab === 'chat' ? (
                    <View style={styles.panel}>
                        {messages.length === 0 ? (
                            <View style={styles.chatEmpty}>
                                <Ionicons name="chatbubbles-outline" size={30} color="#b9c0cc" />
                                <Text style={styles.chatEmptyTitle}>대화를 시작해보세요</Text>
                                <Text style={styles.caption}>@LinkRo 를 부르면 AI가 약속 정하는 걸 도와줘요</Text>
                            </View>
                        ) : (
                            <View style={styles.chatList}>
                                {messages.map(message => (
                                    <View key={message.id} style={[styles.messageRow, message.mine && styles.messageRowMine]}>
                                        <View style={[styles.bubble, message.mine && styles.bubbleMine]}>
                                            <Text style={[styles.bubbleText, message.mine && styles.bubbleTextMine]}>{message.text}</Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        )}
                        <View style={styles.composer}>
                            <TextInput
                                style={styles.chatInput}
                                placeholder="메시지 입력 · @LinkRo"
                                placeholderTextColor="#a1a8b8"
                                value={messageInput}
                                onChangeText={setMessageInput}
                                maxLength={500}
                                onSubmitEditing={sendMessage}
                            />
                            <Pressable style={styles.sendButton} onPress={sendMessage} accessibilityLabel="보내기">
                                <Ionicons name="arrow-up" size={20} color={WHITE} />
                            </Pressable>
                        </View>
                        <Text style={styles.mockNote}>채팅은 화면 미리보기예요. 실시간 채팅은 연동 후 제공돼요.</Text>
                    </View>
                ) : (
                    <View style={styles.panel}>
                        <View style={styles.rowBetween}>
                            <Text style={styles.cardTitle}>약속역 후보</Text>
                            <Text style={styles.counter}>{candidates.length}/5</Text>
                        </View>
                        <Text style={styles.panelCaption}>
                            1인 1표, 투표 후에는 바꿀 수 없어요.{' '}
                            {isOwner ? '투표를 참고해 방장이 약속역을 확정해요.' : '방장이 최종 확정할 수 있어요.'}
                        </Text>

                        {candidates.length === 0 && <Text style={styles.emptyLine}>아직 후보가 없어요. 추천받거나 직접 제안해 보세요.</Text>}

                        {candidates.map(candidate => {
                            const confirmed = station?.id === candidate.station.id;
                            const canDelete = isOwner || candidate.proposerId === myUserId;
                            return (
                                <View key={candidate.id} style={[styles.candidate, confirmed && styles.candidateConfirmed]}>
                                    <View style={styles.rowBetween}>
                                        <View style={styles.nameRow}>
                                            <Text style={styles.candidateName}>{candidate.station.name}</Text>
                                            {confirmed && <Text style={styles.confirmedTag}>확정</Text>}
                                        </View>
                                        <Text style={styles.counter}>{candidate.voteCount}표</Text>
                                    </View>
                                    <Text style={styles.proposer}>제안 · {candidate.proposerNickname}</Text>
                                    <View style={styles.candidateActions}>
                                        <Pressable
                                            style={[styles.voteButton, candidate.votedByMe && styles.voted, iVoted && !candidate.votedByMe && styles.disabled]}
                                            disabled={iVoted || busy}
                                            onPress={() => run(() => voteCandidate(detail.id, candidate.id), '투표했어요.')}
                                        >
                                            <Ionicons name={candidate.votedByMe ? 'checkmark-circle' : 'hand-left-outline'} size={15} color={candidate.votedByMe ? WHITE : NAVY} />
                                            <Text style={[styles.voteText, candidate.votedByMe && styles.votedText]}>
                                                {candidate.votedByMe ? '내 투표' : '투표'}
                                            </Text>
                                        </Pressable>
                                        {isOwner && !confirmed && (
                                            <Pressable
                                                style={styles.confirmButton}
                                                disabled={busy}
                                                onPress={() => run(() => setSelectedStation(detail.id, candidate.station), `${candidate.station.name}(으)로 약속역을 확정했어요.`)}
                                            >
                                                <Text style={styles.confirmText}>약속역으로 확정</Text>
                                            </Pressable>
                                        )}
                                        {canDelete && (
                                            <Pressable
                                                style={styles.deleteButton}
                                                disabled={busy}
                                                onPress={() => run(() => deleteCandidate(detail.id, candidate.id), '후보를 삭제했어요.')}
                                            >
                                                <Text style={styles.deleteText}>삭제</Text>
                                            </Pressable>
                                        )}
                                    </View>
                                </View>
                            );
                        })}

                        <Text style={[styles.cardTitle, { marginTop: 18 }]}>후보 제안</Text>
                        <View style={styles.stationChips}>
                            {STATION_OPTIONS.filter(option => !candidates.some(item => item.station.id === option.id)).map(option => (
                                <Pressable
                                    key={option.id}
                                    style={styles.stationChip}
                                    disabled={busy}
                                    onPress={() => run(() => proposeCandidate(detail.id, option), `${option.name}을(를) 후보로 제안했어요.`)}
                                >
                                    <Ionicons name="add" size={14} color={NAVY} />
                                    <Text style={styles.stationChipText}>{option.name}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </View>
                )}

                {!!notice && (
                    <View style={styles.notice}>
                        <Ionicons name="information-circle-outline" size={18} color={NAVY} />
                        <Text style={styles.noticeText}>{notice}</Text>
                    </View>
                )}
            </ScrollView>

            {sheet === 'edit' && (
                <EditSheet
                    detail={detail}
                    bottomInset={insets.bottom}
                    onClose={() => setSheet(null)}
                    onSaved={async message => {
                        setSheet(null);
                        await load();
                        setNotice(message);
                    }}
                />
            )}
            {detail && (
                <InviteCodeSheet
                    visible={sheet === 'invite'}
                    roomId={detail.id}
                    roomName={detail.name}
                    bottomInset={insets.bottom}
                    mockError={inviteFailNext.current}
                    onClose={() => {
                        inviteFailNext.current = false;
                        setSheet(null);
                    }}
                />
            )}
            {sheet === 'leave' && (
                <LeaveSheet
                    detail={detail}
                    bottomInset={insets.bottom}
                    onClose={() => setSheet(null)}
                    onLeft={() => {
                        setSheet(null);
                        router.replace('/rooms');
                    }}
                />
            )}
            {sheet === 'station' && station && (
                <BottomSheet bottomInset={insets.bottom} onClose={() => setSheet(null)}>
                    <Text style={styles.sheetTitle}>약속역 관리</Text>
                    <Text style={styles.sheetBody}>
                        지금 약속역은 {station.name}이에요. 다른 역으로 바꾸려면 후보에서 '약속역으로 확정'을 누르세요.
                    </Text>
                    <Text style={styles.sheetHint}>해제해도 약속역 후보와 투표는 그대로 남아요.</Text>
                    <SheetButtons
                        cancel="닫기"
                        confirm="약속역 해제"
                        danger
                        busy={busy}
                        onCancel={() => setSheet(null)}
                        onConfirm={async () => {
                            await run(() => setSelectedStation(detail.id, null), '약속역을 해제했어요.');
                            setSheet(null);
                        }}
                    />
                </BottomSheet>
            )}
        </View>
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

function BottomSheet({ children, bottomInset, onClose }: { children: ReactNode; bottomInset: number; onClose: () => void }) {
    return (
        <Modal transparent animationType="fade" visible onRequestClose={onClose}>
            <View style={styles.backdrop}>
                <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                <View style={[styles.sheet, { paddingBottom: bottomInset + 20 }]}>{children}</View>
            </View>
        </Modal>
    );
}

function SheetButtons({
                          cancel,
                          confirm,
                          danger,
                          busy,
                          onCancel,
                          onConfirm,
                      }: {
    cancel: string;
    confirm: string;
    danger?: boolean;
    busy?: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}) {
    return (
        <View style={styles.sheetButtons}>
            <Pressable style={[styles.sheetButton, styles.sheetCancel]} onPress={onCancel} disabled={busy}>
                <Text style={styles.sheetCancelText}>{cancel}</Text>
            </Pressable>
            <Pressable style={[styles.sheetButton, danger ? styles.sheetDanger : styles.sheetPrimary, busy && styles.disabled]} onPress={onConfirm} disabled={busy}>
                {busy ? <ActivityIndicator color={WHITE} /> : <Text style={styles.sheetConfirmText}>{confirm}</Text>}
            </Pressable>
        </View>
    );
}

/** 그림 31 방 정보 수정 (OWNER, 명세 7.5) */
function EditSheet({
                       detail,
                       bottomInset,
                       onClose,
                       onSaved,
                   }: {
    detail: RoomDetail;
    bottomInset: number;
    onClose: () => void;
    onSaved: (message: string) => void;
}) {
    const initial = detail.appointmentAt ? new Date(detail.appointmentAt) : null;
    const [name, setName] = useState(detail.name);
    const [date, setDate] = useState(initial ? toDateValue(initial) : '');
    const [time, setTime] = useState(initial ? formatTime(initial) : '');
    const [calendarOpen, setCalendarOpen] = useState(false);
    const [timeOpen, setTimeOpen] = useState(false);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const length = roomNameLength(name);

    const save = async () => {
        if (length === 0) return setError('약속방 이름을 입력해 주세요.');
        if (length > ROOM_NAME_MAX) return setError(`약속방 이름은 ${ROOM_NAME_MAX}자까지 쓸 수 있어요.`);
        if (!!date !== !!time) return setError('약속 날짜와 시간을 모두 고르거나, 둘 다 비워 두세요.');

        let at: Date | null = null;
        if (date && time) {
            const [y, m, d] = date.split('-').map(Number);
            const [h, min] = time.split(':').map(Number);
            at = new Date(y, m - 1, d, h, min);
            if (at.getTime() < Date.now()) return setError('현재 이후의 약속 날짜와 시간을 선택해 주세요.');
        }

        const patch: { name?: string; appointmentAt?: string | null } = {};
        if (name.trim() !== detail.name) patch.name = name;
        const nextAt = at ? at.toISOString() : null;
        const timeChanged = (initial?.getTime() ?? null) !== (at?.getTime() ?? null);
        if (timeChanged) patch.appointmentAt = nextAt;
        if (Object.keys(patch).length === 0) return onClose();

        setSaving(true);
        setError('');
        try {
            await updateRoom(detail.id, patch);
            onSaved(timeChanged ? '저장했어요. 약속 시각이 바뀌어 이전 추천 결과는 최신이 아니에요.' : '저장했어요.');
        } catch (caught) {
            setError(caught instanceof RoomError ? caught.message : '저장하지 못했어요. 다시 시도해 주세요.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <BottomSheet bottomInset={bottomInset} onClose={onClose}>
            <Text style={styles.sheetTitle}>방 정보 수정</Text>

            <View style={styles.rowBetween}>
                <Text style={styles.fieldLabel}>약속방 이름</Text>
                <Text style={[styles.counter, length > ROOM_NAME_MAX && { color: RED }]}>{length}/{ROOM_NAME_MAX}</Text>
            </View>
            <TextInput style={[styles.input, length > ROOM_NAME_MAX && { borderColor: RED }]} value={name} onChangeText={value => { setName(value); setError(''); }} />

            <Text style={styles.fieldLabel}>약속 시각 <Text style={styles.optional}>(선택)</Text></Text>
            <View style={styles.pickRow}>
                <Pressable style={styles.pickBox} onPress={() => setCalendarOpen(true)}>
                    <Ionicons name="calendar-outline" size={18} color={NAVY} />
                    <Text style={[styles.pickText, !date && styles.placeholder]}>{date || '날짜'}</Text>
                </Pressable>
                <Pressable style={styles.pickBox} onPress={() => setTimeOpen(true)}>
                    <Ionicons name="time-outline" size={18} color={NAVY} />
                    <Text style={[styles.pickText, !time && styles.placeholder]}>{time || '시간'}</Text>
                </Pressable>
            </View>
            {(date || time) && (
                <Pressable onPress={() => { setDate(''); setTime(''); setError(''); }} style={styles.clearLink}>
                    <Ionicons name="close-circle" size={15} color={SECONDARY} />
                    <Text style={styles.clearText}>약속 시각 지우기</Text>
                </Pressable>
            )}
            <View style={styles.staleNote}>
                <Ionicons name="alert-circle-outline" size={16} color={ORANGE} />
                <Text style={styles.staleText}>약속 시각이 바뀌면 이전 추천 결과는 최신이 아니게 돼요.</Text>
            </View>

            {!!error && <Text style={styles.errorText}>{error}</Text>}
            <SheetButtons cancel="취소" confirm="저장" busy={saving} onCancel={onClose} onConfirm={save} />

            <CalendarModal visible={calendarOpen} value={date} onClose={() => setCalendarOpen(false)} onConfirm={value => { setDate(value); setError(''); }} />
            <TimeWheelModal visible={timeOpen} value={time || '19:00'} onClose={() => setTimeOpen(false)} onConfirm={value => { setTime(value); setError(''); }} />
        </BottomSheet>
    );
}

/** 그림 32 방 나가기 (명세 7.8) */
function LeaveSheet({
                        detail,
                        bottomInset,
                        onClose,
                        onLeft,
                    }: {
    detail: RoomDetail;
    bottomInset: number;
    onClose: () => void;
    onLeft: () => void;
}) {
    const [leaving, setLeaving] = useState(false);
    const [error, setError] = useState('');
    const { willDelete, nextOwner } = previewLeave(detail);

    const leave = async () => {
        setLeaving(true);
        setError('');
        try {
            await leaveRoom(detail.id);
            onLeft();
        } catch {
            setError('나가지 못했어요. 다시 시도해 주세요.');
            setLeaving(false);
        }
    };

    return (
        <BottomSheet bottomInset={bottomInset} onClose={onClose}>
            <Text style={styles.sheetTitle}>약속방에서 나갈까요?</Text>
            <Text style={styles.sheetBody}>
                {willDelete
                    ? '마지막 멤버라서 나가면 약속방이 삭제돼요.'
                    : nextOwner
                        ? `방장이 나가면 가장 먼저 들어온 ${nextOwner}님이 방장이 돼요.`
                        : '나가면 이 약속방의 채팅과 후보를 더 볼 수 없어요.'}
            </Text>
            <Text style={styles.sheetHint}>초대 코드를 다시 받으면 정원 안에서 다시 들어올 수 있어요.</Text>
            {!!error && <Text style={styles.errorText}>{error}</Text>}
            <SheetButtons cancel="취소" confirm="나가기" danger busy={leaving} onCancel={onClose} onConfirm={leave} />
        </BottomSheet>
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
    panelCaption: { color: SECONDARY, fontSize: 12.5, lineHeight: 19 },
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
    departure: { marginTop: 3, color: SECONDARY, fontSize: 12.5, fontWeight: '600' },
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

    emptyLine: { marginTop: 12, color: SECONDARY, fontSize: 13 },
    candidate: { marginTop: 12, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: BORDER, backgroundColor: '#fafbfc' },
    candidateConfirmed: { borderColor: MINT, backgroundColor: '#f1fcf8' },
    candidateName: { color: NAVY, fontSize: 15.5, fontWeight: '800' },
    confirmedTag: { overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, backgroundColor: '#d9f6eb', color: MINT_DEEP, fontSize: 10.5, fontWeight: '800' },
    proposer: { marginTop: 5, color: SECONDARY, fontSize: 12 },
    candidateActions: { marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    voteButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 11, height: 34, borderRadius: 10, borderWidth: 1, borderColor: BORDER, backgroundColor: WHITE },
    voted: { backgroundColor: NAVY, borderColor: NAVY },
    voteText: { color: NAVY, fontSize: 12.5, fontWeight: '800' },
    votedText: { color: WHITE },
    confirmButton: { paddingHorizontal: 11, height: 34, borderRadius: 10, backgroundColor: '#e3f8f0', justifyContent: 'center' },
    confirmText: { color: MINT_DEEP, fontSize: 12.5, fontWeight: '800' },
    deleteButton: { paddingHorizontal: 8, height: 34, justifyContent: 'center' },
    deleteText: { color: RED, fontSize: 12.5, fontWeight: '700' },
    stationChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
    stationChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 11, height: 34, borderRadius: 17, borderWidth: 1, borderColor: BORDER },
    stationChipText: { color: NAVY, fontSize: 12.5, fontWeight: '700' },
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
    fieldLabel: { marginTop: 4, marginBottom: 7, color: NAVY, fontSize: 13.5, fontWeight: '800' },
    optional: { color: SECONDARY, fontWeight: '600' },
    input: { height: 48, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 13, color: NAVY, fontSize: 15, marginBottom: 12, backgroundColor: '#fafbfc' },
    pickRow: { flexDirection: 'row', gap: 8 },
    pickBox: { flex: 1, height: 48, borderWidth: 1, borderColor: BORDER, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#fafbfc' },
    pickText: { color: NAVY, fontSize: 14.5, fontWeight: '700' },
    placeholder: { color: '#a1a8b8', fontWeight: '600' },
    clearLink: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
    clearText: { color: SECONDARY, fontSize: 12.5, fontWeight: '700' },
    staleNote: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 10, backgroundColor: '#fff6e0' },
    staleText: { flex: 1, color: '#7a5600', fontSize: 12.5, fontWeight: '600' },
    errorText: { marginTop: 10, color: RED, fontSize: 13, fontWeight: '700' },
});
