import { ComponentProps, useState } from 'react';
import {
    Alert,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import LinkRoLogo from '@/components/linkro-logo';
import { router } from 'expo-router';

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

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type FeatureCardProps = {
    icon: IoniconName;
    title: string;
    description: string;
    ai?: boolean;
    onPress: () => void;
};

export default function HomeScreen() {
    const insets = useSafeAreaInsets();
    const [expanded, setExpanded] = useState(false);

    const showPreparing = (name: string) => {
        Alert.alert('준비 중', `${name} 화면은 다음 작업에서 연결할 예정입니다.`);
    };

    const handleMidpoint = () => {
        /*
         * 최신 명세:
         * 중간역 추천은 방 밖에서 바로 실행하지 않음.
         *
         * 추후:
         * 약속방 목록/선택 화면 → 방 상세 → 중간역 추천
         */
        Alert.alert(
            '약속방이 필요해요',
            '중간역 추천은 약속방을 선택하거나 만든 뒤 이용할 수 있어요.',
        );
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 지도 영역 - 실제 카카오 지도 연동 전 디자인용 */}
            <MockMap />

            {/* 상단 로고 + 검색창 */}
            <View
                style={[
                    styles.topPanel,
                    {
                        top: insets.top + 10,
                    },
                ]}
            >
                <View style={styles.brandRow}>
                    <LinkRoLogo size={22} />

                    {/*
                      최종 명세에서 알림은 MVP 제외.
                      기존 Figma Make의 알림 버튼은 우선 제거.
                    */}
                </View>

                <Pressable
                    style={({ pressed }) => [
                        styles.searchBar,
                        pressed && styles.pressed,
                    ]}
                    onPress={() => showPreparing('역 검색')}
                >
                    <Ionicons
                        name="search-outline"
                        size={21}
                        color={NAVY}
                    />

                    <Text style={styles.searchText}>
                        어디로 이동하시나요?
                    </Text>
                </Pressable>
            </View>

            {/* 지도 우측 버튼 */}
            <View
                style={[
                    styles.mapControls,
                    {
                        bottom: expanded ? 608 : 373,
                    },
                ]}
            >
                <Pressable
                    style={({ pressed }) => [
                        styles.mapControlButton,
                        pressed && styles.pressed,
                    ]}
                    onPress={() => showPreparing('현재 위치')}
                >
                    <Ionicons
                        name="locate-outline"
                        size={22}
                        color={NAVY}
                    />
                </Pressable>

                <View style={styles.mapControlDivider} />

                <Pressable
                    style={({ pressed }) => [
                        styles.mapControlButton,
                        pressed && styles.pressed,
                    ]}
                    onPress={() => showPreparing('지도 설정')}
                >
                    <Ionicons
                        name="layers-outline"
                        size={22}
                        color={NAVY}
                    />
                </Pressable>
            </View>

            {/* 하단 기능 시트 */}
            <View
                style={[
                    styles.sheet,
                    expanded
                        ? styles.sheetExpanded
                        : styles.sheetCollapsed,
                ]}
            >
                <Pressable
                    style={styles.sheetHandleButton}
                    onPress={() => setExpanded(current => !current)}
                >
                    <View style={styles.sheetHandle} />
                </Pressable>

                <View style={styles.featureGrid}>
                    <FeatureCard
                        icon="navigate-outline"
                        title="경로 탐색"
                        description="최적 경로 찾기"
                        onPress={() => router.push('/route-search')}
                    />

                    <FeatureCard
                        icon="people-outline"
                        title="중간역 추천"
                        description="함께 만날 위치"
                        onPress={handleMidpoint}
                    />

                    <FeatureCard
                        icon="camera-outline"
                        title="AI 방향 안내"
                        description="표지판만 촬영하기"
                        ai
                        onPress={() => router.push('/ai-direction')}
                    />

                    <FeatureCard
                        icon="chatbubbles-outline"
                        title="약속방"
                        description="함께 이동하기"
                        onPress={() => showPreparing('약속방')}
                    />
                </View>

                {/* Figma Make의 진행 중인 약속 미리보기 */}
                {!expanded && (
                    <Pressable
                        style={({ pressed }) => [
                            styles.meetingPreview,
                            pressed && styles.pressed,
                        ]}
                        onPress={() => showPreparing('약속방 상세')}
                    >
                        <View style={styles.meetingDate}>
                            <Text style={styles.meetingDday}>D-7</Text>
                            <Text style={styles.meetingDay}>10.18</Text>
                        </View>

                        <View style={styles.meetingInfo}>
                            <Text style={styles.meetingLabel}>
                                진행 중인 약속
                            </Text>

                            <Text
                                style={styles.meetingTitle}
                                numberOfLines={1}
                            >
                                기말 끝 파티
                            </Text>
                        </View>

                        <Ionicons
                            name="chevron-forward"
                            size={21}
                            color={SECONDARY}
                        />
                    </Pressable>
                )}

                {expanded && (
                    <View style={styles.meetingSection}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>
                                진행 중인 약속
                            </Text>

                            <Pressable
                                onPress={() =>
                                    showPreparing('전체 약속방')
                                }
                            >
                                <Text style={styles.moreText}>
                                    전체 보기
                                </Text>
                            </Pressable>
                        </View>

                        <Pressable
                            style={({ pressed }) => [
                                styles.fullMeetingCard,
                                pressed && styles.pressed,
                            ]}
                            onPress={() =>
                                showPreparing('약속방 상세')
                            }
                        >
                            <View style={styles.meetingDate}>
                                <Text style={styles.meetingDday}>
                                    D-7
                                </Text>

                                <Text style={styles.meetingDay}>
                                    10.18
                                </Text>
                            </View>

                            <View style={styles.meetingInfo}>
                                <Text style={styles.meetingTitle}>
                                    기말 끝 파티
                                </Text>

                                <Text style={styles.meetingMeta}>
                                    일 18:00 · 건대입구역
                                </Text>
                            </View>

                            <View style={styles.avatarGroup}>
                                {['민', '준', '서'].map(
                                    (name, index) => (
                                        <View
                                            key={name}
                                            style={[
                                                styles.avatar,
                                                {
                                                    marginLeft:
                                                        index === 0
                                                            ? 0
                                                            : -7,
                                                },
                                            ]}
                                        >
                                            <Text
                                                style={
                                                    styles.avatarText
                                                }
                                            >
                                                {name}
                                            </Text>
                                        </View>
                                    ),
                                )}
                            </View>
                        </Pressable>
                    </View>
                )}
            </View>

            {/* 하단 탭바 */}
            <View
                style={[
                    styles.tabBar,
                    {
                        paddingBottom: Math.max(
                            insets.bottom,
                            8,
                        ),
                    },
                ]}
            >
                <BottomTab
                    icon="home"
                    label="홈"
                    active
                    onPress={() => {}}
                />

                <BottomTab
                    icon="navigate-outline"
                    label="경로"
                    onPress={() => router.push('/route-search')}
                />

                <BottomTab
                    icon="chatbubbles-outline"
                    label="약속방"
                    onPress={() => showPreparing('약속방')}
                />

                <BottomTab
                    icon="person-outline"
                    label="마이"
                    onPress={() => showPreparing('마이')}
                />
            </View>
        </View>
    );
}

