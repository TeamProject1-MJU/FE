import { ComponentProps, ReactNode, useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    BackHandler,
    KeyboardAvoidingView,
    Linking,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { fetchMe, logout, nicknameLength, updateNickname, validateNickname, withdraw } from '@/services/user';
import { resetToLogin, useRedirectIfSignedOut } from '@/stores/auth-store';
import { NICKNAME_MAX, UserError, type User } from '@/types/user';

const NAVY = '#0f1c3f';
const MINT_DEEP = '#12a77a';
const MINT_SOFT = '#e8f8f1';
const RED = '#e5484d';
const BACKGROUND = '#f3f5f8';
const CARD = '#ffffff';
const SECONDARY = '#6b7488';
const DISABLED = '#a1a8b8';
const DIVIDER = '#e6e9ef';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type Sheet = 'nickname' | 'logout' | 'withdraw' | null;
type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'done'; user: User };

/** 앱 권한 상태 (TODO: expo-image-picker·expo-location 권한 조회로 교체) */
const MOCK_PERMISSIONS: { key: string; label: string; granted: boolean }[] = [
    { key: 'camera', label: '카메라', granted: true },
    { key: 'location', label: '위치', granted: true },
];

const TAB_BAR_CONTENT_HEIGHT = 58;

/**
 * 마이페이지 (#38, 상세설계서 5.5 그림 40~43, API 명세 4.3~4.6)
 *
 * 내 정보(닉네임·로그인 방식), 앱 권한, 로그아웃·회원 탈퇴.
 * 닉네임 수정·로그아웃·회원 탈퇴는 상세설계서대로 아래에서 올라오는 시트로 엽니다.
 * 실제 사용자 조회·토큰 저장·계정 API 는 연동하지 않았습니다(services/user.ts mock).
 */
