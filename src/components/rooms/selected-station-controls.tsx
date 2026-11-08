import {
    ActivityIndicator,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';

import {
    selectedStationName,
    type useSelectedStation,
} from '@/hooks/use-selected-station';
import type { RoomDetail } from '@/types/room';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';

export default function SelectedStationControls({
                                                    detail,
                                                    controller,
                                                    bottomInset,
                                                }: {
    detail: RoomDetail;
    controller: ReturnType<typeof useSelectedStation>;
    bottomInset: number;
}) {
    const { busy, request, notice, pick, choose, submit, cancel } = controller;
    const owner = detail.myRole === 'OWNER';
    const clearing = request?.station === null;
    const changing = !!request?.previous && !clearing;
    const targetName = request?.station
        ? selectedStationName(request.station)
        : '';
    const previousName = request?.previous
        ? selectedStationName(request.previous)
        : '';

    const noticeView = notice && (
        <View
            style={[styles.notice, notice.error && styles.error]}
            accessibilityLiveRegion="polite"
        >
            <Text style={[styles.noticeText, notice.error && styles.errorText]}>
                {notice.text}
            </Text>
            {notice.error && notice.pick && owner && (
                <Action label="다른 역 선택" onPress={pick} />
            )}
        </View>
    );

    return (
        <View style={styles.panel}>
            {detail.selectedStation && detail.confirmedAt && (
                <Text style={styles.caption}>
                    확정 시각 ·{' '}
                    {new Intl.DateTimeFormat('ko-KR', {
                        timeZone: 'Asia/Seoul',
                        month: 'numeric',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                    }).format(new Date(detail.confirmedAt))}
                </Text>
            )}

            {owner ? (
                <View style={styles.row}>
                    <Action
                        label={detail.selectedStation ? '약속역 변경' : '다른 역 선택'}
                        onPress={pick}
                        disabled={busy}
                    />
                    {detail.selectedStation && (
                        <Action
                            label="확정 해제"
                            onPress={() => choose(null)}
                            disabled={busy}
                            danger
                        />
                    )}
                </View>
            ) : (
                <Text style={styles.caption}>방장이 최종 확정할 수 있어요</Text>
            )}

            {!request && noticeView}

            {request && (
                <Modal
                    visible
                    transparent
                    animationType="fade"
                    onRequestClose={cancel}
                >
                    <View style={styles.backdrop}>
                        <Pressable
                            style={StyleSheet.absoluteFill}
                            onPress={cancel}
                            disabled={busy}
                            accessibilityLabel="확인창 닫기"
                        />
                        <View
                            style={[
                                styles.sheet,
                                { paddingBottom: bottomInset + 20 },
                            ]}
                            accessibilityViewIsModal
                        >
                            <ScrollView contentContainerStyle={styles.sheetContent}>
                                <Text accessibilityRole="header" style={styles.title}>
                                    {clearing
                                        ? '확정한 약속역을 해제할까요?'
                                        : `${targetName}${
                                            changing
                                                ? '으로 변경할까요?'
                                                : '으로 확정할까요?'
                                        }`}
                                </Text>

                                {changing && (
                                    <Text style={styles.transition}>
                                        {previousName} → {targetName}
                                    </Text>
                                )}

                                <Text style={styles.body}>
                                    {clearing
                                        ? '약속역이 미정으로 바뀌어요. 후보 목록과 투표는 그대로 유지돼요.'
                                        : '투표 결과와 관계없이 선택한 역으로 정해요. 약속 시간과 후보·투표는 그대로 유지돼요.'}
                                </Text>

                                {noticeView}

                                {busy && (
                                    <View
                                        style={styles.row}
                                        accessibilityLiveRegion="polite"
                                    >
                                        <ActivityIndicator color={NAVY} />
                                        <Text style={styles.body}>
                                            {clearing
                                                ? '해제하는 중이에요'
                                                : '약속역을 저장하는 중이에요'}
                                        </Text>
                                    </View>
                                )}

                                <View style={styles.row}>
                                    <Action
                                        label="취소"
                                        onPress={cancel}
                                        disabled={busy}
                                    />
                                    <Action
                                        label={
                                            notice?.retry
                                                ? '다시 시도'
                                                : clearing
                                                    ? '확정 해제'
                                                    : changing
                                                        ? '변경하기'
                                                        : '확정하기'
                                        }
                                        onPress={submit}
                                        disabled={busy}
                                        primary
                                        danger={clearing}
                                    />
                                </View>
                            </ScrollView>
                        </View>
                    </View>
                </Modal>
            )}
        </View>
    );
}

function Action({
                    label,
                    onPress,
                    disabled,
                    primary,
                    danger,
                }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    primary?: boolean;
    danger?: boolean;
}) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !!disabled }}
            onPress={onPress}
            disabled={disabled}
            style={({ pressed }) => [
                styles.button,
                primary && styles.primary,
                disabled && styles.disabled,
                pressed && styles.pressed,
            ]}
        >
            <Text
                style={[
                    styles.buttonText,
                    primary && styles.primaryText,
                    danger && !primary && styles.errorText,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    panel: {
        padding: 16,
        gap: 12,
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e6e9ef',
        borderRadius: 18,
    },
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
    },
    caption: {
        color: '#6b7488',
        fontSize: 12,
        lineHeight: 19,
    },
    button: {
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: '#e6e9ef',
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#fff',
    },
    primary: {
        borderColor: NAVY,
        backgroundColor: NAVY,
    },
    buttonText: {
        color: NAVY,
        fontSize: 13,
        fontWeight: '700',
    },
    primaryText: {
        color: '#fff',
    },
    disabled: {
        opacity: 0.5,
    },
    pressed: {
        opacity: 0.75,
    },
    notice: {
        borderRadius: 12,
        padding: 12,
        gap: 10,
        backgroundColor: '#e6f8f1',
        borderLeftWidth: 3,
        borderLeftColor: MINT,
    },
    noticeText: {
        fontSize: 13,
        lineHeight: 21,
        color: '#15664e',
    },
    error: {
        backgroundColor: '#fff1f0',
        borderLeftColor: '#d6455d',
    },
    errorText: {
        color: '#a13131',
    },
    backdrop: {
        flex: 1,
        backgroundColor: '#00000066',
        justifyContent: 'flex-end',
    },
    sheet: {
        width: '100%',
        maxWidth: 600,
        alignSelf: 'center',
        maxHeight: '85%',
        backgroundColor: '#fff',
        padding: 20,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    sheetContent: {
        gap: 16,
    },
    title: {
        color: NAVY,
        fontSize: 20,
        lineHeight: 29,
        fontWeight: '800',
    },
    transition: {
        color: NAVY,
        fontSize: 16,
        lineHeight: 24,
        fontWeight: '700',
    },
    body: {
        color: '#6b7488',
        fontSize: 14,
        lineHeight: 22,
    },
});