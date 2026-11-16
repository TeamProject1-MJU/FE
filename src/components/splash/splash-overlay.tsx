import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import TrainBlock from '@/components/train-block';

/**
 * 앱을 켤 때 한 번만 보이는 스플래시 층이에요. (#210)
 * 루트 레이아웃에서 기존 화면 위에 덮이고, 애니메이션이 끝나면 흐려진 뒤 언마운트돼요.
 */

// 앱 실행 중 한 번만 보이게 하는 모듈 수준 플래그예요(화면 이동·다시 그리기에서는 다시 안 나와요).
let hasShownSplash = false;

const USE_NATIVE_DRIVER = Platform.OS !== 'web';

const BG_COLOR = '#F7F5FA';
const RING_COLOR = '#5C3F78';
const UNDERLINE_COLOR = '#B89BC7';
const TITLE_COLOR = '#25212D';

const TRAIN_SIZE = 92;
const GROUP_WIDTH = 192;
const GROUP_HEIGHT = 135;
const UNDERLINE_TOP = 160;
const UNDERLINE_WIDTH = 200;
const UNDERLINE_HEIGHT = 3;
const TITLE_TOP = UNDERLINE_TOP + UNDERLINE_HEIGHT + 22;
const TITLE_LINE_HEIGHT = 48;
const CONTENT_HEIGHT = TITLE_TOP + TITLE_LINE_HEIGHT;
// 390 x 844 에서 묶음 위쪽 끝이 250 이 되도록 세로 가운데보다 위로 올려요.
// 844 / 2 - 250 = 172, 콘텐츠 가운데 기준으로 172 - CONTENT_HEIGHT / 2 만큼 올라가요.
const CENTER_LIFT = 172 - CONTENT_HEIGHT / 2;

const CARS = [
    { x: 0, y: 0, color: '#5C3F78', delay: 0 },
    { x: 50, y: 29, color: '#8466A6', delay: 280 },
    { x: 100, y: 58, color: '#B89BC7', delay: 560 },
] as const;
const CAR_FROM = { x: -240, y: -139 };
const CAR_DURATION = 550;
const CAR_EASING = Easing.bezier(0.2, 0.8, 0.2, 1);

const RINGS = [
    { x: 63, y: 46, delay: 780 },
    { x: 113, y: 75, delay: 1060 },
] as const;
const RING_SIZE = 16;
const RING_DURATION = 500;

const CSS_EASE = Easing.bezier(0.25, 0.1, 0.25, 1);
const UNDERLINE_DELAY = 1000;
const UNDERLINE_DURATION = 500;
const TITLE_DELAY = 1200;
const TITLE_DURATION = 450;

const HOLD_MS = 900;
const FADE_MS = 300;
const REDUCED_MOTION_HOLD_MS = 600;

