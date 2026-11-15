import Passenger from '@/components/passenger';
import { formatStationName } from '@/utils/station-name';
import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import BottomTabBar, { useTabBarHeight } from '@/components/bottom-tab-bar';
import { formatAppointmentParam, formatDday, formatMonthDay, formatTime } from '@/constants/home-mock';
import { fetchMyRooms } from '@/services/room';
import { ApiError, isAuthError } from '@/services/api/errors';
import type { RoomSummary } from '@/types/room';

const NAVY = '#25212D';
const MINT = '#5C3F78';
const MINT_DEEP = '#5C3F78';
const MINT_SOFT = '#EDE8F3';
const BACKGROUND = '#F7F5FA';
const CARD = '#ffffff';
const SECONDARY = '#83808B';
const BORDER = '#EEEAF2';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'done'; rooms: RoomSummary[] };

/**
 * 약속방 목록 (#42, 상세설계서 그림 26, API 명세 7.3 GET /rooms)
 *
 * 카드: D-day·이름·일시·약속역·인원, 내 역할(방장)과 방 상태(확정/정하는 중).
 * 초대 코드는 목록에 보여주지 않습니다(명세 7.3 응답에도 없음).
 * 화면에 돌아올 때마다 다시 불러와 생성·참여·수정·나가기 결과를 반영합니다.
 */
