import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LinkRoLogo, { LinkRoColors } from '@/components/linkro-logo';

const BACKGROUND = '#f3f5f8';
const SECONDARY = '#6b7488';
const MINT_DEEP = '#12a77a';

const KAKAO_YELLOW = '#fee500';
const KAKAO_BLACK = '#191919';

// TODO: 홈 화면 구현 후 실제 홈 라우트로 교체
const HOME_ROUTE = '/explore';

export default function LoginScreen() {
    const insets = useSafeAreaInsets();

    const handleKakaoLogin = () => {
        // 카카오 로그인 API 연동은 별도 이슈에서 진행
        router.replace(HOME_ROUTE);
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 브랜드 영역: 로고 + 태그라인 + 설명 */}
            <View style={[styles.brand, { paddingTop: 172 + insets.top }]}>
                <LinkRoLogo size={48} />
                <Text style={styles.tagline}>지하철을 더 가깝게, 함께.</Text>
                <Text style={styles.description}>LinkRo에서 이동을 시작해보세요.</Text>
            </View>

            {/* 액션 영역: 카카오 버튼 + 안내 문구 */}
            <View style={[styles.actions, { bottom: 103 + insets.bottom }]}>
                <Pressable
                    style={({ pressed }) => [
                        styles.kakaoButton,
                        pressed && styles.kakaoButtonPressed,
                    ]}
                    onPress={handleKakaoLogin}
                    accessibilityRole="button"
                    accessibilityLabel="카카오로 시작하기"
                >
                    <KakaoChatIcon />
                    <Text style={styles.kakaoButtonText}>카카오로 시작하기</Text>
                </Pressable>

                <View style={styles.kakaoNote}>
                    <LockIcon />
                    <Text style={styles.kakaoNoteText}>
                        카카오 계정으로 안전하고 간편하게 시작해요
                    </Text>
                </View>
            </View>

            {/* 약관 안내 */}
            <Text style={[styles.terms, { bottom: 34 + insets.bottom }]}>
                계속하면 LinkRo의{' '}
                <Text style={styles.termsLink}>이용약관</Text>
                {' '}및{' '}
                <Text style={styles.termsLink}>개인정보처리방침</Text>
                에 동의하게 됩니다.
            </Text>
        </View>
    );
}

/** 카카오 말풍선 아이콘 (검정 타원 + 왼쪽 아래 꼬리) */
function KakaoChatIcon() {
    return (
        <View style={styles.chatIcon}>
            <View style={styles.chatIconTail} />
        </View>
    );
}

/** 자물쇠 아이콘 (고리 + 몸통) */
function LockIcon() {
    return (
        <View style={styles.lockIcon}>
            <View style={styles.lockShackle} />
            <View style={styles.lockBody} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
        paddingHorizontal: 20,
    },

    // 브랜드
    brand: {
        alignItems: 'center',
    },

    tagline: {
        marginTop: 20,
        color: LinkRoColors.navy,
        fontSize: 17,
        lineHeight: 22,
        fontWeight: '800',
        letterSpacing: -0.6,
    },

    description: {
        marginTop: 9,
        color: SECONDARY,
        fontSize: 13,
        lineHeight: 18,
        fontWeight: '500',
    },

    // 액션
    actions: {
        position: 'absolute',
        left: 20,
        right: 20,
    },

    kakaoButton: {
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: KAKAO_YELLOW,
        backgroundColor: KAKAO_YELLOW,
    },

    kakaoButtonPressed: {
        transform: [{ scale: 0.98 }],
        opacity: 0.9,
    },

    kakaoButtonText: {
        color: KAKAO_BLACK,
        fontSize: 14,
        fontWeight: '800',
    },

    chatIcon: {
        width: 22,
        height: 18,
        borderRadius: 11,
        backgroundColor: KAKAO_BLACK,
    },

    chatIconTail: {
        position: 'absolute',
        left: 2,
        bottom: -3,
        width: 7,
        height: 7,
        backgroundColor: KAKAO_BLACK,
        transform: [{ rotate: '28deg' }],
    },

    kakaoNote: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
        marginTop: 13,
    },

    kakaoNoteText: {
        color: SECONDARY,
        fontSize: 12,
        fontWeight: '600',
    },

    lockIcon: {
        width: 13,
        height: 15,
        alignItems: 'center',
    },

    lockShackle: {
        width: 8,
        height: 7,
        borderWidth: 2,
        borderBottomWidth: 0,
        borderColor: MINT_DEEP,
        borderTopLeftRadius: 4,
        borderTopRightRadius: 4,
    },

    lockBody: {
        width: 13,
        height: 9,
        borderRadius: 2.5,
        backgroundColor: MINT_DEEP,
    },

    // 약관
    terms: {
        position: 'absolute',
        left: 20,
        right: 20,
        color: SECONDARY,
        fontSize: 12,
        lineHeight: 18.5,
        fontWeight: '500',
        textAlign: 'center',
    },

    termsLink: {
        color: SECONDARY,
        textDecorationLine: 'underline',
    },
});