function FeatureCard({
                         icon,
                         title,
                         description,
                         ai = false,
                         onPress,
                     }: FeatureCardProps) {
    return (
        <Pressable
            style={({ pressed }) => [
                styles.featureCard,
                pressed && styles.pressed,
            ]}
            onPress={onPress}
        >
            {ai && (
                <View style={styles.aiChip}>
                    <Ionicons
                        name="sparkles"
                        size={12}
                        color={AI}
                    />

                    <Text style={styles.aiChipText}>AI</Text>
                </View>
            )}

            <View
                style={[
                    styles.featureIcon,
                    ai && styles.featureIconAi,
                ]}
            >
                <Ionicons
                    name={icon}
                    size={24}
                    color={ai ? AI : NAVY}
                />
            </View>

            <View>
                <Text style={styles.featureTitle}>
                    {title}
                </Text>

                <Text style={styles.featureDescription}>
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
        >
            <Ionicons
                name={icon}
                size={23}
                color={active ? NAVY : DISABLED}
            />

            <Text
                style={[
                    styles.tabLabel,
                    active && styles.tabLabelActive,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

/**
 * 실제 카카오 지도 붙이기 전,
 * Figma Make 홈 화면 분위기만 유지하기 위한 지도 UI.
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

    map: {
        ...StyleSheet.absoluteFillObject,
        bottom: 76,
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
        justifyContent: 'space-between',
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
        bottom: 76,
        zIndex: 6,
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        backgroundColor: CARD,
        overflow: 'hidden',
    },

    sheetCollapsed: {
        height: 355,
    },

    sheetExpanded: {
        height: 600,
    },

    sheetHandleButton: {
        height: 25,
        alignItems: 'center',
        justifyContent: 'center',
    },

    sheetHandle: {
        width: 36,
        height: 4,
        borderRadius: 999,
        backgroundColor: '#d5dae3',
    },

    featureGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: 8,
    },

    featureCard: {
        position: 'relative',
        width: '48.8%',
        minHeight: 120,
        padding: 14,
        borderRadius: 18,
        backgroundColor: BACKGROUND,
    },

    featureIcon: {
        width: 44,
        height: 44,
        marginBottom: 8,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: CARD,
    },

    featureIconAi: {
        backgroundColor: '#ffffff',
    },

    featureTitle: {
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    featureDescription: {
        marginTop: 4,
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '500',
    },

    aiChip: {
        position: 'absolute',
        right: 12,
        top: 12,
        zIndex: 2,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 3,
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 8,
        backgroundColor: AI_BG,
    },

    aiChipText: {
        color: AI,
        fontSize: 11,
        fontWeight: '800',
    },

    meetingPreview: {
        height: 76,
        marginTop: 12,
        padding: 8,
        paddingRight: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderWidth: 1,
        borderColor: DIVIDER,
        borderRadius: 18,
        backgroundColor: CARD,
    },

    meetingDate: {
        width: 54,
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
        marginTop: 4,
        color: '#ffffff',
        fontSize: 15,
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
        marginTop: 4,
        color: NAVY,
        fontSize: 15,
        fontWeight: '800',
    },

    meetingSection: {
        marginTop: 18,
    },

    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        paddingHorizontal: 2,
    },

    sectionTitle: {
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    moreText: {
        color: MINT_DEEP,
        fontSize: 12,
        fontWeight: '700',
    },

    fullMeetingCard: {
        minHeight: 82,
        padding: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        borderWidth: 1,
        borderColor: DIVIDER,
        borderRadius: 18,
        backgroundColor: CARD,
    },

    meetingMeta: {
        marginTop: 6,
        color: SECONDARY,
        fontSize: 12,
        fontWeight: '600',
    },

    avatarGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingRight: 3,
    },

    avatar: {
        width: 27,
        height: 27,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#dfe5ee',
    },

    avatarText: {
        color: NAVY,
        fontSize: 10,
        fontWeight: '800',
    },

    tabBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        minHeight: 76,
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
        justifyContent: 'center',
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