export default function RoomsScreen() {
    const insets = useSafeAreaInsets();
    const tabBarHeight = useTabBarHeight();
    // 테스트용: /rooms?mock=empty → 빈 목록, /rooms?mock=error → 조회 실패
    const { mock, leaveResult, nextOwnerName } =
        useLocalSearchParams<{
            mock?: string;
            leaveResult?: string;
            nextOwnerName?: string;
        }>();

    const leaveNotice =
        leaveResult === 'deleted'
            ? '마지막 멤버가 나가서 방과 기록이 삭제됐어요.'
            : leaveResult === 'transferred'
                ? `${nextOwnerName || '다른 참여자'}님에게 방장을 넘기고 나왔어요.`
                : leaveResult === 'left'
                    ? '약속방에서 나왔어요.'
                    : '';
    // useFocusEffect 안에서도 최신 값을 읽도록 ref 로 둡니다.
    const failNext = useRef(mock === 'error');
    const requestId = useRef(0);
    const [load, setLoad] = useState<Load>({ kind: 'loading' });

    const loadRooms = useCallback(async () => {
        const id = ++requestId.current;
        setLoad(prev => (prev.kind === 'done' ? prev : { kind: 'loading' }));
        try {
            const rooms = await fetchMyRooms(failNext.current ? 'error' : mock === 'empty' ? 'empty' : undefined);
            if (id === requestId.current) setLoad({ kind: 'done', rooms });
        } catch (error) {
            if (id !== requestId.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            setLoad({ kind: 'error' });
        } finally {
            failNext.current = false; // 다시 시도하면 성공하도록
        }
    }, [mock]);

    // 이 화면으로 돌아올 때마다 목록을 다시 불러옵니다.
    useFocusEffect(
        useCallback(() => {
            void loadRooms();
            // 화면을 떠난 뒤의 응답을 무효화하는 요청 카운터예요.
            return () => { requestId.current++; };
        }, [loadRooms]),
    );

    const retry = () => {
        setLoad({ kind: 'loading' });
        loadRooms();
    };

    const openRoom = (room: RoomSummary) => {
        router.push({
            pathname: '/rooms/[roomId]',
            params: {
                roomId: room.id,
                roomName: room.name,
                appointmentAt: room.appointmentAt ? formatAppointmentParam(new Date(room.appointmentAt)) : '',
                maxMembers: String(room.maxMembers),
            },
        });
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 헤더: ❷ 초대 코드로 입장 */}
            <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
                <View style={styles.headerSide} />
                <Text style={styles.headerTitle}>약속방</Text>
                <View style={[styles.headerSide, styles.headerRight]}>
                    <Pressable
                        style={({ pressed }) => [styles.joinChip, pressed && styles.pressed]}
                        onPress={() => router.push('/rooms/join')}
                        accessibilityRole="button"
                    >
                        <Text style={styles.joinChipText}>초대 코드로 입장</Text>
                    </Pressable>
                </View>
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 96 }]}>
                {!!leaveNotice && (
                    <View
                        style={styles.leaveNotice}
                        accessibilityLiveRegion="polite"
                    >
                        <Text style={styles.leaveNoticeText}>
                            {leaveNotice}
                        </Text>

                        <Pressable
                            style={styles.noticeClose}
                            accessibilityRole="button"
                            accessibilityLabel="나가기 완료 안내 닫기"
                            onPress={() =>
                                router.setParams({
                                    leaveResult: '',
                                    nextOwnerName: '',
                                })
                            }
                        >
                            <Ionicons
                                name="close"
                                size={18}
                                color={MINT_DEEP}
                            />
                        </Pressable>
                    </View>
                )}
                {load.kind === 'loading' &&
                    [0, 1].map(key => (
                        <View key={key} style={[styles.card, styles.skeletonCard]}>
                            <View style={styles.skeletonTop}>
                                {key === 0 && <ActivityIndicator color={MINT_DEEP} />}
                            </View>
                            <View style={styles.cardBody}>
                                <View style={[styles.skeletonLine, { width: 120 }]} />
                                <View style={[styles.skeletonLine, { width: 170, marginTop: 10 }]} />
                            </View>
                        </View>
                    ))}

                {load.kind === 'error' && (
                    <View style={styles.stateBox}>
                        <Ionicons name="cloud-offline-outline" size={30} color={SECONDARY} />
                        <Text style={styles.stateTitle}>약속방 목록을 불러오지 못했어요</Text>
                        <Text style={styles.stateText}>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</Text>
                        <Pressable
                            style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}
                            onPress={retry}
                            accessibilityRole="button"
                        >
                            <Ionicons name="refresh" size={16} color={CARD} />
                            <Text style={styles.stateButtonText}>다시 시도</Text>
                        </Pressable>
                    </View>
                )}

                {load.kind === 'done' && load.rooms.length === 0 && (
                    <>
                        <View style={[styles.stateBox, styles.emptyCard]}>
                            <Passenger tone="off" size={46} />
                            <Text style={styles.stateTitle}>참여 중인 약속방이 없어요</Text>
                            <Text style={styles.stateText}>
                                새 약속방을 만들거나{'\n'}친구에게 받은 초대 코드로 입장해 보세요.
                            </Text>
                        </View>
                        <View style={styles.emptyActions}>
                            <Pressable style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]} onPress={() => router.push('/rooms/new')} accessibilityRole="button">
                                <Text style={styles.emptyButtonText}>방 만들기</Text>
                            </Pressable>
                            <Pressable style={({ pressed }) => [styles.emptyButton, styles.emptyJoinButton, pressed && styles.pressed]} onPress={() => router.push('/rooms/join')} accessibilityRole="button">
                                <Text style={[styles.emptyButtonText, styles.emptyJoinText]}>코드로 참여</Text>
                            </Pressable>
                        </View>
                    </>
                )}

                {load.kind === 'done' && load.rooms.map(room => <RoomCard key={room.id} room={room} onPress={() => openRoom(room)} />)}
            </ScrollView>

            {/* ❸ 새 약속방 */}
            <Pressable
                style={({ pressed }) => [styles.fab, { bottom: tabBarHeight + 18 }, pressed && styles.pressed]}
                onPress={() => router.push('/rooms/new')}
                accessibilityRole="button"
            >
                <Ionicons name="add" size={22} color={CARD} />
                <Text style={styles.fabText}>새 약속방</Text>
            </Pressable>

            <BottomTabBar active="rooms" />
        </View>
    );
}

