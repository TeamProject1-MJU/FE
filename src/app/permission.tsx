import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

const NAVY = '#0f1c3f';
const NAVY_SOFT = '#f3f5f8';

const BACKGROUND = '#f3f5f8';
const CARD = '#ffffff';

const SECONDARY = '#6b7488';
const BODY_TEXT = '#5f6c7f';
const SMALL_TEXT = '#7f8a9a';

const DIVIDER = '#e6e9ef';

const MINT_DEEP = '#12a77a';
const MINT_SOFT = '#e6f8f1';

export default function PermissionScreen() {
    const insets = useSafeAreaInsets();

    const handleContinue = () => {
        // 이번 이슈에서는 실제 권한 요청 없이
        // 다음 로그인 화면으로만 이동
        router.replace('/login');
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <View
                style={[
                    styles.content,
                    {
                        paddingTop: 92 + insets.top,
                    },
                ]}
            >
                {/* 상단 권한 아이콘 */}
                <View style={styles.permissionIcon}>
                    <Ionicons
                        name="shield-checkmark-outline"
                        size={32}
                        color="#ffffff"
                    />
                </View>

                {/* 제목 */}
                <Text style={styles.title}>
                    LinkRo를 더 편하게 사용하려면{'\n'}
                    권한 설정이 필요해요
                </Text>

                {/* 설명 */}
                <Text style={styles.description}>
                    필요한 기능만 사용할 때 권한을 요청해요.{'\n'}
                    사진은 저장하지 않고, 알림도 중요한 정보에만 사용돼요.
                </Text>

                {/* 카메라 */}
                <View style={styles.permissionCard}>
                    <View style={styles.cameraIconBox}>
                        <Ionicons
                            name="camera-outline"
                            size={24}
                            color={NAVY}
                        />
                    </View>

                    <View style={styles.cardText}>
                        <Text style={styles.cardTitle}>카메라</Text>

                        <Text style={styles.cardDescription}>
                            AI 방향 안내에서 표지판을 촬영할 때 사용해요
                        </Text>

                        <Text style={styles.cardSubDescription}>
                            사진은 분석 후 저장하지 않아요
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={SECONDARY}
                    />
                </View>

                {/* 알림 */}
                <View
                    style={[
                        styles.permissionCard,
                        styles.notificationCard,
                    ]}
                >
                    <View style={styles.notificationIconBox}>
                        <Ionicons
                            name="notifications-outline"
                            size={24}
                            color={MINT_DEEP}
                        />
                    </View>

                    <View style={styles.cardText}>
                        <Text style={styles.cardTitle}>알림</Text>

                        <Text style={styles.cardDescription}>
                            약속방 일정 변경, 도착 정보 등을 알려드려요
                        </Text>

                        <Text style={styles.cardSubDescription}>
                            중요한 안내만 받아볼 수 있어요
                        </Text>
                    </View>

                    <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={SECONDARY}
                    />
                </View>
            </View>

            {/* 하단 버튼 */}
            <View
                style={[
                    styles.actions,
                    {
                        bottom: 23 + insets.bottom,
                    },
                ]}
            >
                <Pressable
                    onPress={handleContinue}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.startButton,
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={styles.startButtonText}>
                        시작하기
                    </Text>
                </Pressable>

                <Pressable
                    onPress={handleContinue}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                        styles.laterButton,
                        pressed && styles.pressed,
                    ]}
                >
                    <Text style={styles.laterButtonText}>
                        나중에 할게요
                    </Text>
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

    content: {
        flex: 1,
        paddingHorizontal: 20,
        alignItems: 'center',
    },

    permissionIcon: {
        width: 72,
        height: 72,
        borderRadius: 36,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
        marginBottom: 25,
    },

    title: {
        color: NAVY,
        fontSize: 25,
        lineHeight: 32,
        fontWeight: '800',
        letterSpacing: -1,
        textAlign: 'center',
    },

    description: {
        maxWidth: 300,
        marginTop: 13,
        color: SECONDARY,
        fontSize: 13,
        lineHeight: 20,
        fontWeight: '500',
        textAlign: 'center',
    },

    permissionCard: {
        width: '100%',
        minHeight: 92,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        marginTop: 39,
        padding: 15,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: DIVIDER,
        backgroundColor: CARD,
    },

    notificationCard: {
        marginTop: 14,
    },

    cameraIconBox: {
        width: 43,
        height: 43,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY_SOFT,
    },

    notificationIconBox: {
        width: 43,
        height: 43,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: MINT_SOFT,
    },

    cardText: {
        flex: 1,
    },

    cardTitle: {
        color: NAVY,
        fontSize: 14,
        fontWeight: '800',
    },

    cardDescription: {
        marginTop: 5,
        color: BODY_TEXT,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
    },

    cardSubDescription: {
        marginTop: 4,
        color: SMALL_TEXT,
        fontSize: 12,
        lineHeight: 16,
        fontWeight: '600',
    },

    actions: {
        position: 'absolute',
        left: 20,
        right: 20,
    },

    startButton: {
        width: '100%',
        height: 54,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    startButtonText: {
        color: '#ffffff',
        fontSize: 14,
        fontWeight: '800',
    },

    laterButton: {
        width: '100%',
        height: 42,
        marginTop: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },

    laterButtonText: {
        color: NAVY,
        fontSize: 13,
        fontWeight: '700',
    },

    pressed: {
        opacity: 0.75,
        transform: [{ scale: 0.98 }],
    },
});