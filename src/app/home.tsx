import { ComponentProps, useState } from 'react';
import {
    Alert,
    LayoutChangeEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    useWindowDimensions,
    View,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import LinkRoLogo from '@/components/linkro-logo';
import {
    formatAppointmentParam,
    formatDday,
    formatMonthDay,
    formatTime,
    HOME_UPCOMING_MEETING,
} from '@/constants/home-mock';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const MINT_DEEP = '#12a77a';

const BACKGROUND = '#f3f5f8';
const CARD = '#ffffff';
const SECONDARY = '#6b7488';
const DISABLED = '#a1a8b8';
const DIVIDER = '#e6e9ef';

const AI = '#6a5ae0';
const AI_BG = '#f0eefd';

/** 하단 탭바에서 safe area 를 뺀 높이 */
const TAB_BAR_CONTENT_HEIGHT = 58;
/** 작은 화면에서 지도가 가려지지 않도록 시트가 차지할 수 있는 최대 비율 */
const SHEET_MAX_RATIO = 0.55;

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const [sheetHeight, setSheetHeight] = useState(0);

    const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 8);
    const meeting = HOME_UPCOMING_MEETING;

    const showPreparing = (name: string) => {
        Alert.alert('준비 중', `${name} 화면은 다음 작업에서 연결할 예정입니다.`);
    };

    // 출발·도착역 선택 진입점
    // TODO: 역 검색 화면(StationSearchScreen) 구현 후 '/station-search' 로 교체
    const openStationSearch = () => {
        router.push({
            pathname: '/route-search',
            params: { focus: 'departure' },
        });
    };

    const openMeeting = () => {
        if (!meeting) {
            router.push('/rooms');
            return;
        }

        // API 연동 전에는 약속방 미리보기 화면으로 연결합니다.
        router.push({
            pathname: '/rooms/[roomId]',
            params: {
                roomId: meeting.roomId,
                roomName: meeting.title,
                appointmentAt: formatAppointmentParam(meeting.appointmentAt),
                maxMembers: String(meeting.maxMembers),
            },
        });
    };

    const handleSheetLayout = (event: LayoutChangeEvent) => {
        setSheetHeight(event.nativeEvent.layout.height);
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 지도 영역 - 실제 카카오 지도 연동 전 디자인용 */}
            <View style={[styles.mapArea, { bottom: tabBarHeight }]}>
                <MockMap />
            </View>

            {/* ❶ 상단 로고 + 검색창 */}
            <View style={[styles.topPanel, { top: insets.top + 10 }]}>
                <View style={styles.brandRow}>
                    <LinkRoLogo size={22} />
                </View>

                <Pressable
                    style={({ pressed }) => [styles.searchBar, pressed && styles.pressed]}
                    onPress={openStationSearch}
                    accessibilityRole="search"
                    accessibilityLabel="출발역과 도착역 검색"
                >
                    <Ionicons name="search-outline" size={21} color={NAVY} />
                    <Text style={styles.searchText}>어디로 이동하시나요?</Text>
                </Pressable>
            </View>

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
                        onPress={() => showPreparing('현재 위치')}
                        accessibilityLabel="현재 위치"
                    >
                        <Ionicons name="locate-outline" size={22} color={NAVY} />
                    </Pressable>

                    <View style={styles.mapControlDivider} />

                    <Pressable
                        style={({ pressed }) => [styles.mapControlButton, pressed && styles.pressed]}
                        onPress={() => showPreparing('지도 설정')}
                        accessibilityLabel="지도 설정"
                    >
                        <Ionicons name="layers-outline" size={22} color={NAVY} />
                    </Pressable>
                </View>
            )}

            {/* 하단 기능 시트 */}
            <View
                style={[
                    styles.sheet,
                    {
                        bottom: tabBarHeight,
                        maxHeight: windowHeight * SHEET_MAX_RATIO,
                    },
                ]}
                onLayout={handleSheetLayout}
            >
                <View style={styles.sheetHandleArea}>
                    <View style={styles.sheetHandle} />
                </View>

                <ScrollView
                    contentContainerStyle={styles.sheetContent}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                >
                    {/* ❷ 주요 기능 카드 */}
                    <Pressable
                        style={({ pressed }) => [styles.primaryCard, pressed && styles.pressed]}
                        onPress={() => router.push('/route-search')}
                        accessibilityRole="button"
                        accessibilityLabel="경로 탐색"
                    >
                        <View style={styles.iconTile}>
                            <Ionicons name="train-outline" size={24} color={NAVY} />
                        </View>

                        <View style={styles.primaryText}>
                            <Text style={styles.cardTitle}>경로 탐색</Text>
                            <Text style={styles.cardDescription} numberOfLines={1}>
                                출발역과 도착역으로 최적 경로 찾기
                            </Text>
                        </View>

                        <Ionicons name="chevron-forward" size={20} color={NAVY} />
                    </Pressable>

                    <View style={styles.featureRow}>
                        <FeatureCard
                            icon="camera-outline"
                            iconColor={AI}
                            title="AI 표지판 방향 확인"
                            description="표지판 사진으로 방향 확인"
                            ai
                            wide
                            onPress={() => router.push('/ai-direction')}
                        />

                        <FeatureCard
                            icon="chatbubbles-outline"
                            iconColor={NAVY}
                            title="약속방"
                            description="함께 만날 약속 관리"
                            onPress={() => router.push('/rooms')}
                        />
                    </View>

                    {/* ❸ 다가오는 약속 */}
                    {meeting ? (
                        <Pressable
                            style={({ pressed }) => [styles.meetingCard, pressed && styles.pressed]}
                            onPress={openMeeting}
                            accessibilityRole="button"
                            accessibilityLabel={`다가오는 약속 ${meeting.title}`}
                        >
                            <View style={styles.meetingDate}>
                                <Text style={styles.meetingDday}>
                                    {formatDday(meeting.appointmentAt)}
                                </Text>
                                <Text style={styles.meetingDay}>
                                    {formatMonthDay(meeting.appointmentAt)}
                                </Text>
                            </View>

                            <View style={styles.meetingInfo}>
                                <Text style={styles.meetingLabel}>다가오는 약속</Text>
                                <Text style={styles.meetingTitle} numberOfLines={1}>
                                    {meeting.title}
                                </Text>
                                <Text style={styles.meetingMeta} numberOfLines={1}>
                                    {[
                                        formatTime(meeting.appointmentAt),
                                        meeting.stationName ? `${meeting.stationName}역` : '약속역 미정',
                                        `${meeting.memberCount}/${meeting.maxMembers}명`,
                                    ].join(' · ')}
                                </Text>
                            </View>

                            <Ionicons name="chevron-forward" size={20} color={NAVY} />
                        </Pressable>
                    ) : (
                        <Pressable
                            style={({ pressed }) => [styles.meetingCard, pressed && styles.pressed]}
                            onPress={() => router.push('/rooms')}
                        >
                            <View style={styles.meetingInfo}>
                                <Text style={styles.meetingLabel}>다가오는 약속</Text>
                                <Text style={styles.meetingTitle}>예정된 약속이 없어요</Text>
                                <Text style={styles.meetingMeta}>약속방을 만들어 친구를 초대해 보세요</Text>
                            </View>
                            <Ionicons name="chevron-forward" size={20} color={NAVY} />
                        </Pressable>
                    )}
                </ScrollView>
            </View>

            {/* 하단 탭바 */}
            <View
                style={[
                    styles.tabBar,
                    { height: tabBarHeight, paddingBottom: Math.max(insets.bottom, 8) },
                ]}
            >
                <BottomTab icon="home" label="홈" active onPress={() => {}} />
                <BottomTab
                    icon="navigate-outline"
                    label="경로"
                    onPress={() => router.push('/route-search')}
                />
                <BottomTab
                    icon="chatbubbles-outline"
                    label="약속방"
                    onPress={() => router.push('/rooms')}
                />
                <BottomTab
                    icon="person-outline"
                    label="마이"
                    onPress={() => router.push('/my')}
                />
            </View>
        </View>
    );
}

