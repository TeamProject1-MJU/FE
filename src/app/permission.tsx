import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '@/components/app-text';
import Passenger from '@/components/passenger';
import { Image } from 'expo-image';
import { onboardingButton } from '@/constants/onboarding';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useMock } from '@/services/api/config';
import { markOnboardingSeen } from '@/services/onboarding-seen';

const PURPLE = '#5C3F78';
const BACKGROUND = '#F7F5FA';
const LAVENDER = '#EDE8F3';
const SHIELD_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 104">
  <ellipse cx="49" cy="96" rx="35" ry="5" fill="#5C3F78" opacity="0.08"/>
  <path d="M48 7 L65 18 L88 25 L84 57 Q79 78 53 94 L29 79 Q15 67 12 50 L9 26 L31 20 Z" fill="#B89BC7"/>
  <path d="M43 5 L61 16 L82 23 L78 55 Q73 75 48 90 Q22 77 17 55 L12 23 L33 16 Z" fill="#D9C5E8"/>
  <path d="M43 13 L59 22 L74 28 L71 53 Q67 69 48 81 Q29 71 24 52 L20 29 L36 22 Z" fill="#E5D8EF"/>
  <path d="M32 48 L43 59 L62 39" fill="none" stroke="#5C3F78" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`)}`;

/**
 * 권한 안내 (#126, #130)
 *
 * 서버 모드는 "시작하기"·"나중에 할게요" 둘 다 로그인으로 가기 전에 "본 적 있음"을 기기에 저장해요.
 * 저장이 실패해도 로그인으로 가요. mock 모드는 저장하지 않고 이전과 같아요.
 */
async function toLogin() {
    if (!useMock()) await markOnboardingSeen();
    router.replace('/login');
}

export default function PermissionScreen() {
    const insets = useSafeAreaInsets();

    const busy = useRef(false);
    const [requesting, setRequesting] = useState(false);
    const handleContinue = async () => {
        if (busy.current) return;
        busy.current = true;
        setRequesting(true);
        try { await ImagePicker.requestCameraPermissionsAsync(); } catch { /* 오류여도 다음 권한을 요청해요. */ }
        try { await Location.requestForegroundPermissionsAsync(); } catch { /* 거부·오류여도 로그인으로 이동해요. */ }
        await toLogin();
    };
    const handleLater = () => {
        if (busy.current) return;
        busy.current = true;
        if (useMock()) { router.replace('/login'); return; }
        return toLogin();
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={[
                    styles.content,
                    { paddingTop: 48 + insets.top, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right },
                ]}
                showsVerticalScrollIndicator={false}
                contentInsetAdjustmentBehavior="never"
            >
                <View style={styles.hero} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Passenger size={96} />
                    <Image source={{ uri: SHIELD_ICON }} style={styles.shield} contentFit="contain" accessible={false} />
                </View>

                <Text style={styles.title} accessibilityRole="header">
                    LinkRo를 더 편하게{'\n'}
                    필요한 권한만 안내할게요
                </Text>
                <Text style={styles.description}>
                    카메라와 위치 권한을 확인해 주세요.
                </Text>

                <View style={styles.permissionCard}>
                    <View style={styles.iconBox}>
                        <Ionicons name="camera-outline" size={30} color={PURPLE} />
                    </View>
                    <View style={styles.cardText}>
                        <Text style={styles.cardTitle}>카메라</Text>
                        <Text style={styles.cardDescription}>표지판을 찍어 방향을 확인해요</Text>
                        <Text style={styles.cardSubDescription}>사진은 분석 후 저장하지 않아요</Text>
                    </View>
                </View>

                <View style={[styles.permissionCard, styles.locationCard]}>
                    <View style={styles.iconBox}>
                        <Ionicons name="location-outline" size={30} color={PURPLE} />
                    </View>
                    <View style={styles.cardText}>
                        <Text style={styles.cardTitle}>위치</Text>
                        <Text style={styles.cardDescription}>내 위치와 주변 역을 확인해요</Text>
                        <Text style={styles.cardSubDescription}>앱을 사용하는 동안만 확인해요</Text>
                    </View>
                </View>
            </ScrollView>

            <View style={[
                styles.actions,
                { paddingBottom: 12 + insets.bottom, paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right },
            ]}>
                <Pressable
                    onPress={handleContinue}
                    disabled={requesting}
                    accessibilityState={{ disabled: requesting, busy: requesting }}
                    accessibilityRole="button"
                    accessibilityLabel="시작하기"
                    style={({ pressed }) => [styles.startButton, pressed && styles.startPressed]}
                >
                    <Text style={styles.startButtonText}>시작하기 →</Text>
                </Pressable>
                <Pressable
                    onPress={handleLater}
                    disabled={requesting}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.laterButton, pressed && styles.laterPressed]}
                >
                    <Text style={styles.laterButtonText}>나중에 할게요</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
    },
    scroll: {
        flex: 1,
    },
    content: {
        flexGrow: 1,
        alignItems: 'center',
        paddingBottom: 28,
    },
    hero: {
        height: 124,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        marginBottom: 24,
    },
    shield: {
        width: 88,
        height: 96,
        marginTop: 24,
    },
    title: {
        color: '#25212D',
        fontSize: 25,
        lineHeight: 34,
        fontWeight: '800',
        letterSpacing: -0.8,
        textAlign: 'center',
    },
    description: {
        marginTop: 16,
        color: '#746B7F',
        fontSize: 14,
        lineHeight: 22,
        textAlign: 'center',
    },
    permissionCard: {
        width: '100%',
        minHeight: 108,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        marginTop: 36,
        padding: 18,
        borderRadius: 24,
        borderWidth: 1,
        borderColor: '#E4DCEB',
        backgroundColor: '#FFFFFF',
    },
    locationCard: {
        marginTop: 14,
    },
    iconBox: {
        width: 56,
        height: 56,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: LAVENDER,
    },
    cardText: {
        flex: 1,
    },
    cardTitle: {
        color: '#25212D',
        fontSize: 18,
        lineHeight: 25,
        fontWeight: '800',
    },
    cardDescription: {
        marginTop: 5,
        color: '#62596D',
        fontSize: 13,
        lineHeight: 20,
        fontWeight: '500',
    },
    cardSubDescription: {
        marginTop: 4,
        color: '#82798D',
        fontSize: 12,
        lineHeight: 18,
        fontWeight: '500',
    },
    actions: {
        flexShrink: 0,
        paddingTop: 12,
    },
    startButton: {
        width: '100%',
        minHeight: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: onboardingButton.background,
    },
    startButtonText: {
        color: onboardingButton.foreground,
        fontSize: onboardingButton.fontSize,
        lineHeight: onboardingButton.lineHeight,
        fontWeight: onboardingButton.fontWeight,
    },
    laterButton: {
        width: '100%',
        minHeight: 44,
        marginTop: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    laterButtonText: {
        color: PURPLE,
        fontSize: 14,
        lineHeight: 22,
        fontWeight: '700',
    },
    startPressed: {
        backgroundColor: onboardingButton.pressed,
    },
    laterPressed: {
        opacity: 0.7,
    },
});
