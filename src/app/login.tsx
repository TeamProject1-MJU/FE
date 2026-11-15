import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Passenger from '@/components/passenger';
import { loginWithKakao } from '@/services/auth';
import { isKakaoLoginCancelled } from '@/services/kakao';
import { ApiError, API_ERROR_MESSAGES } from '@/services/api/errors';

const BACKGROUND = '#F7F5FA';
const INK = '#25212D';
const SECONDARY = '#83808B';
const ACCENT = '#5C3F78';

const KAKAO_YELLOW = '#FEE500';
const KAKAO_BLACK = '#191600';

// 로그인에 성공하면 홈(/home)으로 이동해요.
const HOME_ROUTE = '/home';

export default function LoginScreen() {
    const insets = useSafeAreaInsets();
    const { height } = useWindowDimensions();

    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const busy = useRef(false);
    const handleKakaoLogin = async () => {
        if (busy.current) return;
        busy.current = true; setLoading(true); setMessage('');
        try { await loginWithKakao(); router.replace(HOME_ROUTE); }
        catch (error) {
            if (!isKakaoLoginCancelled(error)) setMessage(error instanceof ApiError
                ? (error.code === 'NETWORK_ERROR' ? '네트워크 연결을 확인해 주세요' : API_ERROR_MESSAGES[error.code] ?? API_ERROR_MESSAGES.UNKNOWN_ERROR)
                : API_ERROR_MESSAGES.UNKNOWN_ERROR);
        } finally { busy.current = false; setLoading(false); }
    };

    return (
        <View style={[styles.container, { paddingBottom: 54 + insets.bottom }]}>
            <StatusBar style="dark" />

            {/* 브랜드 영역: 화면 전체의 정중앙에 캐릭터 + LINKRO (터치는 막지 않아요) */}
            <View style={styles.brand}>
                <View style={styles.passengers}>
                    <Passenger tone="me" size={76} />
                    <Passenger tone="other" size={58} />
                    <Passenger tone="pink" size={46} />
                </View>
                <Text style={styles.wordmark}>LINKRO</Text>
            </View>

            <View style={styles.spacer} />

            {/* 액션 영역: 카카오 버튼 + 오류 + 약관 안내 */}
            <Pressable
                style={({ pressed }) => [
                    styles.kakaoButton,
                    pressed && styles.kakaoButtonPressed,
                ]}
                disabled={loading}
                onPress={handleKakaoLogin}
                accessibilityRole="button"
                accessibilityLabel="카카오로 시작하기"
            >
                {loading ? <ActivityIndicator color={KAKAO_BLACK} /> : <KakaoChatIcon />}
                <Text style={styles.kakaoButtonText}>카카오로 시작하기</Text>
            </Pressable>

            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}

            {/* 약관 안내 */}
            <Text style={styles.terms}>
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

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
        paddingTop: 120,
        paddingHorizontal: 28,
    },

    // 브랜드: 화면 전체를 덮고 가로·세로 정중앙에 놓아요.
    brand: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
    },

    passengers: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 6,
    },

    wordmark: {
        marginTop: 24,
        color: INK,
        fontSize: 40,
        fontWeight: '800',
        letterSpacing: -1,
    },

    spacer: {
        flex: 1,
    },

    // 액션
    kakaoButton: {
        height: 54,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 14,
        backgroundColor: KAKAO_YELLOW,
    },

    kakaoButtonPressed: {
        transform: [{ scale: 0.98 }],
        opacity: 0.9,
    },

    kakaoButtonText: {
        color: KAKAO_BLACK,
        fontSize: 16,
        fontWeight: '700',
    },

    // 말풍선 아이콘: 18 너비(시안 18×18 상자) 타원 + 왼쪽 아래 꼬리
    chatIcon: {
        width: 18,
        height: 15,
        borderRadius: 9,
        backgroundColor: KAKAO_BLACK,
    },

    chatIconTail: {
        position: 'absolute',
        left: 2,
        bottom: -2.5,
        width: 6,
        height: 6,
        backgroundColor: KAKAO_BLACK,
        transform: [{ rotate: '28deg' }],
    },

    message: {
        marginTop: 14,
        textAlign: 'center',
    },

    // 약관
    terms: {
        marginTop: 14,
        color: SECONDARY,
        fontSize: 12,
        lineHeight: 18.5,
        fontWeight: '500',
        textAlign: 'center',
    },

    termsLink: {
        color: ACCENT,
        textDecorationLine: 'underline',
    },
});
