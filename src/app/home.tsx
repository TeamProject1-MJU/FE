import BottomTabBar, { useTabBarHeight } from '@/components/bottom-tab-bar';
import HomeCongestionCard from '@/components/home-congestion-card';
import { useHomeCongestion } from '@/hooks/use-home-congestion';
import { formatStationName } from '@/utils/station-name';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    LayoutChangeEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    useWindowDimensions,
    View,
} from 'react-native';
import { Text } from '@/components/app-text';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import KakaoMap from '@/components/KakaoMap';
import { useHomeMap } from '@/hooks/use-home-map';
import { getAuthStatus, getSession, useRedirectIfSignedOut } from '@/stores/auth-store';
import { HOME_UPCOMING_MEETING } from '@/constants/home-mock';
import { useMock as isMockMode } from '@/services/api/config';
import { ApiError, isAuthError } from '@/services/api/errors';
import { getSessionGeneration } from '@/services/auth';
import { fetchMyRooms } from '@/services/room';
import { formatSeoulMonthDay, formatSeoulTime, seoulDateKey } from '@/utils/seoul-time';
import { meetingRoomParams, pickUpcomingRoom, toHomeMeeting, type HomeMeetingCard } from '@/utils/upcoming-meeting';

const PURPLE = '#5C3F78';
const INK = '#25212D';
const MUTED = '#83808B';
const TINT = '#EDE8F3';
const LINE = '#E8E4ED';
const CHEVRON = '#B4AFBC';

const BACKGROUND = '#f3f5f8';
const CARD = '#ffffff';
const SECONDARY = '#6b7488';

/** 남는 공간이 너무 작을 때 사용할 기존 시트 높이 하한 */
const SHEET_MAX_RATIO = 0.55;
const MAP_MIN_HEIGHT = 120;

/**
 * 약속 카드 왼쪽 날짜 배지 문구 (#193). 기기 시간대가 아니라 서울 달력 날짜로 세요.
 * 오늘 → "오늘", 하루 뒤 → "내일", 그 뒤 → "D-6", 지난 날 → "D+1". 읽을 수 없는 시각이면 null(배지 없음).
 */
function meetingBadgeLabel(appointmentAt: Date, now = new Date()) {
    if (!Number.isFinite(appointmentAt.getTime())) return null;
    const target = seoulDateKey(appointmentAt.toISOString());
    const today = seoulDateKey(now.toISOString());
    if (!target || !today) return null;
    const diff = Math.round((Date.parse(target) - Date.parse(today)) / 86_400_000);
    if (diff === 0) return '오늘';
    if (diff === 1) return '내일';
    return diff > 0 ? `D-${diff}` : `D+${-diff}`;
}

/** 약속 시각을 서울 기준 "오후 2:00" 으로 보여줘요 (#193). 읽을 수 없으면 빈 문자열이에요. */
function formatMeetingClock(appointmentAt: Date) {
    if (!Number.isFinite(appointmentAt.getTime())) return '';
    const hhmm = formatSeoulTime(appointmentAt.toISOString());
    if (!hhmm) return '';
    const [hour, minute] = hhmm.split(':').map(Number);
    return `${hour < 12 ? '오전' : '오후'} ${hour % 12 === 0 ? 12 : hour % 12}:${String(minute).padStart(2, '0')}`;
}

/** 약속 카드 설명 "오후 2:00 역 정하는 중 4명" (#193). 시안처럼 공백 한 칸으로 구분해요. */
function meetingDescription(meeting: HomeMeetingCard) {
    return [
        formatMeetingClock(meeting.appointmentAt),
        meeting.stationName ? formatStationName(meeting.stationName) : '역 정하는 중',
        `${meeting.memberCount}명`,
    ].filter(Boolean).join(' ');
}

/** 서버 모드 "다가오는 약속" 상태. done 은 어느 계정(로그인 세대:userId)의 결과인지 같이 들고 있어요. */
type MeetingLoad =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'done'; meeting: HomeMeetingCard | null; account: string | null };