export default function SplashOverlay() {
    const [visible, setVisible] = useState(() => !hasShownSplash);
    const cars = useRef(CARS.map(() => new Animated.Value(0))).current;
    const rings = useRef(RINGS.map(() => new Animated.Value(0))).current;
    const underline = useRef(new Animated.Value(0)).current;
    const title = useRef(new Animated.Value(0)).current;
    const overlay = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        if (!visible) return;
        hasShownSplash = true;

        let cancelled = false;
        let running: Animated.CompositeAnimation | null = null;
        let holdTimer: ReturnType<typeof setTimeout> | null = null;

        const showFinalScene = () => {
            cars.forEach(value => value.setValue(1));
            rings.forEach(value => value.setValue(1));
            underline.setValue(1);
            title.setValue(1);
        };

        const play = () => {
            const timing = (value: Animated.Value, duration: number, delay: number, easing: (t: number) => number) =>
                Animated.timing(value, { toValue: 1, duration, delay, easing, useNativeDriver: USE_NATIVE_DRIVER });

            running = Animated.sequence([
                Animated.parallel([
                    ...cars.map((value, i) => timing(value, CAR_DURATION, CARS[i].delay, CAR_EASING)),
                    ...rings.map((value, i) => timing(value, RING_DURATION, RINGS[i].delay, Easing.out(Easing.ease))),
                    timing(underline, UNDERLINE_DURATION, UNDERLINE_DELAY, CSS_EASE),
                    timing(title, TITLE_DURATION, TITLE_DELAY, CSS_EASE),
                ]),
                Animated.timing(overlay, {
                    toValue: 0,
                    duration: FADE_MS,
                    delay: HOLD_MS,
                    easing: CSS_EASE,
                    useNativeDriver: USE_NATIVE_DRIVER,
                }),
            ]);
            running.start(({ finished }) => {
                if (finished && !cancelled) setVisible(false);
            });
        };

        AccessibilityInfo.isReduceMotionEnabled()
            .catch(() => false)
            .then(reduceMotion => {
                if (cancelled) return;
                if (reduceMotion) {
                    showFinalScene();
                    holdTimer = setTimeout(() => {
                        if (!cancelled) setVisible(false);
                    }, REDUCED_MOTION_HOLD_MS);
                } else {
                    play();
                }
            });

        return () => {
            cancelled = true;
            running?.stop();
            if (holdTimer) clearTimeout(holdTimer);
        };
    }, [visible, cars, rings, underline, title, overlay]);

    if (!visible) return null;

    return (
        <Animated.View style={[styles.overlay, { opacity: overlay }]}>
            <View style={styles.center}>
                <View style={styles.content}>
                    <View style={styles.group}>
                        {CARS.map((car, i) => (
                            <Animated.View
                                key={car.color}
                                style={[
                                    styles.car,
                                    {
                                        left: car.x,
                                        top: car.y,
                                        opacity: cars[i],
                                        transform: [
                                            { translateX: cars[i].interpolate({ inputRange: [0, 1], outputRange: [CAR_FROM.x, 0] }) },
                                            { translateY: cars[i].interpolate({ inputRange: [0, 1], outputRange: [CAR_FROM.y, 0] }) },
                                        ],
                                    },
                                ]}
                            >
                                <TrainBlock size={TRAIN_SIZE} color={car.color} />
                            </Animated.View>
                        ))}
                        {RINGS.map((ring, i) => (
                            <Animated.View
                                key={`${ring.x}-${ring.y}`}
                                style={[
                                    styles.ring,
                                    {
                                        left: ring.x,
                                        top: ring.y,
                                        opacity: rings[i].interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 0] }),
                                        transform: [
                                            { scale: rings[i].interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1.5, 2.2] }) },
                                        ],
                                    },
                                ]}
                            />
                        ))}
                    </View>

                    <Animated.View style={[styles.underline, { transform: [{ scaleX: underline }] }]} />

                    <Animated.View
                        style={[
                            styles.titleWrap,
                            {
                                opacity: title,
                                transform: [{ translateY: title.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
                            },
                        ]}
                    >
                        <Text style={styles.title}>LINKRO</Text>
                    </Animated.View>
                </View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        backgroundColor: BG_COLOR,
        zIndex: 1000,
        elevation: 1000,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        // 가운데 정렬 기준을 CENTER_LIFT 만큼 위로 올려요.
        paddingBottom: CENTER_LIFT * 2,
    },
    content: {
        width: Math.max(GROUP_WIDTH, UNDERLINE_WIDTH),
        height: CONTENT_HEIGHT,
        alignItems: 'center',
    },
    group: {
        position: 'absolute',
        top: 0,
        width: GROUP_WIDTH,
        height: GROUP_HEIGHT,
    },
    car: {
        position: 'absolute',
    },
    ring: {
        position: 'absolute',
        width: RING_SIZE,
        height: RING_SIZE,
        borderRadius: RING_SIZE / 2,
        borderWidth: 3,
        borderColor: RING_COLOR,
        backgroundColor: 'transparent',
    },
    underline: {
        position: 'absolute',
        top: UNDERLINE_TOP,
        width: UNDERLINE_WIDTH,
        height: UNDERLINE_HEIGHT,
        borderRadius: 2,
        backgroundColor: UNDERLINE_COLOR,
        transformOrigin: 'left',
    },
    titleWrap: {
        position: 'absolute',
        top: TITLE_TOP,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    title: {
        fontSize: 40,
        lineHeight: TITLE_LINE_HEIGHT,
        fontWeight: '800',
        letterSpacing: -1,
        color: TITLE_COLOR,
    },
});