/** ❶ 약속 목록 카드 */
function RoomCard({ room, onPress }: { room: RoomSummary; onPress: () => void }) {
    const at = room.appointmentAt ? new Date(room.appointmentAt) : null;
    const confirmed = room.status === 'CONFIRMED' && !!room.selectedStation;

    const label = [
        room.name,
        room.myRole === 'OWNER' ? '방장' : '',
        confirmed ? `약속역 ${formatStationName(room.selectedStation?.name)}` : '약속역 미정',
        at ? `${formatMonthDay(at)} ${formatTime(at)}` : '약속 시각 미정',
        `${room.memberCount}명 참여`,
    ]
        .filter(Boolean)
        .join(', ');

    return (
        <Pressable
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <View style={styles.cardTop}>
                <View style={styles.dateRow}>
                    {at ? (
                        <>
                            <Text style={styles.dday}>{formatDday(at)}</Text>
                            <Text style={styles.dateText}>{formatMonthDay(at)}</Text>
                        </>
                    ) : <Text style={styles.dateUnknown}>날짜 미정</Text>}
                </View>
                <View style={styles.passengers}>
                    {Array.from({ length: Math.min(room.memberCount, room.maxMembers) }, (_, index) => (
                        <Passenger key={index} size={40} tone={index === 0 ? 'me' : (['pink', 'sky', 'mint'] as const)[(index - 1) % 3]} />
                    ))}
                </View>
            </View>

            <View style={styles.cardBody}>
                <View style={styles.row}>
                    <Text style={styles.roomName} numberOfLines={1}>{room.name}</Text>
                    {room.myRole === 'OWNER' && <View style={styles.ownerTag}><Text style={styles.ownerTagText}>방장</Text></View>}
                    <View style={[styles.statusTag, confirmed ? styles.statusConfirmed : styles.statusOpen]}>
                        <Text style={[styles.statusText, { color: confirmed ? '#2E7D5B' : SECONDARY }]}>{confirmed ? '약속역 확정' : '정하는 중'}</Text>
                    </View>
                </View>
                <View style={[styles.row, styles.metaRow]}>
                    <Text style={styles.meta}>
                        {at ? `${WEEKDAYS[at.getDay()]} ${formatTime(at)}` : '시각 미정'}
                    </Text>
                    <Text style={styles.metaDot}>·</Text>
                    {confirmed ? (
                        <>
                            {room.selectedStation?.lines?.map(line => (
                                <View key={line.lineId} style={[styles.lineBadge, { backgroundColor: line.color }]}>
                                    <Text style={styles.lineBadgeText}>{line.lineId}</Text>
                                </View>
                            ))}
                            <Text style={styles.station} numberOfLines={1}>
                                {formatStationName(room.selectedStation?.name)}
                            </Text>
                        </>
                    ) : (
                        <Text style={styles.meta}>약속역 정하는 중</Text>
                    )}
                </View>
                <View style={styles.members}>
                    <Text style={styles.membersText}>{room.memberCount}/{room.maxMembers}명 참여 중</Text>
                    <Ionicons name="chevron-forward" size={18} color="#B4AFBC" />
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    leaveNotice: {
        padding: 12,
        borderRadius: 14,
        backgroundColor: MINT_SOFT,
        borderLeftWidth: 3,
        borderLeftColor: MINT,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    leaveNoticeText: {
        flex: 1,
        color: MINT_DEEP,
        fontSize: 13,
        lineHeight: 22,
    },
    noticeClose: {
        width: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    flex: {
        flex: 1,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
    },
    header: {
        paddingHorizontal: 16,
        paddingBottom: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerSide: {
        flex: 1,
    },
    headerRight: {
        alignItems: 'flex-end',
    },
    headerTitle: {
        color: NAVY,
        fontSize: 26,
        fontWeight: '800',
        letterSpacing: -0.6,
    },
    joinChip: {
        height: 34,
        paddingHorizontal: 13,
        borderRadius: 17,
        backgroundColor: MINT_SOFT,
        justifyContent: 'center',
    },
    joinChipText: {
        color: MINT_DEEP,
        fontSize: 13,
        fontWeight: '700',
    },
    content: {
        paddingHorizontal: 20,
        paddingTop: 8,
        gap: 12,
    },
    card: {
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 22,
        backgroundColor: CARD,
        overflow: 'hidden',
    },
    cardTop: {
        height: 92,
        backgroundColor: '#F4F0F8',
        paddingHorizontal: 16,
        paddingTop: 10,
    },
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    dday: {
        backgroundColor: MINT_DEEP,
        color: CARD,
        fontSize: 12,
        fontWeight: '800',
        borderRadius: 9,
        paddingHorizontal: 9,
        paddingVertical: 4,
        overflow: 'hidden',
    },
    dateUnknown: {
        backgroundColor: MINT_DEEP,
        color: CARD,
        fontSize: 12,
        fontWeight: '800',
        borderRadius: 9,
        paddingHorizontal: 9,
        paddingVertical: 4,
        overflow: 'hidden',
    },
    dateText: {
        color: '#6F6680',
        fontSize: 12.5,
        fontWeight: '600',
    },
    passengers: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
        paddingBottom: 5,
        gap: 6,
    },
    cardBody: {
        paddingHorizontal: 16,
        paddingTop: 13,
        paddingBottom: 15,
    },
    roomName: {
        flex: 1,
        minWidth: 0,
        color: NAVY,
        fontSize: 17,
        fontWeight: '700',
    },
    ownerTag: {
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: MINT_SOFT,
    },
    ownerTagText: {
        color: MINT_DEEP,
        fontSize: 10.5,
        fontWeight: '700',
    },
    metaRow: {
        marginTop: 7,
        gap: 4,
    },
    meta: {
        color: SECONDARY,
        fontSize: 13,
    },
    metaDot: {
        color: SECONDARY,
        fontSize: 13,
    },
    lineBadge: {
        width: 17,
        height: 17,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    lineBadgeText: {
        color: CARD,
        fontSize: 10,
        fontWeight: '800',
    },
    station: {
        flexShrink: 1,
        color: SECONDARY,
        fontSize: 13,
    },
    statusTag: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
    },
    statusConfirmed: {
        backgroundColor: '#DDF1E7',
    },
    statusOpen: {
        backgroundColor: '#F1EEF4',
    },
    statusText: {
        fontSize: 10.5,
        fontWeight: '700',
    },
    members: {
        marginTop: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    membersText: {
        color: '#4A4553',
        fontSize: 12.5,
    },
    skeletonCard: {
        borderColor: BORDER,
    },
    skeletonTop: {
        height: 92,
        backgroundColor: '#E7E2EC',
        alignItems: 'center',
        justifyContent: 'center',
    },
    skeletonLine: {
        height: 12,
        borderRadius: 6,
        backgroundColor: '#E7E2EC',
    },
    stateBox: {
        marginTop: 40,
        padding: 24,
        alignItems: 'center',
        gap: 8,
        backgroundColor: CARD,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 22,
    },
    emptyCard: {
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: '#DCD6E4',
        paddingVertical: 30,
        paddingHorizontal: 20,
    },
    emptyActions: {
        gap: 12,
    },
    emptyButton: {
        height: 52,
        borderRadius: 16,
        backgroundColor: MINT_DEEP,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyButtonText: {
        color: CARD,
        fontSize: 15.5,
        fontWeight: '700',
    },
    emptyJoinButton: {
        backgroundColor: MINT_SOFT,
    },
    emptyJoinText: {
        color: MINT_DEEP,
    },
    stateTitle: {
        marginTop: 6,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
        textAlign: 'center',
    },
    stateText: {
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '600',
        lineHeight: 20,
        textAlign: 'center',
    },
    stateButton: {
        marginTop: 8,
        paddingHorizontal: 16,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 12,
        backgroundColor: MINT_DEEP,
    },
    stateButtonText: {
        color: CARD,
        fontSize: 14,
        fontWeight: '700',
    },
    fab: {
        position: 'absolute',
        right: 20,
        height: 52,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 16,
        backgroundColor: MINT_DEEP,
        shadowColor: MINT_DEEP,
        shadowOpacity: 0.12,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
    },
    fabText: {
        color: CARD,
        fontSize: 15.5,
        fontWeight: '700',
    },
    pressed: {
        opacity: 0.72,
    },
});