/** room-cache 범위와 같은 기준(로그인 세대:userId)이에요. 렌더 중에도 부작용 없이 읽어요. */
function currentAccount() {
    const userId = getSession()?.userId;
    return getAuthStatus() === 'signedIn' && userId ? `${getSessionGeneration()}:${userId}` : null;
}

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    useRedirectIfSignedOut();
    const { height: windowHeight } = useWindowDimensions();
    const [sheetHeight, setSheetHeight] = useState(0);
    const [sheetContentHeight, setSheetContentHeight] = useState(0);
    const [sheetViewportHeight, setSheetViewportHeight] = useState(0);

    const tabBarHeight = useTabBarHeight();
    const sheetMaxHeight = Math.max(
        windowHeight * SHEET_MAX_RATIO,
        windowHeight - tabBarHeight - (insets.top + 10 + styles.topPanel.height + MAP_MIN_HEIGHT),
    );

    /*
     * 다가오는 약속 (#102)
     * - mock 모드: 기존 HOME_UPCOMING_MEETING 그대로, 서버를 부르지 않아요.
     * - 서버 모드: 홈에 들어올 때마다 7.3 방 목록을 다시 불러와 지나지 않은 가장 가까운 약속 하나를 보여줘요.
     *   이미 보여주던 값이 있으면 로딩으로 되돌리지 않고, 화면을 떠난 뒤 온 응답은 요청 번호로 무시해요.
     *   다른 계정의 결과는 렌더할 때 계정 기준을 비교해서 바로 숨겨요. 인증 오류는 화면 안내 없이 기존 흐름에 맡겨요.
     */
    const serverMode = !isMockMode();
    const homeMap = useHomeMap(serverMode, currentAccount());
    const { mock } = useLocalSearchParams<{ mock?: string | string[] }>();
    const congestion = useHomeCongestion({ serverMode, account: currentAccount(), location: homeMap.myLocation, locationLoading: homeMap.locationLoading, stations: homeMap.stations, mock });
    const requestId = useRef(0);
    const [load, setLoad] = useState<MeetingLoad>({ kind: 'loading' });

    const loadMeeting = useCallback(async () => {
        if (!serverMode) return;
        const id = ++requestId.current;
        const generation = getSessionGeneration();
        const account = currentAccount();
        setLoad(prev => (prev.kind === 'done' && prev.account === account ? prev : { kind: 'loading' }));
        try {
            const rooms = await fetchMyRooms();
            // 화면을 떠났거나 그사이 로그인 세대가 바뀌었으면 버려요.
            if (id !== requestId.current || generation !== getSessionGeneration()) return;
            const room = pickUpcomingRoom(rooms, new Date());
            setLoad({ kind: 'done', meeting: room ? toHomeMeeting(room) : null, account: currentAccount() });
        } catch (error) {
            if (id !== requestId.current || error instanceof ApiError && (isAuthError(error) || error.code.startsWith('TOKEN_'))) return;
            setLoad({ kind: 'error' });
        }
    }, [serverMode]);

    useFocusEffect(
        useCallback(() => {
            void loadMeeting();
            return () => { requestId.current++; };
        }, [loadMeeting]),
    );

    const retryMeeting = () => {
        setLoad({ kind: 'loading' });
        void loadMeeting();
    };

    // 이전 계정의 결과는 다시 불러오기 전이라도 보여주지 않아요.
    const meetingState: MeetingLoad = load.kind === 'done' && load.account !== currentAccount() ? { kind: 'loading' } : load;
    const meeting: HomeMeetingCard | null = serverMode
        ? (meetingState.kind === 'done' ? meetingState.meeting : null)
        : HOME_UPCOMING_MEETING;

    const showPreparing = (name: string) => {
        Alert.alert('준비 중', `${name} 화면은 다음 작업에서 연결할 예정입니다.`);
    };

    // 출발·도착역 선택 진입점: 경로 검색 화면을 열고, 그 화면이 출발역 칸의 역 검색(/station-search)을 바로 열어요.
    const openStationSearch = () => {
        router.push({
            pathname: '/route-search',
            params: { focus: 'departure' },
        });
    };

    const openMeeting = () => {
        if (!meeting) {
            router.replace({ pathname: '/rooms', params: { tabSwitch: '1' } });
            return;
        }

        // 약속방 목록(rooms/index.tsx)의 openRoom 과 같은 params 예요. mock 모드는 기존 미리보기 방(preview)이에요.
        router.push({
            pathname: '/rooms/[roomId]',
            params: meetingRoomParams(meeting),
        });
    };

    const handleSheetLayout = (event: LayoutChangeEvent) => {
        setSheetHeight(event.nativeEvent.layout.height);
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 서버 모드는 실제 지도, mock 모드는 기존 디자인 지도 */}
            <View style={[styles.mapArea, { bottom: tabBarHeight }]}>
                {serverMode ? <KakaoMap
                    center={homeMap.center}
                    myLocation={homeMap.myLocation}
                    markers={homeMap.markers}
                    centerRevision={homeMap.centerRevision}
                    bottomInset={sheetHeight}
                    onRegionChange={homeMap.onRegionChange}
                /> : <MockMap />}
                {serverMode && (homeMap.guidance || homeMap.truncated) && <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 125, alignSelf: 'center', backgroundColor: '#ffffffee', borderRadius: 8, padding: 8 }}>
                    {!!homeMap.guidance && <Text style={{ color: SECONDARY, fontSize: 12 }}>{homeMap.guidance}</Text>}
                    {homeMap.truncated && <Text style={{ color: SECONDARY, fontSize: 12 }}>일부 역만 표시했어요. 지도를 확대해 주세요.</Text>}
                </View>}
            </View>

            {/* 상단 검색 필 */}
            <Pressable
                style={({ pressed }) => [styles.topPanel, { top: insets.top + 10 }, pressed && styles.pressed]}
                onPress={openStationSearch}
                accessibilityRole="search"
                accessibilityLabel="출발역과 도착역 검색"
            >
                <Text style={styles.searchBrand}>LinkRo</Text>
                <View style={styles.searchDivider} />
                <Ionicons name="search-outline" size={18} color={MUTED} />
                <Text style={styles.searchText}>어디로 갈까요?</Text>
            </Pressable>

            {/* 지도 우측 버튼 (시트 높이에 맞춰 위치) */}
            {sheetHeight > 0 && (
                <View
                    style={[
                        styles.mapControls,
                        { bottom: tabBarHeight + sheetHeight + 12 },
                    ]}
                >
                    <Pressable
                        style={({ pressed }) => [styles.mapControlButton, pressed && styles.pressed]}
                        onPress={() => serverMode ? homeMap.locate() : showPreparing('현재 위치')}
                        accessibilityLabel="현재 위치"
                    >
                        <Ionicons name="locate-outline" size={20} color={PURPLE} />
                    </Pressable>
                </View>
            )}

            {/* 하단 기능 시트 */}
            <View
                style={[
                    styles.sheet,
                    {
                        bottom: tabBarHeight,
                        maxHeight: sheetMaxHeight,
                    },
                ]}
                onLayout={handleSheetLayout}
            >
                <ScrollView
                    contentContainerStyle={styles.sheetContent}
                    onContentSizeChange={(_width, height) => setSheetContentHeight(height)}
                    onLayout={event => setSheetViewportHeight(event.nativeEvent.layout.height)}
                    scrollEnabled={sheetContentHeight > sheetViewportHeight}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                >
                    <HomeCongestionCard state={congestion} onLocate={() => serverMode ? homeMap.locate() : showPreparing('현재 위치')} />
                    <View style={styles.meetingHeader}>
                        <Text style={styles.sectionTitle}>내 약속</Text>
                        <Pressable
                            style={({ pressed }) => [styles.allMeetingsButton, pressed && styles.pressed]}
                            onPress={() => router.replace({ pathname: '/rooms', params: { tabSwitch: '1' } })}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="전체 보기"
                        >
                            <Text style={styles.allMeetingsText}>전체 보기</Text>
                        </Pressable>
                    </View>

                    {/* ❸ 다가오는 약속 */}
                    {serverMode && meetingState.kind === 'loading' ? (
                        <View style={styles.meetingCard} accessibilityLabel="다가오는 약속을 불러오고 있어요">
                            <View style={styles.meetingBadge}>
                                <ActivityIndicator color={PURPLE} />
                            </View>
                            <View style={styles.meetingInfo}>
                                <Text style={styles.meetingTitle}>다가오는 약속</Text>
                                <Text style={styles.meetingMeta}>약속을 불러오고 있어요</Text>
                            </View>
                        </View>
                    ) : serverMode && meetingState.kind === 'error' ? (
                        <Pressable
                            style={({ pressed }) => [styles.meetingCard, pressed && styles.pressed]}
                            onPress={retryMeeting}
                            accessibilityRole="button"
                            accessibilityLabel="다가오는 약속 다시 불러오기"
                        >
                            <View style={styles.meetingBadge}>
                                <Ionicons name="alert-circle-outline" size={20} color={PURPLE} />
                            </View>
                            <View style={styles.meetingInfo}>
                                <Text style={styles.meetingTitle}>약속을 불러오지 못했어요</Text>
                                <Text style={styles.meetingMeta}>눌러서 다시 시도해 주세요</Text>
                            </View>
                            <Ionicons name="refresh" size={20} color={PURPLE} />
                        </Pressable>
                    ) : meeting ? (
                        <Pressable
                            style={({ pressed }) => [styles.meetingCard, pressed && styles.pressed]}
                            onPress={openMeeting}
                            accessibilityRole="button"
                            accessibilityLabel={`다가오는 약속 ${meeting.title}`}
                        >
                            {!!meetingBadgeLabel(meeting.appointmentAt) && (
                                <View style={styles.meetingBadge} accessibilityLabel={formatSeoulMonthDay(meeting.appointmentAt.toISOString())}>
                                    <Text style={styles.meetingBadgeText}>
                                        {meetingBadgeLabel(meeting.appointmentAt)}
                                    </Text>
                                </View>
                            )}

                            <View style={styles.meetingInfo}>
                                <Text style={styles.meetingTitle} numberOfLines={1}>
                                    {meeting.title}
                                </Text>
                                <Text style={styles.meetingMeta} numberOfLines={1}>
                                    {meetingDescription(meeting)}
                                </Text>
                            </View>

                            <Ionicons name="chevron-forward" size={18} color={CHEVRON} />
                        </Pressable>
                    ) : (
                        <Pressable
                            style={({ pressed }) => [styles.meetingCard, pressed && styles.pressed]}
                            onPress={() => router.replace({ pathname: '/rooms', params: { tabSwitch: '1' } })}
                        >
                            <View style={styles.meetingBadge}>
                                <Ionicons name="calendar-outline" size={20} color={PURPLE} />
                            </View>
                            <View style={styles.meetingInfo}>
                                <Text style={styles.meetingTitle}>예정된 약속이 없어요</Text>
                                <Text style={styles.meetingMeta}>약속방을 만들어 친구를 초대해 보세요</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={CHEVRON} />
                        </Pressable>
                    )}
                    <View style={styles.roomActions}>
                        <Pressable
                            style={({ pressed }) => [styles.roomButton, styles.createRoomButton, pressed && styles.pressed]}
                            onPress={() => router.push('/rooms/new')}
                            accessibilityRole="button"
                            accessibilityLabel="방 만들기"
                        >
                            <Text style={styles.createRoomText}>방 만들기</Text>
                        </Pressable>
                        <Pressable
                            style={({ pressed }) => [styles.roomButton, styles.joinRoomButton, pressed && styles.pressed]}
                            onPress={() => router.push('/rooms/join')}
                            accessibilityRole="button"
                            accessibilityLabel="코드로 참여"
                        >
                            <Text style={styles.joinRoomText}>코드로 참여</Text>
                        </Pressable>
                    </View>
                </ScrollView>
            </View>

            {/* 하단 탭바 */}
            <BottomTabBar active="home" />
        </View>
    );
}

