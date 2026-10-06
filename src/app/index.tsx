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

const SPLASH_DURATION = 1500;

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

        const timer = setTimeout(() => {
            router.replace('/onboarding-1');
        }, SPLASH_DURATION);

        return () => clearTimeout(timer);
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