function FeatureCard({
                         icon,
                         iconColor,
                         title,
                         description,
                         ai = false,
                         wide = false,
                         onPress,
                     }: {
    icon: IoniconName;
    iconColor: string;
    title: string;
    description: string;
    ai?: boolean;
    wide?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            style={({ pressed }) => [
                styles.featureCard,
                wide ? styles.featureCardWide : styles.featureCardNarrow,
                pressed && styles.pressed,
            ]}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={title}
        >
            <View style={styles.featureTop}>
                <View style={styles.iconTile}>
                    <Ionicons name={icon} size={24} color={iconColor} />
                </View>

                {ai && (
                    <View style={styles.aiChip}>
                        <Ionicons name="sparkles" size={12} color={AI} />
                        <Text style={styles.aiChipText}>AI</Text>
                    </View>
                )}
            </View>

            <View>
                <Text style={styles.cardTitle} numberOfLines={1} adjustsFontSizeToFit>
                    {title}
                </Text>
                <Text style={styles.cardDescription} numberOfLines={1}>
                    {description}
                </Text>
            </View>
        </Pressable>
    );
}

function BottomTab({
                       icon,
                       label,
                       active = false,
                       onPress,
                   }: {
    icon: IoniconName;
    label: string;
    active?: boolean;
    onPress: () => void;
}) {
    return (
        <Pressable
            style={styles.tabItem}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
        >
            <Ionicons name={icon} size={23} color={active ? NAVY : DISABLED} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
        </Pressable>
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
                {name}
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
        paddingHorizontal: 16,
        paddingTop: 14,
        paddingBottom: 14,
        borderRadius: 26,
        backgroundColor: CARD,
    },

    brandRow: {
        minHeight: 31,
        flexDirection: 'row',
        alignItems: 'center',
    },

    searchBar: {
        height: 52,
        marginTop: 12,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: 18,
        backgroundColor: BACKGROUND,
    },

    searchText: {
        color: SECONDARY,
        fontSize: 16,
        fontWeight: '600',
    },

    mapControls: {
        position: 'absolute',
        right: 16,
        zIndex: 4,
        width: 48,
        overflow: 'hidden',
        borderRadius: 18,
        backgroundColor: CARD,
    },

    mapControlButton: {
        width: 48,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },

    mapControlDivider: {
        height: 1,
        backgroundColor: DIVIDER,
    },

    sheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        zIndex: 6,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        backgroundColor: CARD,
        overflow: 'hidden',
    },

    sheetHandleArea: {
        height: 22,
        alignItems: 'center',
        justifyContent: 'center',
    },

    sheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 999,
        backgroundColor: '#d5dae3',
    },

    sheetContent: {
        paddingHorizontal: 16,
        paddingBottom: 14,
        gap: 8,
    },

    // 경로 탐색 (가로형 주 기능 카드)
    primaryCard: {
        minHeight: 80,
        paddingHorizontal: 14,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: 18,
        backgroundColor: BACKGROUND,
    },

    primaryText: {
        flex: 1,
    },

    featureRow: {
        flexDirection: 'row',
        gap: 8,
    },

    featureCard: {
        minHeight: 132,
        padding: 14,
        justifyContent: 'space-between',
        borderRadius: 18,
        backgroundColor: BACKGROUND,
    },

    // 'AI 표지판 방향 확인' 제목이 길어 왼쪽 카드를 넓게 둡니다.
    featureCardWide: {
        flex: 1.27,
    },

    featureCardNarrow: {
        flex: 1,
    },

    featureTop: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    iconTile: {
        width: 44,
        height: 44,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: CARD,
    },

    cardTitle: {
        color: NAVY,
        fontSize: 17,
        fontWeight: '800',
        letterSpacing: -0.3,
    },

    cardDescription: {
        marginTop: 4,
        color: SECONDARY,
        fontSize: 12.5,
        fontWeight: '500',
    },

    aiChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 4,
        borderRadius: 8,
        backgroundColor: AI_BG,
    },

    aiChipText: {
        color: AI,
        fontSize: 11,
        fontWeight: '800',
    },

    // 다가오는 약속
    meetingCard: {
        minHeight: 80,
        marginTop: 2,
        padding: 10,
        paddingRight: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: DIVIDER,
        borderRadius: 18,
        backgroundColor: CARD,
    },

    meetingDate: {
        width: 58,
        height: 58,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    meetingDday: {
        color: MINT,
        fontSize: 12,
        fontWeight: '800',
    },

    meetingDay: {
        marginTop: 3,
        color: '#ffffff',
        fontSize: 16,
        fontWeight: '800',
    },

    meetingInfo: {
        flex: 1,
    },

    meetingLabel: {
        color: MINT_DEEP,
        fontSize: 12,
        fontWeight: '700',
    },

    meetingTitle: {
        marginTop: 2,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    meetingMeta: {
        marginTop: 3,
        color: SECONDARY,
        fontSize: 12,
        fontWeight: '600',
    },

    tabBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        paddingTop: 10,
        paddingHorizontal: 16,
        flexDirection: 'row',
        justifyContent: 'space-around',
        borderTopWidth: 1,
        borderTopColor: DIVIDER,
        backgroundColor: CARD,
    },

    tabItem: {
        width: 68,
        alignItems: 'center',
        gap: 3,
    },

    tabLabel: {
        color: DISABLED,
        fontSize: 12,
        fontWeight: '600',
    },

    tabLabelActive: {
        color: NAVY,
        fontWeight: '800',
    },

    pressed: {
        opacity: 0.72,
        transform: [{ scale: 0.98 }],
    },
});