export default function MyScreen() {
    const insets = useSafeAreaInsets();
    // /my?mock=error 로 열면 조회 실패 → 다시 시도 흐름을 확인할 수 있어요(테스트용).
    const { mock } = useLocalSearchParams<{ mock?: string }>();

    const [load, setLoad] = useState<Load>({ kind: 'loading' });
    const [failNext, setFailNext] = useState(mock === 'error');
    const [sheet, setSheet] = useState<Sheet>(null);
    const [toast, setToast] = useState('');
    // 테스트용: /my?mock=logout-error → 첫 로그아웃 실패
    const [failLogout, setFailLogout] = useState(mock === 'logout-error');

    // 로그아웃한 뒤 이 화면으로 돌아오면 로그인 화면으로 보냅니다 (#40)
    useRedirectIfSignedOut();

    const tabBarHeight = TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 8);

    const loadUser = useCallback(async () => {
        setLoad({ kind: 'loading' });
        try {
            const user = await fetchMe(failNext);
            setLoad({ kind: 'done', user });
        } catch {
            setLoad({ kind: 'error' });
            setFailNext(false); // 다시 시도하면 성공하도록
        }
    }, [failNext]);

    useEffect(() => {
        loadUser();
        // 처음 한 번만 불러옵니다.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(''), 2200);
        return () => clearTimeout(timer);
    }, [toast]);

    const user = load.kind === 'done' ? load.user : null;

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
                <Text style={styles.headerTitle}>마이</Text>
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}>
                {/* ❶ 프로필 카드 */}
                {load.kind === 'loading' && (
                    <View style={[styles.card, styles.profile]}>
                        <View style={[styles.avatar, styles.skeleton]} />
                        <View style={styles.flex}>
                            <View style={[styles.skeletonLine, { width: 90 }]} />
                            <View style={[styles.skeletonLine, { width: 64, marginTop: 8 }]} />
                        </View>
                        <ActivityIndicator color={NAVY} />
                    </View>
                )}

                {load.kind === 'error' && (
                    <View style={[styles.card, styles.errorCard]}>
                        <Ionicons name="cloud-offline-outline" size={26} color={SECONDARY} />
                        <Text style={styles.errorTitle}>내 정보를 불러오지 못했어요</Text>
                        <Text style={styles.errorText}>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</Text>
                        <Pressable
                            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                            onPress={loadUser}
                            accessibilityRole="button"
                        >
                            <Ionicons name="refresh" size={16} color={CARD} />
                            <Text style={styles.retryText}>다시 시도</Text>
                        </Pressable>
                    </View>
                )}

                {user && (
                    <View style={[styles.card, styles.profile]}>
                        <View style={styles.avatar}>
                            <Text style={styles.avatarText}>{user.nickname.slice(0, 1)}</Text>
                        </View>
                        <View style={styles.flex}>
                            <Text style={styles.nickname} numberOfLines={1}>
                                {user.nickname}
                            </Text>
                            {/* 로그인은 카카오만 지원 (명세 4.1) */}
                            <Text style={styles.loginType}>카카오 로그인</Text>
                        </View>
                        <Pressable
                            style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
                            onPress={() => setSheet('nickname')}
                            accessibilityRole="button"
                        >
                            <Text style={styles.smallButtonText}>닉네임 수정</Text>
                        </Pressable>
                    </View>
                )}

                {/* ❷ 앱 권한 */}
                <Text style={styles.sectionTitle}>앱 권한</Text>
                <View style={styles.card}>
                    {MOCK_PERMISSIONS.map((item, index) => (
                        <Pressable
                            key={item.key}
                            style={({ pressed }) => [
                                styles.listRow,
                                index > 0 && styles.listDivider,
                                pressed && styles.pressed,
                            ]}
                            // 권한 변경은 iPhone 설정에서 합니다.
                            onPress={() => Linking.openSettings().catch(() => undefined)}
                            accessibilityRole="button"
                            accessibilityLabel={`${item.label} 권한 ${item.granted ? '허용' : '허용 안 함'}, 설정 열기`}
                        >
                            <Text style={styles.listLabel}>{item.label}</Text>
                            <View style={styles.flex} />
                            <Text style={[styles.permission, { color: item.granted ? MINT_DEEP : RED }]}>
                                {item.granted ? '허용' : '허용 안 함'}
                            </Text>
                            <Ionicons name="chevron-forward" size={17} color={SECONDARY} />
                        </Pressable>
                    ))}
                </View>

                {/* ❸ ❹ 계정 */}
                <Text style={styles.sectionTitle}>계정</Text>
                <View style={styles.card}>
                    <Pressable
                        style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                        onPress={() => setSheet('logout')}
                        accessibilityRole="button"
                    >
                        <Text style={[styles.listLabel, { color: RED }]}>로그아웃</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.listRow, styles.listDivider, pressed && styles.pressed]}
                        onPress={() => setSheet('withdraw')}
                        accessibilityRole="button"
                    >
                        <Text style={styles.listLabel}>회원 탈퇴</Text>
                    </Pressable>
                </View>

                {/* TODO: 이용약관·개인정보 처리방침 링크 */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>이용약관</Text>
                    <View style={styles.footerBar} />
                    <Text style={styles.footerText}>개인정보 처리방침</Text>
                </View>
            </ScrollView>

            {/* 하단 탭바 (홈·경로·약속방·마이) */}
            <View style={[styles.tabBar, { height: tabBarHeight, paddingBottom: Math.max(insets.bottom, 8) }]}>
                <BottomTab icon="home-outline" label="홈" onPress={() => router.navigate('/home')} />
                <BottomTab icon="navigate-outline" label="경로" onPress={() => router.push('/route-search')} />
                <BottomTab icon="chatbubbles-outline" label="약속방" onPress={() => router.push('/rooms')} />
                <BottomTab icon="person" label="마이" active onPress={() => undefined} />
            </View>

            {!!toast && (
                <View style={[styles.toast, { bottom: tabBarHeight + 16 }]} accessibilityLiveRegion="polite">
                    <Ionicons name="checkmark-circle" size={18} color="#7ee2bf" />
                    <Text style={styles.toastText}>{toast}</Text>
                </View>
            )}

            {sheet === 'nickname' && user && (
                <NicknameSheet
                    current={user.nickname}
                    failFirstSave={mock === 'save-error'}
                    onClose={() => setSheet(null)}
                    onSaved={saved => {
                        setLoad({ kind: 'done', user: saved });
                        setSheet(null);
                        setToast('닉네임을 바꿨어요');
                    }}
                />
            )}

            {sheet === 'logout' && (
                <ConfirmSheet
                    title="로그아웃"
                    icon="log-out-outline"
                    heading="로그아웃하시겠어요?"
                    description="다시 로그인하면 이전 정보를 그대로 이용할 수 있어요."
                    confirmLabel="로그아웃"
                    onClose={() => setSheet(null)}
                    failText="로그아웃하지 못했어요."
                    onConfirm={async () => {
                        const fail = failLogout;
                        setFailLogout(false); // 다시 시도하면 성공하도록
                        await logout(fail);
                        // 로그인 상태를 지운 뒤, 이전 화면 기록 없이 로그인 화면으로 이동
                        resetToLogin();
                    }}
                />
            )}

            {sheet === 'withdraw' && (
                <ConfirmSheet
                    title="회원 탈퇴"
                    icon="person-remove-outline"
                    heading="정말 탈퇴하시겠어요?"
                    description="탈퇴하면 참여 중인 모든 약속방에서 나가게 돼요. 방장이라면 권한이 위임되고, 마지막 참여자라면 방이 삭제돼요. 같은 카카오 계정으로 다시 로그인하면 계정은 복구되지만 약속방은 복구되지 않아요."
                    confirmLabel="탈퇴하기"
                    danger
                    onClose={() => setSheet(null)}
                    onConfirm={async () => {
                        await withdraw();
                        router.replace('/login');
                    }}
                />
            )}
        </View>
    );
}

