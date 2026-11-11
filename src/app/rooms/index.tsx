import { formatStationName } from '@/utils/station-name';
import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import BottomTabBar, { useTabBarHeight } from '@/components/bottom-tab-bar';
import { formatAppointmentParam, formatDday, formatMonthDay, formatTime } from '@/constants/home-mock';
import { fetchMyRooms } from '@/services/room';
import { ApiError, isAuthError } from '@/services/api/errors';
import type { RoomSummary } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';
const MINT_SOFT = '#e8f8f1';
const BACKGROUND = '#f3f5f8';
const CARD = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';

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
                            <View style={[styles.dateBox, styles.skeleton]} />
                            <View style={styles.flex}>
                                <View style={[styles.skeletonLine, { width: 120 }]} />
                                <View style={[styles.skeletonLine, { width: 170, marginTop: 10 }]} />
                            </View>
                            {key === 0 && <ActivityIndicator color={NAVY} />}
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
                    <View style={styles.stateBox}>
                        <View style={styles.emptyIcon}>
                            <Ionicons name="people-outline" size={28} color={MINT_DEEP} />
                        </View>
                        <Text style={styles.stateTitle}>참여 중인 약속방이 없어요</Text>
                        <Text style={styles.stateText}>
                            새 약속방을 만들거나{'\n'}친구에게 받은 초대 코드로 입장해 보세요.
                        </Text>
                    </View>
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
            {/* D-day + 날짜 */}
            <View style={styles.dateBox}>
                {at ? (
                    <>
                        <Text style={styles.dday}>{formatDday(at)}</Text>
                        <Text style={styles.dateText}>{formatMonthDay(at)}</Text>
                    </>
                ) : (
                    <Text style={styles.dateUnknown}>날짜{'\n'}미정</Text>
                )}
            </View>

            <View style={styles.flex}>
                <View style={styles.row}>
                    <Text style={styles.roomName} numberOfLines={1}>
                        {room.name}
                    </Text>
                    {room.myRole === 'OWNER' && (
                        <View style={styles.ownerTag}>
                            <Text style={styles.ownerTagText}>방장</Text>
                        </View>
                    )}
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
            </View>

            <View style={styles.side}>
                <View style={[styles.statusTag, confirmed ? styles.statusConfirmed : styles.statusOpen]}>
                    <Text style={[styles.statusText, { color: confirmed ? MINT_DEEP : SECONDARY }]}>
                        {confirmed ? '확정' : '진행 중'}
                    </Text>
                </View>
                <View style={styles.members}>
                    <Ionicons name="people" size={13} color={SECONDARY} />
                    <Text style={styles.membersText}>
                        {room.memberCount}/{room.maxMembers}
                    </Text>
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
        color: '#15664e',
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
        fontSize: 18,
        fontWeight: '800',
    },

    joinChip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 9,
        backgroundColor: MINT_SOFT,
    },

    joinChipText: {
        color: MINT_DEEP,
        fontSize: 12.5,
        fontWeight: '800',
    },

    content: {
        paddingHorizontal: 20,
        paddingTop: 8,
        gap: 10,
    },

    card: {
        padding: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: BORDER,
        borderRadius: 18,
        backgroundColor: CARD,
    },

    dateBox: {
        width: 54,
        height: 54,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    dday: {
        color: MINT,
        fontSize: 13,
        fontWeight: '900',
    },

    dateText: {
        marginTop: 2,
        color: CARD,
        fontSize: 12,
        fontWeight: '700',
    },

    dateUnknown: {
        color: '#c9d0de',
        fontSize: 11.5,
        fontWeight: '800',
        lineHeight: 15,
        textAlign: 'center',
    },

    roomName: {
        flexShrink: 1,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    ownerTag: {
        marginLeft: 6,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: '#e8edf8',
    },

    ownerTagText: {
        color: '#2c4a8c',
        fontSize: 11,
        fontWeight: '800',
    },

    metaRow: {
        marginTop: 7,
        gap: 4,
    },

    meta: {
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
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
        color: NAVY,
        fontSize: 13,
        fontWeight: '700',
    },

    side: {
        alignItems: 'flex-end',
        gap: 8,
    },

    statusTag: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 7,
    },

    statusConfirmed: {
        backgroundColor: MINT_SOFT,
    },

    statusOpen: {
        backgroundColor: '#eef1f5',
    },

    statusText: {
        fontSize: 11.5,
        fontWeight: '800',
    },

    members: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
    },

    membersText: {
        color: SECONDARY,
        fontSize: 12.5,
        fontWeight: '700',
    },

    skeletonCard: {
        borderColor: 'transparent',
    },

    skeleton: {
        backgroundColor: '#e3e7ee',
    },

    skeletonLine: {
        height: 12,
        borderRadius: 6,
        backgroundColor: '#e3e7ee',
    },

    stateBox: {
        marginTop: 40,
        padding: 24,
        alignItems: 'center',
        gap: 8,
    },

    emptyIcon: {
        width: 56,
        height: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: MINT_SOFT,
    },

    stateTitle: {
        marginTop: 6,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
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
        backgroundColor: NAVY,
    },

    stateButtonText: {
        color: CARD,
        fontSize: 14,
        fontWeight: '700',
    },

    fab: {
        position: 'absolute',
        right: 20,
        height: 48,
        paddingHorizontal: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 24,
        backgroundColor: NAVY,
        shadowColor: NAVY,
        shadowOpacity: 0.25,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 5,
    },

    fabText: {
        color: CARD,
        fontSize: 14.5,
        fontWeight: '800',
    },

    pressed: {
        opacity: 0.72,
    },
});