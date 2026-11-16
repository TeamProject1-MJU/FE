import BottomTabBar, { useTabBarHeight } from '@/components/bottom-tab-bar';
import Passenger from '@/components/passenger';
import { UiColors } from '@/constants/linkro-colors';
import { useMock } from '@/services/api/config';
import { ApiError, API_ERROR_MESSAGES, isAuthError } from '@/services/api/errors';
import { ComponentProps, ReactNode, useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
    ActivityIndicator,
    BackHandler,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    View,
} from 'react-native';
import { Text, TextInput } from '@/components/app-text';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { fetchMe, logout, nicknameLength, updateNickname, validateNickname, withdraw } from '@/services/user';
import { useAppPermissions } from '@/hooks/use-app-permissions';
import { resetToLogin, useRedirectIfSignedOut } from '@/stores/auth-store';
import { APP_PERMISSIONS, PERMISSION_DISPLAY, permissionAccessibilityLabel } from '@/utils/app-permission';
import { NICKNAME_MAX, UserError, type UserProfile } from '@/types/user';
import { CARD_PADDING } from '@/constants/layout';

type IoniconName = ComponentProps<typeof Ionicons>['name'];
type Sheet = 'nickname' | 'logout' | 'withdraw' | null;
type Load = { kind: 'loading' } | { kind: 'error' } | { kind: 'done'; user: { nickname: string } };