/**
 * 실제 카카오 지도 붙이기 전,
 * Figma 홈 화면 분위기만 유지하기 위한 지도 UI.
 */
function MockMap() {
    return (
        <View style={styles.map}>
            <View style={[styles.road, styles.roadHorizontal1]} />
            <View style={[styles.road, styles.roadHorizontal2]} />
            <View style={[styles.road, styles.roadVertical1]} />
            <View style={[styles.road, styles.roadVertical2]} />

            <View style={[styles.subwayLine, styles.lineGreen]} />
            <View style={[styles.subwayLine, styles.lineBlue]} />

            <Station
                top="27%"
                left="14%"
                name="충정로역"
                color="#00A84D"
            />

            <Station
                top="46%"
                left="28%"
                name="서울역"
                color="#0052A4"
            />

            <Station
                top="34%"
                left="49%"
                name="시청역"
                color="#00A84D"
            />

            <Station
                top="52%"
                left="66%"
                name="명동역"
                color="#00A5DE"
            />

            <View style={styles.currentLocationOuter}>
                <View style={styles.currentLocationInner} />
            </View>
        </View>
    );
}

function Station({
                     top,
                     left,
                     name,
                     color,
                 }: {
    top: `${number}%`;
    left: `${number}%`;
    name: string;
    color: string;
}) {
    return (
        <View
            style={[
                styles.station,
                {
                    top,
                    left,
                },
            ]}
        >
            <View
                style={[
                    styles.stationDot,
                    {
                        borderColor: color,
                    },
                ]}
            >
                <View
                    style={[
                        styles.stationDotInner,
                        {
                            backgroundColor: color,
                        },
                    ]}
                />
            </View>

            <Text style={styles.stationName}>
                {formatStationName(name)}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
    },

    mapArea: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
    },

    map: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        backgroundColor: '#eef1ed',
    },

    road: {
        position: 'absolute',
        backgroundColor: '#ffffff',
        opacity: 0.9,
    },

    roadHorizontal1: {
        top: '23%',
        left: -30,
        width: '120%',
        height: 17,
        transform: [{ rotate: '-7deg' }],
    },

    roadHorizontal2: {
        top: '49%',
        left: -35,
        width: '125%',
        height: 21,
        transform: [{ rotate: '-13deg' }],
    },

    roadVertical1: {
        top: -30,
        left: '29%',
        width: 15,
        height: '105%',
        transform: [{ rotate: '-5deg' }],
    },

    roadVertical2: {
        top: -30,
        left: '69%',
        width: 13,
        height: '105%',
        transform: [{ rotate: '7deg' }],
    },

    subwayLine: {
        position: 'absolute',
        height: 4,
        borderRadius: 999,
    },

    lineGreen: {
        top: '35%',
        left: '-5%',
        width: '115%',
        backgroundColor: '#00A84D',
        transform: [{ rotate: '9deg' }],
    },

    lineBlue: {
        top: '48%',
        left: '5%',
        width: '90%',
        backgroundColor: '#0052A4',
        transform: [{ rotate: '-43deg' }],
    },

    station: {
        position: 'absolute',
        flexDirection: 'row',
        alignItems: 'center',
    },

    stationDot: {
        width: 14,
        height: 14,
        borderRadius: 7,
        borderWidth: 3,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#ffffff',
    },

    stationDotInner: {
        width: 4,
        height: 4,
        borderRadius: 2,
    },

    stationName: {
        marginLeft: 5,
        color: '#586271',
        fontSize: 10,
        fontWeight: '700',
    },

    currentLocationOuter: {
        position: 'absolute',
        top: '43%',
        left: '52%',
        width: 42,
        height: 42,
        borderRadius: 21,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(32,138,239,0.18)',
    },

    currentLocationInner: {
        width: 16,
        height: 16,
        borderRadius: 8,
        borderWidth: 4,
        borderColor: '#ffffff',
        backgroundColor: '#208aef',
    },

    topPanel: {
        position: 'absolute',
        left: 16,
        right: 16,
        zIndex: 5,
        height: 52,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 16,
        backgroundColor: CARD,
        boxShadow: '0px 4px 16px rgba(60,40,90,0.10)',
        elevation: 3,
    },

    searchBrand: {
        color: INK,
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.4,
    },

    searchDivider: {
        width: 1,
        height: 18,
        backgroundColor: LINE,
    },

    searchText: {
        flex: 1,
        color: MUTED,
        fontSize: 15,
    },

    mapControls: {
        position: 'absolute',
        right: 16,
        zIndex: 4,
    },

    /** 시안의 둥근 "내 위치" 버튼 */
    mapControlButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: CARD,
        boxShadow: '0px 3px 12px rgba(60,40,90,0.12)',
        elevation: 3,
    },

    sheet: {
        // 손잡이를 없애도 기존 상단 여백은 유지해요.
        paddingTop: 24,
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 6,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: CARD,
        overflow: 'hidden',
        boxShadow: '0px -6px 24px rgba(60,40,90,0.08)',
    },

    sheetContent: {
        paddingTop: 2,
        paddingHorizontal: 18,
        paddingBottom: 18,
    },

    meetingHeader: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
    },

    sectionTitle: {
        color: INK,
        fontSize: 16,
        fontWeight: '700',
    },

    allMeetingsButton: {
        paddingVertical: 6,
    },

    allMeetingsText: {
        color: MUTED,
        fontSize: 13,
    },

    meetingCard: {
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },

    meetingBadge: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        backgroundColor: TINT,
    },

    meetingBadgeText: {
        color: PURPLE,
        fontSize: 13,
        fontWeight: '700',
    },

    meetingInfo: {
        flex: 1,
        minWidth: 0,
    },

    meetingTitle: {
        color: INK,
        fontSize: 15.5,
        fontWeight: '600',
    },

    meetingMeta: {
        marginTop: 2,
        color: MUTED,
        fontSize: 13,
    },

    roomActions: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 10,
    },

    roomButton: {
        flex: 1,
        height: 48,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },

    createRoomButton: {
        backgroundColor: PURPLE,
    },

    joinRoomButton: {
        backgroundColor: TINT,
    },

    createRoomText: {
        color: '#ffffff',
        fontSize: 15,
        fontWeight: '600',
    },

    joinRoomText: {
        color: PURPLE,
        fontSize: 15,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
        transform: [{ scale: 0.98 }],
    },
});
