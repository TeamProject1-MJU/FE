import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import {
    ActivityIndicator,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import { leaveRoom, previewLeave } from '@/services/room';
import {
    RoomError,
    type LeaveRoomMock,
    type LeaveRoomResult,
    type RoomDetail,
} from '@/types/room';

const NAVY = '#0f1c3f';
const RED = '#c43c50';

type LeaveError = {
    message: string;
    terminal: boolean;
};

export default function RoomLeaveSheet({
                                           detail,
                                           bottomInset,
                                           mock,
                                           onClose,
                                           onLeft,
                                       }: {
    detail: RoomDetail;
    bottomInset: number;
    mock?: LeaveRoomMock;
    onClose: () => void;
    onLeft: (result: LeaveRoomResult) => void;
}) {
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<LeaveError | null>(null);
    const inFlight = useRef(false);
    const mounted = useRef(false);
    const { willDelete, nextOwner } = previewLeave(detail);

    useEffect(() => {
        mounted.current = true;
        Keyboard.dismiss();

        return () => {
            mounted.current = false;
        };
    }, []);

    const goToList = () => {
        if (router.canDismiss()) router.dismissAll();
        router.replace('/rooms');
    };

    const close = () => {
        if (inFlight.current) return;

        if (error?.terminal) {
            goToList();
        } else {
            onClose();
        }
    };

    const submit = async () => {
        if (inFlight.current) return;

        if (error?.terminal) {
            goToList();
            return;
        }

        inFlight.current = true;
        setBusy(true);
        setError(null);

        let result: LeaveRoomResult | undefined;

        try {
            result = await leaveRoom(detail.id, mock);
        } catch (failure) {
            if (mounted.current) {
                setError({
                    message:
                        failure instanceof RoomError
                            ? failure.message
                            : '나가기를 완료하지 못했어요. 다시 시도해 주세요.',
                    terminal:
                        failure instanceof RoomError &&
                        (failure.code === 'NOT_ROOM_MEMBER' ||
                            failure.code === 'ROOM_NOT_FOUND'),
                });
            }
        } finally {
            inFlight.current = false;

            if (mounted.current) {
                setBusy(false);
            }
        }

        // 성공 후 화면 이동은 요청 실패 처리와 분리해요.
        if (result && mounted.current) {
            onLeft(result);
        }
    };

    const confirmLabel = error?.terminal
        ? '목록으로'
        : error
            ? '다시 시도'
            : willDelete
                ? '방 삭제하고 나가기'
                : nextOwner
                    ? '승계하고 나가기'
                    : '나가기';

    const dialog = (
        <View
            style={[
                styles.backdrop,
                Platform.OS === 'web' && styles.webBackdrop,
            ]}
        >
            <Pressable
                style={StyleSheet.absoluteFill}
                onPress={close}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="나가기 확인창 닫기"
            />

            <View
                style={[
                    styles.sheet,
                    { paddingBottom: bottomInset + 20 },
                ]}
                accessibilityViewIsModal
            >
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    <Text
                        style={styles.title}
                        accessibilityRole="header"
                    >
                        {willDelete
                            ? '방을 삭제하고 나갈까요?'
                            : nextOwner
                                ? '방장을 넘기고 나갈까요?'
                                : '약속방에서 나갈까요?'}
                    </Text>

                    <Text style={styles.body}>
                        {willDelete
                            ? '현재 이 방의 마지막 멤버예요.'
                            : '나간 뒤에는 이 방의 대화와 후보를 볼 수 없어요. 다른 멤버의 약속방은 유지돼요.'}
                    </Text>

                    {nextOwner && !willDelete && (
                        <View style={styles.ownerBox}>
                            <Text style={styles.ownerText}>
                                {nextOwner}님에게 방장 권한을 넘겨요.
                            </Text>
                        </View>
                    )}

                    {willDelete ? (
                        <View style={styles.warning}>
                            <Text style={styles.warningText}>
                                방 정보·대화·후보·투표·추천 기록이
                                영구적으로 삭제돼요. 삭제한 기록은
                                되돌릴 수 없어요.
                            </Text>
                        </View>
                    ) : (
                        <Text style={styles.hint}>
                            초대 코드로 다시 참여할 수 있어요.
                        </Text>
                    )}

                    {error && (
                        <View
                            style={styles.warning}
                            accessibilityLiveRegion="polite"
                        >
                            <Text style={styles.warningText}>
                                {error.message}
                            </Text>

                            {error.terminal && (
                                <Text style={styles.warningText}>
                                    약속방 목록에서 현재 상태를
                                    확인해 주세요.
                                </Text>
                            )}
                        </View>
                    )}

                    {busy && (
                        <View
                            style={styles.progress}
                            accessibilityLiveRegion="polite"
                        >
                            <ActivityIndicator color={NAVY} />
                            <Text style={styles.body}>
                                나가기를 처리하고 있어요.
                                잠시 기다려 주세요.
                            </Text>
                        </View>
                    )}

                    <View style={styles.actions}>
                        {!error?.terminal && (
                            <Action
                                label="취소"
                                onPress={close}
                                disabled={busy}
                            />
                        )}

                        <Action
                            label={
                                busy
                                    ? '처리하는 중이에요…'
                                    : confirmLabel
                            }
                            onPress={() => {
                                void submit();
                            }}
                            disabled={busy}
                            danger={!error?.terminal}
                        />
                    </View>
                </ScrollView>
            </View>
        </View>
    );

    // 웹에서는 앱 표시 영역 안에 확인창을 표시해요.
    if (Platform.OS === 'web') return dialog;

    // 아이폰에서는 기본 Modal을 사용해요.
    return (
        <Modal
            visible
            transparent
            animationType="fade"
            onRequestClose={close}
        >
            {dialog}
        </Modal>
    );
}

function Action({
                    label,
                    onPress,
                    disabled,
                    danger,
                }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
    danger?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled }}
            onPress={onPress}
            disabled={disabled}
            style={({ pressed }) => [
                styles.button,
                danger && styles.danger,
                disabled && styles.disabled,
                pressed && styles.pressed,
            ]}
        >
            <Text
                style={[
                    styles.buttonText,
                    danger && styles.dangerText,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: '#00000066',
        justifyContent: 'flex-end',
    },
    webBackdrop: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 80,
    },
    sheet: {
        width: '100%',
        maxWidth: 600,
        maxHeight: '85%',
        alignSelf: 'center',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: '#fff',
        padding: 20,
    },
    content: {
        gap: 16,
    },
    title: {
        color: NAVY,
        fontSize: 21,
        lineHeight: 30,
        fontWeight: '800',
    },
    body: {
        color: '#6b7488',
        fontSize: 14,
        lineHeight: 23,
    },
    hint: {
        color: '#6b7488',
        fontSize: 12,
        lineHeight: 20,
    },
    ownerBox: {
        backgroundColor: '#eafaf4',
        borderLeftWidth: 3,
        borderLeftColor: '#2bcf9a',
        borderRadius: 12,
        padding: 12,
    },
    ownerText: {
        color: '#15664e',
        fontSize: 14,
        lineHeight: 23,
        fontWeight: '700',
    },
    warning: {
        backgroundColor: '#fff1f0',
        borderRadius: 12,
        padding: 12,
        gap: 8,
    },
    warningText: {
        color: '#a13131',
        fontSize: 13,
        lineHeight: 22,
    },
    progress: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
    },
    actions: {
        flexDirection: 'row',
        gap: 10,
    },
    button: {
        flex: 1,
        minHeight: 46,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 12,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: '#e6e9ef',
        borderRadius: 12,
        backgroundColor: '#fff',
    },
    buttonText: {
        color: NAVY,
        fontSize: 13,
        lineHeight: 21,
        textAlign: 'center',
        fontWeight: '700',
    },
    danger: {
        backgroundColor: RED,
        borderColor: RED,
    },
    dangerText: {
        color: '#fff',
    },
    disabled: {
        opacity: 0.5,
    },
    pressed: {
        opacity: 0.75,
    },
});