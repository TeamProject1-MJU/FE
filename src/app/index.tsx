import { useMock } from '@/services/api/config';
import { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Easing,
    LayoutChangeEvent,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import LinkRoLogo, { LinkRoColors } from '@/components/linkro-logo';
import { readOnboardingSeen } from '@/services/onboarding-seen';
import { getAuthStatus } from '@/stores/auth-store';
import { startDestination } from '@/utils/start-flow';

const SPLASH_DURATION = 1500;
/** 서버 모드에서 "본 적 있음" 읽기가 늦을 때 시작 화면 뒤로 더 기다리는 최대 시간. 넘으면 본 적 없는 것으로 봐요. */
const SEEN_READ_GRACE = 1000;

const BACKGROUND = '#182f58';
const TAGLINE_COLOR = '#a9b2c8';

const LINE_HEIGHT = 6;
const STATION_SIZE = 22;
const ROUTE_HEIGHT = 28;

export default function SplashScreen() {
    // 노선 애니메이션 값 (0 → 1)
    const whiteLine = useRef(new Animated.Value(0)).current;
    const mintLine = useRef(new Animated.Value(0)).current;
    const whiteStation = useRef(new Animated.Value(0)).current;
    const mintStation = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const easeOut = Easing.out(Easing.ease);

        Animated.parallel([
            Animated.timing(whiteLine, {
                toValue: 1,
                duration: 800,
                easing: easeOut,
                useNativeDriver: true,
            }),
            Animated.timing(mintLine, {
                toValue: 1,
                duration: 800,
                delay: 180,
                easing: easeOut,
                useNativeDriver: true,
            }),
            Animated.timing(whiteStation, {
                toValue: 1,
                duration: 220,
                delay: 350,
                easing: easeOut,
                useNativeDriver: true,
            }),
            Animated.timing(mintStation, {
                toValue: 1,
                duration: 220,
                delay: 620,
                easing: easeOut,
                useNativeDriver: true,
            }),
        ]).start();

        // mock 모드는 이전과 같아요: 표시를 읽지 않고 1.5초 뒤 온보딩으로 가요.
        if (useMock()) {
            const timer = setTimeout(() => {
                router.replace(startDestination({ mock: true, status: getAuthStatus(), seen: false }));
            }, SPLASH_DURATION);
            return () => clearTimeout(timer);
        }

        /*
         * 서버 모드 (#130): 로그인 복원은 auth-gate 가 끝낸 뒤 이 화면이 보여요.
         * "본 적 있음" 읽기는 애니메이션 시간 동안 같이 기다리고, 늦으면 SEEN_READ_GRACE 까지만 더 기다려요.
         * 화면을 떠난 뒤에는 이동하지 않아요.
         */
        let active = true;
        let moved = false;
        let seen: boolean | null = null;
        let waiting = false;
        let grace: ReturnType<typeof setTimeout> | undefined;
        const go = (value: boolean) => {
            if (!active || moved) return;
            moved = true;
            clearTimeout(grace);
            router.replace(startDestination({ mock: false, status: getAuthStatus(), seen: value }));
        };
        void readOnboardingSeen().then(value => {
            seen = value;
            if (waiting) go(value);
        }, () => { seen = false; if (waiting) go(false); });
        const timer = setTimeout(() => {
            if (seen !== null || getAuthStatus() === 'signedIn') { go(seen ?? false); return; }
            waiting = true;
            grace = setTimeout(() => go(false), SEEN_READ_GRACE);
        }, SPLASH_DURATION);

        return () => {
            active = false;
            clearTimeout(timer);
            clearTimeout(grace);
        };
    }, [whiteLine, mintLine, whiteStation, mintStation]);

    return (
        <View style={styles.container}>
            <StatusBar hidden />

            {/* 로고 + 태그라인 */}
            <View style={styles.brand}>
                <LinkRoLogo size={56} color="#ffffff" />
                <Text style={styles.tagline}>
                    지하철을 더 가깝게, 함께.
                </Text>
            </View>

            {/* 하단 노선: 흰 선 → 흰 역 → 민트 선(가운데 민트 역) */}
            <View style={styles.route} pointerEvents="none">
                <View style={styles.routeSegment}>
                    <RouteLine progress={whiteLine} color="#ffffff" />
                </View>

                <Station progress={whiteStation} color="#ffffff" />

                <View style={[styles.routeSegment, styles.routeSegmentWide]}>
                    <RouteLine progress={mintLine} color={LinkRoColors.mint} />
                    <View style={styles.centerStation}>
                        <Station progress={mintStation} color={LinkRoColors.mint} />
                    </View>
                </View>
            </View>
        </View>
    );
}

/** 왼쪽에서 오른쪽으로 그려지는 선 */
function RouteLine({
                       progress,
                       color,
                   }: {
    progress: Animated.Value;
    color: string;
}) {
    const [width, setWidth] = useState(0);

    const onLayout = (e: LayoutChangeEvent) => {
        setWidth(e.nativeEvent.layout.width);
    };

    // RN의 scaleX는 중앙 기준이라 translateX로 왼쪽 기준(transform-origin: left)처럼 보정
    const translateX = Animated.multiply(
        Animated.subtract(progress, 1),
        width / 2,
    );

    return (
        <View style={styles.lineTrack} onLayout={onLayout}>
            {width > 0 && (
                <Animated.View
                    style={[
                        styles.line,
                        {
                            width,
                            backgroundColor: color,
                            transform: [{ translateX }, { scaleX: progress }],
                        },
                    ]}
                />
            )}
        </View>
    );
}

/** 작아진 상태에서 튀어나오는 역 마커 */
function Station({
                     progress,
                     color,
                 }: {
    progress: Animated.Value;
    color: string;
}) {
    const scale = progress.interpolate({
        inputRange: [0, 1],
        outputRange: [0.5, 1],
    });

    return (
        <Animated.View
            style={[
                styles.station,
                {
                    borderColor: color,
                    opacity: progress,
                    transform: [{ scale }],
                },
            ]}
        />
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
        overflow: 'hidden',
    },

    brand: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: '50%',
        marginTop: -100, // 화면 중앙에서 40px 위로 (블록 높이 보정 포함)
        alignItems: 'center',
    },

    tagline: {
        marginTop: 20,
        color: TAGLINE_COLOR,
        fontSize: 15,
        lineHeight: 21,
        fontWeight: '500',
    },

    route: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 144,
        height: ROUTE_HEIGHT,
        flexDirection: 'row',
        alignItems: 'center',
    },

    routeSegment: {
        flex: 1,
        height: ROUTE_HEIGHT,
        justifyContent: 'center',
    },

    routeSegmentWide: {
        flex: 2,
    },

    lineTrack: {
        height: LINE_HEIGHT,
        overflow: 'hidden',
    },

    line: {
        height: LINE_HEIGHT,
    },

    station: {
        width: STATION_SIZE,
        height: STATION_SIZE,
        borderRadius: 999,
        borderWidth: 5,
        backgroundColor: LinkRoColors.navy,
        zIndex: 1,
    },

    centerStation: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: (ROUTE_HEIGHT - STATION_SIZE) / 2,
        alignItems: 'center',
    },
});
