import { useMemo, useState } from 'react';
import {
    PanResponder,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';

import { onboardingPages } from '@/constants/onboarding';
import OnboardingIllustration from './OnboardingIllustration';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const LAST_PAGE = onboardingPages.length - 1;

export default function OnboardingScreen({
                                             initialPage = 0,
                                         }: {
    initialPage?: number;
}) {
    const [page, setPage] = useState(() =>
        Math.max(0, Math.min(initialPage, LAST_PAGE)),
    );

    const data = onboardingPages[page];
    const last = page === LAST_PAGE;

    const finish = () => router.replace('/permission');

    const next = () => {
        if (last) {
            finish();
            return;
        }

        setPage(current => Math.min(current + 1, LAST_PAGE));
    };

    const responder = useMemo(
        () =>
            PanResponder.create({
                onMoveShouldSetPanResponder: (_, gesture) =>
                    Math.abs(gesture.dx) > 15 &&
                    Math.abs(gesture.dx) >
                    Math.abs(gesture.dy) * 1.5,

                onPanResponderRelease: (_, gesture) => {
                    if (Math.abs(gesture.dx) < 45) return;

                    setPage(current =>
                        Math.max(
                            0,
                            Math.min(
                                current + (gesture.dx < 0 ? 1 : -1),
                                LAST_PAGE,
                            ),
                        ),
                    );
                },
            }),
        [],
    );

    return (
        <View
            style={[
                styles.root,
                { backgroundColor: data.background },
            ]}
        >
            <StatusBar style={last ? 'light' : 'dark'} />

            <SafeAreaView
                edges={['top', 'left', 'right']}
                style={styles.root}
            >
                <View style={styles.header}>
                    <View
                        style={styles.progress}
                        accessibilityLabel={
                            `온보딩 ${page + 1} / ${onboardingPages.length}페이지`
                        }
                    >
                        {onboardingPages.map((item, index) => (
                            <Pressable
                                key={item.title}
                                accessibilityRole="button"
                                accessibilityLabel={`${index + 1}페이지로 이동`}
                                accessibilityState={{
                                    selected: index === page,
                                }}
                                onPress={() => setPage(index)}
                                style={styles.stepTouch}
                            >
                                <View
                                    style={[
                                        styles.step,
                                        {
                                            backgroundColor:
                                                index <= page
                                                    ? last
                                                        ? MINT
                                                        : NAVY
                                                    : '#d5dae3',
                                        },
                                    ]}
                                />
                            </Pressable>
                        ))}
                    </View>

                    {/* 마지막 장도 이 공간은 그대로 유지 */}
                    <View style={styles.skipSlot}>
                        {!last && (
                            <Pressable
                                accessibilityRole="button"
                                onPress={finish}
                                style={styles.skipButton}
                            >
                                <Text style={styles.skipText}>
                                    건너뛰기
                                </Text>
                            </Pressable>
                        )}
                    </View>
                </View>

                <View
                    style={styles.body}
                    {...responder.panHandlers}
                >
                    <ScrollView
                        key={page}
                        style={styles.scroll}
                        contentContainerStyle={styles.scrollContent}
                        showsVerticalScrollIndicator={false}
                        contentInsetAdjustmentBehavior="never"
                    >
                        <View
                            style={[
                                styles.visual,
                                {
                                    backgroundColor: data.background,
                                },
                            ]}
                        >
                            <OnboardingIllustration page={page} />
                        </View>

                        <View style={styles.copy}>
                            <Text
                                style={[
                                    styles.label,
                                    { color: data.accent },
                                ]}
                            >
                                {page === 1 ? '✦ ' : ''}
                                {data.label}
                            </Text>

                            <Text
                                accessibilityRole="header"
                                style={styles.title}
                            >
                                {data.title}
                            </Text>

                            <Text style={styles.description}>
                                {data.description}
                            </Text>
                        </View>
                    </ScrollView>
                </View>

                <SafeAreaView
                    edges={['bottom']}
                    style={styles.footer}
                >
                    <Pressable
                        accessibilityRole="button"
                        onPress={next}
                        style={({ pressed }) => [
                            styles.button,
                            last && styles.startButton,
                            pressed && styles.pressed,
                        ]}
                    >
                        <Text
                            style={[
                                styles.buttonText,
                                last && styles.startText,
                            ]}
                        >
                            {last ? '시작하기' : '다음'}  →
                        </Text>
                    </Pressable>
                </SafeAreaView>
            </SafeAreaView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        height: 52,
        paddingHorizontal: 28,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    progress: {
        flex: 1,
        flexDirection: 'row',
        gap: 4,
    },
    stepTouch: {
        flex: 1,
        height: 44,
        justifyContent: 'center',
    },
    step: {
        height: 4,
        borderRadius: 4,
    },
    skipSlot: {
        width: 76,
        height: 44,
        justifyContent: 'center',
    },
    skipButton: {
        flex: 1,
        alignItems: 'flex-end',
        justifyContent: 'center',
    },
    skipText: {
        color: '#697386',
        fontSize: 13,
        fontWeight: '600',
    },
    body: {
        flex: 1,
        backgroundColor: '#fff',
    },
    scroll: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
    visual: {
        height: 380,
        paddingHorizontal: 28,
        alignItems: 'center',
        justifyContent: 'center',
        borderBottomLeftRadius: 26,
        borderBottomRightRadius: 26,
    },
    copy: {
        paddingHorizontal: 28,
        paddingTop: 28,
        paddingBottom: 24,
        backgroundColor: '#fff',
    },
    label: {
        fontSize: 13,
        lineHeight: 20,
        fontWeight: '700',
    },
    title: {
        marginTop: 8,
        minHeight: 74,
        color: NAVY,
        fontSize: 28,
        lineHeight: 37,
        fontWeight: '800',
        letterSpacing: -0.8,
    },
    description: {
        marginTop: 12,
        color: '#697386',
        fontSize: 16,
        lineHeight: 25,
    },
    footer: {
        backgroundColor: '#fff',
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 16,
    },
    button: {
        minHeight: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },
    startButton: {
        backgroundColor: MINT,
    },
    buttonText: {
        color: '#fff',
        fontSize: 15,
        lineHeight: 22,
        fontWeight: '700',
    },
    startText: {
        color: NAVY,
    },
    pressed: {
        opacity: 0.75,
    },
});