/** 락 경합은 재시도를 안내하고, 나머지 서버·mock 오류는 기존 문구를 사용해요. */
function userErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof ApiError || error instanceof UserError) {
        return error.code === 'ROOM_BUSY' ? API_ERROR_MESSAGES.ROOM_BUSY : error.message;
    }
    return fallback;
}
/**
 * 마이페이지 (#38, 상세설계서 5.5 그림 40~43, API 명세 4.3~4.6)
 *
 * 내 정보(닉네임·로그인 방식), 앱 권한, 로그아웃·회원 탈퇴.
 * 앱 권한은 mock·서버 모드 모두 기기의 실제 권한 상태(카메라·위치)를 보여줘요(#130, use-app-permissions).
 * 닉네임 수정·로그아웃·회원 탈퇴는 상세설계서대로 아래에서 올라오는 시트로 엽니다.
 * 서버 모드도 내 정보를 조회하고, 수정 결과로 화면과 세션을 갱신해요.
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
    // 테스트용: /my?mock=withdraw-error → 첫 탈퇴 실패
    const [failWithdraw, setFailWithdraw] = useState(mock === 'withdraw-error');

    // 로그아웃한 뒤 이 화면으로 돌아오면 로그인 화면으로 보냅니다 (#40)
    useRedirectIfSignedOut();
    const permissions = useAppPermissions();

    const tabBarHeight = useTabBarHeight();

    const loadUser = useCallback(async () => {
        setLoad({ kind: 'loading' });
        try {
            const user = await fetchMe(failNext);
            setLoad({ kind: 'done', user });
        } catch (error) {
            if (!useMock() && isAuthError(error)) return;
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
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <StatusBar style="dark" />

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + 24 }]}>
                <Text style={styles.headerTitle}>마이</Text>
                {/* ❶ 프로필 카드 */}
                {load.kind === 'loading' && (
                    <View style={[styles.card, styles.profile]}>
                        <View style={[styles.avatar, styles.skeleton]} />
                        <View style={styles.flex}>
                            <View style={[styles.skeletonLine, { width: 90 }]} />
                            <View style={[styles.skeletonLine, { width: 64, marginTop: 8 }]} />
                        </View>
                        <ActivityIndicator color={UiColors.purple} />
                    </View>
                )}

                {load.kind === 'error' && (
                    <View style={[styles.card, styles.errorCard]}>
                        <Ionicons name="cloud-offline-outline" size={26} color={UiColors.muted} />
                        <Text style={styles.errorTitle}>내 정보를 불러오지 못했어요</Text>
                        <Text style={styles.errorText}>인터넷 연결을 확인한 뒤 다시 시도해 주세요.</Text>
                        <Pressable
                            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                            onPress={loadUser}
                            accessibilityRole="button"
                        >
                            <Ionicons name="refresh" size={16} color={UiColors.white} />
                            <Text style={styles.retryText}>다시 시도</Text>
                        </Pressable>
                    </View>
                )}

                {user && (
                    <View style={[styles.card, styles.profile]}>
                        <View style={styles.avatar}>
                            <Passenger tone="me" size={52} />
                        </View>
                        <View style={styles.flex}>
                            <View style={styles.nicknameRow}>
                                <Text style={styles.nickname} numberOfLines={1}>
                                    {user.nickname}
                                </Text>
                                <Pressable
                                    style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]}
                                    onPress={() => setSheet('nickname')}
                                    accessibilityRole="button"
                                    accessibilityLabel="닉네임 수정"
                                >
                                    <Text style={styles.smallButtonText}>닉네임 수정</Text>
                                </Pressable>
                            </View>
                            {/* 로그인은 카카오만 지원 (명세 4.1) */}
                            <Text style={styles.loginType}>카카오 로그인</Text>
                        </View>
                    </View>
                )}

                {/* ❷ 앱 권한 */}
                <Text style={styles.sectionTitle}>앱 권한</Text>
                <View style={styles.card}>
                    {APP_PERMISSIONS.map((item, index) => {
                        const state = permissions.states[item.key];
                        const display = state === 'loading' ? null : PERMISSION_DISPLAY[state];
                        const color = state === 'granted' ? UiColors.purple : state === 'denied' ? UiColors.sheetDanger : UiColors.muted;
                        return (
                            <Pressable
                                key={item.key}
                                style={({ pressed }) => [
                                    styles.listRow,
                                    index > 0 && styles.listDivider,
                                    pressed && styles.pressed,
                                ]}
                                // 허용·허용 안 함은 기기 설정을 열고, 아직 묻지 않음은 바로 요청, 확인할 수 없음은 다시 조회해요.
                                onPress={() => permissions.press(item.key)}
                                disabled={!display}
                                accessibilityRole="button"
                                accessibilityState={{ disabled: !display, busy: !display }}
                                accessibilityLabel={permissionAccessibilityLabel(item.label, state)}
                            >
                                <View style={styles.flex}>
                                    <Text style={styles.listLabel}>{item.label}</Text>
                                    {!!display?.hint && <Text style={styles.permissionHint}>{display.hint}</Text>}
                                </View>
                                {display
                                    ? <Text style={[styles.permission, { color }]}>{display.text}</Text>
                                    : <ActivityIndicator size="small" color={UiColors.muted} />}
                                <Ionicons name="chevron-forward" size={17} color={UiColors.chevron} />
                            </Pressable>
                        );
                    })}
                </View>

                {/* ❸ ❹ 계정 */}
                <Text style={styles.sectionTitle}>계정</Text>
                <View style={styles.card}>
                    <Pressable
                        style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                        onPress={() => setSheet('logout')}
                        accessibilityRole="button"
                    >
                        <Text style={[styles.listLabel, { color: UiColors.sheetDanger }]}>로그아웃</Text>
                    </Pressable>
                    <Pressable
                        style={({ pressed }) => [styles.listRow, styles.listDivider, pressed && styles.pressed]}
                        onPress={() => setSheet('withdraw')}
                        accessibilityRole="button"
                    >
                        <Text style={styles.listLabel}>회원 탈퇴</Text>
                    </Pressable>
                </View>

                {/* TODO: 이용약관·개인정보 처리방침 링크 (이슈 미정) */}
                <View style={styles.footer}>
                    <Text style={styles.footerText}>이용약관</Text>
                    <View style={styles.footerBar} />
                    <Text style={styles.footerText}>개인정보 처리방침</Text>
                </View>
            </ScrollView>

            {/* 하단 탭바 (홈·경로·약속방·마이) */}
            <BottomTabBar active="my" />

            {!!toast && (
                <View style={[styles.toast, { bottom: tabBarHeight + 16 }]} accessibilityLiveRegion="polite">
                    <Ionicons name="checkmark-circle" size={18} color={UiColors.toastCheck} />
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
                        if (useMock()) resetToLogin();
                    }}
                />
            )}

            {sheet === 'withdraw' && (
                <ConfirmSheet
                    title="회원 탈퇴"
                    icon="person-remove-outline"
                    heading="정말 탈퇴하시겠어요?"
                    description="탈퇴하면 아래처럼 처리돼요."
                    // 명세 4.6·4.1·7.8 기준 안내 (명세에 없는 '카카오 계정 삭제', '모든 기록 즉시 삭제' 같은 표현은 쓰지 않음)
                    details={[
                        '참여 중인 모든 약속방에서 나가요. 그 방에서 한 후보 투표도 함께 지워져요.',
                        '내가 방장인 방은 가장 먼저 들어온 참여자에게 방장이 넘어가요.',
                        '내가 마지막 참여자인 방은 대화·추천 기록과 함께 삭제돼요.',
                        '같은 카카오 계정으로 다시 로그인하면 계정은 복구되지만, 나간 약속방은 복구되지 않아요.',
                    ]}
                    confirmLabel="탈퇴하기"
                    danger
                    failText="탈퇴하지 못했어요."
                    successText={useMock() ? '탈퇴가 완료됐어요' : undefined}
                    onClose={() => setSheet(null)}
                    onConfirm={async () => {
                        const fail = failWithdraw;
                        setFailWithdraw(false); // 다시 시도하면 성공하도록
                        await withdraw(fail);
                    }}
                    // mock은 완료 안내 후 이동하고, 서버 모드는 서비스가 인증 정리 후 바로 이동해요.
                    onDone={useMock() ? resetToLogin : undefined}
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
                <Ionicons name={icon} size={24} color={UiColors.purple} />
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
    onSaved: (user: UserProfile) => void;
}) {
    const [value, setValue] = useState(current);
    const [focused, setFocused] = useState(false);
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
            if (!useMock() && isAuthError(error)) return;
            // 실패해도 입력값은 그대로 두고, 다시 저장할 수 있게 합니다.
            setSaveError(userErrorMessage(error, '저장하지 못했어요. 다시 시도해 주세요.'));
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

            <View style={[styles.input, (focused || !!value) && styles.inputActive, !!message && styles.inputError]}>
                <TextInput
                    style={styles.inputText}
                    value={value}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
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
                    placeholderTextColor={UiColors.faint}
                />
                <Text style={[styles.counter, length > NICKNAME_MAX && { color: UiColors.sheetDanger }]}>
                    {length}/{NICKNAME_MAX}
                </Text>
            </View>
            <Text style={[styles.inputHelp, !!message && { color: UiColors.sheetDanger }]}>
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
                    <ActivityIndicator color={UiColors.white} />
                ) : (
                    <Text style={[styles.primaryText, disabled && styles.primaryTextDisabled]}>{saveError ? '다시 저장' : '저장'}</Text>
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
                          details,
                          successText,
                          onClose,
                          onConfirm,
                          onDone,
                      }: {
    title: string;
    icon: IoniconName;
    heading: string;
    description: string;
    confirmLabel: string;
    danger?: boolean;
    /** 실패했을 때 제목 (예: '로그아웃하지 못했어요.') */
    failText?: string;
    /** 설명 아래 항목별 안내 */
    details?: string[];
    /** 있으면 성공 후 완료 안내를 잠깐 보여주고 onDone 을 부릅니다 */
    successText?: string;
    onClose: () => void;
    onConfirm: () => Promise<void>;
    onDone?: () => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!done) return;
        const timer = setTimeout(() => onDone?.(), 1200);
        return () => clearTimeout(timer);
    }, [done, onDone]);

    const confirm = async () => {
        setBusy(true);
        setError('');
        try {
            await onConfirm();
            if (successText) setDone(true);
        } catch (caught) {
            // 인증 무효화는 공통 클라이언트가 이동까지 처리하므로 시트에서 다시 안내하지 않아요.
            if (!useMock() && isAuthError(caught)) return;
            // 실패하면 시트를 닫지 않고 안내 + 다시 시도
            setError(userErrorMessage(caught, failText ?? '처리하지 못했어요. 다시 시도해 주세요.'));
        } finally {
            setBusy(false);
        }
    };

    // 처리 중·완료 후에는 닫지 않습니다.
    const close = () => {
        if (!busy && !done) onClose();
    };

    if (done) {
        return (
            <SheetFrame title={title} onClose={close}>
                <View style={styles.doneBox} accessibilityLiveRegion="polite">
                    <Ionicons name="checkmark-circle" size={44} color={UiColors.purple} />
                    <Text style={styles.heroHeading}>{successText}</Text>
                    <Text style={styles.heroDescription}>로그인 화면으로 이동할게요.</Text>
                </View>
            </SheetFrame>
        );
    }

    return (
        <SheetFrame title={title} onClose={close}>
            <SheetHero icon={icon} heading={heading} description={description} />

            {!!details?.length && (
                <View style={styles.details}>
                    {details.map(item => (
                        <View key={item} style={styles.detailRow}>
                            <View style={styles.detailDot} />
                            <Text style={styles.detailText}>{item}</Text>
                        </View>
                    ))}
                </View>
            )}

            {!!error && (
                <View style={styles.sheetError} accessibilityLiveRegion="polite">
                    <Ionicons name="alert-circle" size={17} color={UiColors.sheetDanger} />
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
                    <ActivityIndicator color={UiColors.white} />
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

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },

    container: {
        flex: 1,
        backgroundColor: UiColors.bg,
    },

    headerTitle: {
        color: UiColors.ink,
        fontSize: 30,
        fontWeight: '800',
        letterSpacing: -0.6,
        paddingBottom: 14,
        // #224 글자 줄 맞춤: 카드 안 글자 시작선에 맞춰요.
        paddingHorizontal: CARD_PADDING,
    },

    content: {
        paddingHorizontal: 20,
        paddingTop: 14,
    },

    card: {
        overflow: 'hidden',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: UiColors.line,
        backgroundColor: UiColors.white,
    },

    profile: {
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },

    avatar: {
        width: 72,
        height: 72,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: UiColors.tint,
    },

    nicknameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    nickname: {
        flexShrink: 1,
        color: UiColors.ink,
        fontSize: 20,
        fontWeight: '800',
    },

    loginType: {
        marginTop: 4,
        color: UiColors.muted,
        fontSize: 13,
    },

    smallButton: {
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: UiColors.tint,
    },

    smallButtonText: {
        color: UiColors.purple,
        fontSize: 12.5,
        fontWeight: '700',
    },

    skeleton: {
        backgroundColor: UiColors.tint,
    },

    skeletonLine: {
        height: 12,
        borderRadius: 6,
        backgroundColor: UiColors.tint,
    },

    errorCard: {
        padding: 22,
        alignItems: 'center',
        gap: 6,
    },

    errorTitle: {
        marginTop: 4,
        color: UiColors.ink,
        fontSize: 16,
        fontWeight: '800',
    },

    errorText: {
        color: UiColors.muted,
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
        backgroundColor: UiColors.purple,
    },

    retryText: {
        color: UiColors.white,
        fontSize: 14,
        fontWeight: '700',
    },

    sectionTitle: {
        marginTop: 22,
        marginHorizontal: CARD_PADDING,
        marginBottom: 8,
        color: UiColors.ink,
        fontSize: 15,
        fontWeight: '800',
    },

    listRow: {
        paddingVertical: 15,
        paddingHorizontal: 16,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },

    listDivider: {
        borderTopWidth: 1,
        borderTopColor: UiColors.lineSoft,
    },

    listLabel: {
        color: UiColors.ink,
        fontSize: 15,
    },

    permission: {
        fontSize: 13,
        fontWeight: '700',
    },

    permissionHint: {
        marginTop: 2,
        color: UiColors.muted,
        fontSize: 12,
        fontWeight: '400',
    },

    footer: {
        marginTop: 22,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
    },

    footerText: {
        color: UiColors.tabInactive,
        fontSize: 12,
    },

    footerBar: {
        width: 1,
        height: 11,
        backgroundColor: UiColors.lineSoft,
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
        backgroundColor: UiColors.toast,
    },

    toastText: {
        color: UiColors.white,
        fontSize: 14,
        fontWeight: '700',
    },

    sheetLayer: {
        ...StyleSheet.absoluteFill,
        justifyContent: 'flex-end',
    },

    dim: {
        ...StyleSheet.absoluteFill,
        backgroundColor: UiColors.dim,
    },

    sheet: {
        paddingHorizontal: 20,
        paddingTop: 10,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: UiColors.white,
    },

    sheetHandle: {
        width: 40,
        height: 4,
        marginBottom: 14,
        alignSelf: 'center',
        borderRadius: 2,
        backgroundColor: UiColors.handle,
    },

    sheetTitle: {
        alignSelf: 'center',
        color: UiColors.ink,
        fontSize: 15,
        fontWeight: '700',
    },

    hero: {
        marginTop: 18,
        marginBottom: 20,
        alignItems: 'center',
    },

    heroIcon: {
        width: 56,
        height: 56,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: UiColors.tint,
    },

    heroHeading: {
        marginTop: 14,
        color: UiColors.ink,
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: -0.3,
    },

    heroDescription: {
        marginTop: 8,
        color: UiColors.muted,
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
        borderWidth: 1,
        borderColor: UiColors.line,
        borderRadius: 12,
    },

    inputActive: {
        borderColor: UiColors.purple,
    },

    inputError: {
        borderColor: UiColors.sheetDanger,
    },

    inputText: {
        flex: 1,
        color: UiColors.ink,
        fontSize: 15,
        fontWeight: '700',
    },

    counter: {
        color: UiColors.muted,
        fontSize: 12,
        fontWeight: '600',
    },

    inputHelp: {
        marginTop: 7,
        marginLeft: 2,
        color: UiColors.muted,
        fontSize: 12.5,
        fontWeight: '600',
    },

    details: {
        marginTop: -6,
        marginBottom: 6,
        padding: 13,
        gap: 8,
        borderRadius: 13,
        backgroundColor: UiColors.bg,
    },

    detailRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 8,
    },

    detailDot: {
        width: 5,
        height: 5,
        marginTop: 7,
        borderRadius: 3,
        backgroundColor: UiColors.chevron,
    },

    detailText: {
        flex: 1,
        color: UiColors.muted,
        fontSize: 13,
        fontWeight: '600',
        lineHeight: 19,
    },

    doneBox: {
        paddingTop: 22,
        paddingBottom: 28,
        alignItems: 'center',
    },

    sheetError: {
        marginBottom: 4,
        padding: 11,
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 7,
        borderRadius: 12,
        backgroundColor: UiColors.errorBg,
    },

    sheetErrorText: {
        flex: 1,
        color: UiColors.sheetDanger,
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
        backgroundColor: UiColors.purple,
    },

    primaryDisabled: {
        backgroundColor: UiColors.buttonDisabled,
    },

    danger: {
        backgroundColor: UiColors.sheetDanger,
    },

    primaryText: {
        color: UiColors.white,
        fontSize: 15,
        fontWeight: '600',
    },

    primaryTextDisabled: {
        color: UiColors.faint,
    },

    secondary: {
        height: 52,
        marginTop: 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        backgroundColor: UiColors.chip,
    },

    secondaryText: {
        color: UiColors.purple,
        fontSize: 15,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.72,
    },
});