/* ---------- 시트 ---------- */

function SheetFrame({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
    const insets = useSafeAreaInsets();

    // 안드로이드 뒤로 가기: 화면을 나가지 않고 시트만 닫습니다.
    useEffect(() => {
        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            onClose();
            return true;
        });
        return () => subscription.remove();
    }, [onClose]);

    return (
        <KeyboardAvoidingView
            style={styles.sheetLayer}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <Pressable style={styles.dim} onPress={onClose} accessibilityLabel="닫기" />
            <View style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>{title}</Text>
                {children}
            </View>
        </KeyboardAvoidingView>
    );
}

function SheetHero({ icon, heading, description }: { icon: IoniconName; heading: string; description: string }) {
    return (
        <View style={styles.hero}>
            <View style={styles.heroIcon}>
                <Ionicons name={icon} size={24} color={MINT_DEEP} />
            </View>
            <Text style={styles.heroHeading}>{heading}</Text>
            <Text style={styles.heroDescription}>{description}</Text>
        </View>
    );
}

/** 그림 41 닉네임 수정 (#39) */
function NicknameSheet({
                           current,
                           failFirstSave = false,
                           onClose,
                           onSaved,
                       }: {
    current: string;
    /** 테스트용: 첫 저장을 실패시킵니다 */
    failFirstSave?: boolean;
    onClose: () => void;
    onSaved: (user: User) => void;
}) {
    const [value, setValue] = useState(current);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [failNext, setFailNext] = useState(failFirstSave);

    const inputError = validateNickname(value);
    const unchanged = value.trim() === current;
    const disabled = !!inputError || unchanged || saving;

    const save = async () => {
        if (disabled) return;
        setSaving(true);
        setSaveError('');
        try {
            onSaved(await updateNickname(value, failNext));
        } catch (error) {
            // 실패해도 입력값은 그대로 두고, 다시 저장할 수 있게 합니다.
            setSaveError(error instanceof UserError ? error.message : '저장하지 못했어요. 다시 시도해 주세요.');
            setFailNext(false);
            setSaving(false);
        }
    };

    // 저장 중에는 닫지 않습니다.
    const close = () => {
        if (!saving) onClose();
    };

    const message = saveError || inputError;
    const length = nicknameLength(value);

    return (
        <SheetFrame title="닉네임 수정" onClose={close}>
            <SheetHero icon="person-outline" heading="닉네임을 바꿀 수 있어요" description="2~20자로 입력해주세요." />

            <View style={[styles.input, !!message && styles.inputError]}>
                <TextInput
                    style={styles.inputText}
                    value={value}
                    onChangeText={text => {
                        setValue(text);
                        setSaveError('');
                    }}
                    editable={!saving}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={save}
                    accessibilityLabel="닉네임"
                    placeholder="닉네임"
                    placeholderTextColor={DISABLED}
                />
                <Text style={[styles.counter, length > NICKNAME_MAX && { color: RED }]}>
                    {length}/{NICKNAME_MAX}
                </Text>
            </View>
            <Text style={[styles.inputHelp, !!message && { color: RED }]}>
                {message ?? '앞뒤 공백은 빼고 저장해요. 다른 사용자와 같은 닉네임도 쓸 수 있어요.'}
            </Text>

            <Pressable
                style={({ pressed }) => [styles.primary, disabled && styles.primaryDisabled, pressed && styles.pressed]}
                onPress={save}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled, busy: saving }}
            >
                {saving ? (
                    <ActivityIndicator color={CARD} />
                ) : (
                    <Text style={styles.primaryText}>{saveError ? '다시 저장' : '저장'}</Text>
                )}
            </Pressable>
            <Pressable
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={close}
                disabled={saving}
                accessibilityRole="button"
            >
                <Text style={styles.secondaryText}>취소</Text>
            </Pressable>
        </SheetFrame>
    );
}
function ConfirmSheet({
                          title,
                          icon,
                          heading,
                          description,
                          confirmLabel,
                          danger = false,
                          failText,
                          onClose,
                          onConfirm,
                      }: {
    title: string;
    icon: IoniconName;
    heading: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    /** 실패했을 때 제목 (예: '로그아웃하지 못했어요.') */
    failText?: string;
    onClose: () => void;
    onConfirm: () => Promise<void>;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const confirm = async () => {
        setBusy(true);
        setError('');
        try {
            await onConfirm();
        } catch (caught) {
            // 실패하면 시트를 닫지 않고 안내 + 다시 시도
            setError(caught instanceof UserError ? caught.message : failText ?? '처리하지 못했어요. 다시 시도해 주세요.');
        } finally {
            setBusy(false);
        }
    };

    // 처리 중에는 닫지 않습니다.
    const close = () => {
        if (!busy) onClose();
    };

    return (
        <SheetFrame title={title} onClose={close}>
            <SheetHero icon={icon} heading={heading} description={description} />

            {!!error && (
                <View style={styles.sheetError} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle" size={17} color={RED} />
                    <Text style={styles.sheetErrorText}>{error}</Text>
                </View>
            )}

            <Pressable
                style={({ pressed }) => [styles.primary, danger && styles.danger, pressed && styles.pressed]}
                onPress={confirm}
                disabled={busy}
                accessibilityRole="button"
            >
                {busy ? (
                    <ActivityIndicator color={CARD} />
                ) : (
                    <Text style={styles.primaryText}>{error ? '다시 시도' : confirmLabel}</Text>
                )}
            </Pressable>
            <Pressable
                style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
                onPress={close}
                disabled={busy}
                accessibilityRole="button"
            >
                <Text style={styles.secondaryText}>취소</Text>
            </Pressable>
        </SheetFrame>
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
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
        >
            <Ionicons name={icon} size={23} color={active ? NAVY : DISABLED} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },

    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
    },

    header: {
        paddingBottom: 12,
        alignItems: 'center',
        backgroundColor: BACKGROUND,
    },

    headerTitle: {
        color: NAVY,
        fontSize: 18,
        fontWeight: '800',
    },

    content: {
        paddingHorizontal: 20,
        paddingTop: 8,
    },

    card: {
        overflow: 'hidden',
        borderRadius: 18,
        backgroundColor: CARD,
    },

    profile: {
        padding: 18,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },

    avatar: {
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: NAVY,
    },

    avatarText: {
        color: CARD,
        fontSize: 20,
        fontWeight: '800',
    },

    nickname: {
        color: NAVY,
        fontSize: 18,
        fontWeight: '800',
    },

    loginType: {
        marginTop: 3,
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
    },

    smallButton: {
        paddingHorizontal: 11,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: DIVIDER,
        borderRadius: 10,
        backgroundColor: CARD,
    },

    smallButtonText: {
        color: NAVY,
        fontSize: 13,
        fontWeight: '700',
    },

    skeleton: {
        backgroundColor: '#e3e7ee',
    },

    skeletonLine: {
        height: 12,
        borderRadius: 6,
        backgroundColor: '#e3e7ee',
    },

    errorCard: {
        padding: 22,
        alignItems: 'center',
        gap: 6,
    },

    errorTitle: {
        marginTop: 4,
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    errorText: {
        color: SECONDARY,
        fontSize: 13,
        fontWeight: '600',
    },

    retryButton: {
        marginTop: 8,
        paddingHorizontal: 16,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderRadius: 12,
        backgroundColor: NAVY,
    },

    retryText: {
        color: CARD,
        fontSize: 14,
        fontWeight: '700',
    },

    sectionTitle: {
        marginTop: 24,
        marginBottom: 10,
        color: NAVY,
        fontSize: 15,
        fontWeight: '800',
    },

    listRow: {
        minHeight: 54,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    listDivider: {
        borderTopWidth: 1,
        borderTopColor: DIVIDER,
    },

    listLabel: {
        color: NAVY,
        fontSize: 15,
        fontWeight: '700',
    },

    permission: {
        fontSize: 13.5,
        fontWeight: '700',
    },

    footer: {
        marginTop: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },

    footerText: {
        color: SECONDARY,
        fontSize: 12.5,
        fontWeight: '600',
    },

    footerBar: {
        width: 1,
        height: 11,
        backgroundColor: DIVIDER,
    },

    tabBar: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
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

    toast: {
        position: 'absolute',
        alignSelf: 'center',
        paddingHorizontal: 16,
        paddingVertical: 11,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        borderRadius: 14,
        backgroundColor: 'rgba(15,28,63,0.94)',
    },

    toastText: {
        color: CARD,
        fontSize: 14,
        fontWeight: '700',
    },

    sheetLayer: {
        ...StyleSheet.absoluteFill,
        justifyContent: 'flex-end',
    },

    dim: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(15,28,63,0.38)',
    },

    sheet: {
        paddingHorizontal: 20,
        paddingTop: 10,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: CARD,
    },

    sheetHandle: {
        width: 40,
        height: 4,
        marginBottom: 14,
        alignSelf: 'center',
        borderRadius: 2,
        backgroundColor: '#d9dde4',
    },

    sheetTitle: {
        alignSelf: 'center',
        color: NAVY,
        fontSize: 16,
        fontWeight: '800',
    },

    hero: {
        marginTop: 18,
        marginBottom: 20,
        alignItems: 'center',
    },

    heroIcon: {
        width: 52,
        height: 52,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: MINT_SOFT,
    },

    heroHeading: {
        marginTop: 14,
        color: NAVY,
        fontSize: 17,
        fontWeight: '800',
    },

    heroDescription: {
        marginTop: 8,
        color: SECONDARY,
        fontSize: 13.5,
        fontWeight: '500',
        lineHeight: 20,
        textAlign: 'center',
    },

    input: {
        height: 52,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1.5,
        borderColor: NAVY,
        borderRadius: 13,
    },

    inputError: {
        borderColor: RED,
    },

    inputText: {
        flex: 1,
        color: NAVY,
        fontSize: 16,
        fontWeight: '700',
    },

    counter: {
        color: DISABLED,
        fontSize: 12.5,
        fontWeight: '600',
    },

    inputHelp: {
        marginTop: 7,
        marginLeft: 2,
        color: SECONDARY,
        fontSize: 12.5,
        fontWeight: '600',
    },

    sheetError: {
        marginBottom: 4,
        padding: 11,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 7,
        borderRadius: 12,
        backgroundColor: '#fdecec',
    },

    sheetErrorText: {
        flex: 1,
        color: '#b42318',
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 18,
    },

    primary: {
        height: 52,
        marginTop: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        backgroundColor: NAVY,
    },

    primaryDisabled: {
        backgroundColor: '#c3c8d2',
    },

    danger: {
        backgroundColor: RED,
    },

    primaryText: {
        color: CARD,
        fontSize: 15.5,
        fontWeight: '800',
    },

    secondary: {
        height: 50,
        marginTop: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: DIVIDER,
        borderRadius: 14,
        backgroundColor: CARD,
    },

    secondaryText: {
        color: NAVY,
        fontSize: 15,
        fontWeight: '700',
    },

    pressed: {
        opacity: 0.72,
    },
});