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

export default function OnboardingScreen({
                                             initialPage = 0,
                                         }: {
    initialPage?: number;
}) {
    const [page, setPage] = useState(() =>
        Math.max(0, Math.min(initialPage, 3)),
    );

    const data = onboardingPages[page];
    const last = page === 3;

    const finish = () => router.replace('/login');

    const responder = useMemo(
        () =>
            PanResponder.create({
                onMoveShouldSetPanResponder: (_, gesture) =>
                    Math.abs(gesture.dx) > 15 &&
                    Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,

                onPanResponderRelease: (_, gesture) => {
                    if (Math.abs(gesture.dx) < 45) return;

                    setPage(current =>
                        Math.max(
                            0,
                            Math.min(
                                current + (gesture.dx < 0 ? 1 : -1),
                                3,
                            ),
                        ),
                    );
                },
            }),
        [],
    );

    return (
        <SafeAreaView
            style={[
                styles.container,
                { backgroundColor: data.background },
            ]}
        >
            <StatusBar style={last ? 'light' : 'dark'} />

            <View
                style={styles.container}
                {...responder.panHandlers}
            >
                <View style={styles.header}>
                    <View
                        style={styles.progress}
                        accessibilityLabel={`온보딩 ${page + 1} / 4페이지`}
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
                                                        ? '#2bcf9a'
                                                        : '#0f1c3f'
                                                    : '#d5dae3',
                                        },
                                    ]}
                                />
                            </Pressable>
                        ))}
                    </View>

                    {!last && (
                        <Pressable
                            accessibilityRole="button"
                            onPress={finish}
                            hitSlop={8}
                        >
                            <Text style={styles.skip}>
                                건너뛰기
                            </Text>
                        </Pressable>
                    )}
                </View>

                <ScrollView
                    key={page}
                    style={styles.scroll}
                    contentContainerStyle={styles.scrollContent}
                >
                    <View
                        style={[
                            styles.visual,
                            { backgroundColor: data.background },
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

                <View style={styles.footer}>
                    <Pressable
                        accessibilityRole="button"
                        onPress={
                            last
                                ? finish
                                : () =>
                                    setPage(current =>
                                        Math.min(current + 1, 3),
                                    )
                        }
                        style={({ pressed }) => [
                            styles.button,
                            last && styles.start,
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
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        paddingHorizontal: 28,
        minHeight: 48,
    },
    progress: {
        flex: 1,
        flexDirection: 'row',
        gap: 4,
    },
    stepTouch: {
        flex: 1,
        paddingVertical: 14,
    },
    step: {
        height: 4,
        borderRadius: 4,
    },
    skip: {
        color: '#697386',
        fontSize: 13,
        fontWeight: '600',
    },
    scroll: {
        flex: 1,
        backgroundColor: '#fff',
    },
    scrollContent: {
        flexGrow: 1,
    },
    visual: {
        paddingHorizontal: 28,
        paddingVertical: 32,
        minHeight: 350,
        justifyContent: 'center',
        borderBottomLeftRadius: 26,
        borderBottomRightRadius: 26,
    },
    copy: {
        padding: 28,
        backgroundColor: '#fff',
    },
    label: {
        fontSize: 13,
        fontWeight: '700',
    },
    title: {
        marginTop: 8,
        color: '#0f1c3f',
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
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: 20,
        backgroundColor: '#fff',
    },
    button: {
        minHeight: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0f1c3f',
    },
    start: {
        backgroundColor: '#2bcf9a',
    },
    buttonText: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '700',
    },
    startText: {
        color: '#0f1c3f',
    },
    pressed: {
        opacity: 0.75,
    },
});