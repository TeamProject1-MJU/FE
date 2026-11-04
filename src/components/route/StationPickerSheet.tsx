import { useEffect, useState } from 'react';
import {
    FlatList,
    Modal,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import LineBadge from '@/components/route/LineBadge';
import { fetchStations } from '@/services/route';
import type { StationSummary } from '@/types/route';

const NAVY = '#0f1c3f';
const SECONDARY = '#6b7488';
const BACKGROUND = '#f3f5f8';
const BORDER = '#e6e9ef';

const LINE_COLORS: Record<number, string> = {
    1: '#0052A4', 2: '#00A84D', 3: '#EF7C1C', 4: '#00A5DE',
    5: '#996CAC', 6: '#CD7C2F', 7: '#747F00', 8: '#E6186C',
};

type Props = {
    visible: boolean;
    title: string;
    onSelect: (station: StationSummary) => void;
    onClose: () => void;
};

/**
 * 임시 역 선택 시트 (#34)
 *
 * TODO: 공통 역 검색·선택 화면(선행 이슈)이 머지되면 그 화면으로 교체합니다.
 * 교체 시 route-search.tsx 의 openPicker / handleSelect 만 바꾸면 됩니다.
 */
export default function StationPickerSheet({ visible, title, onSelect, onClose }: Props) {
    const insets = useSafeAreaInsets();
    const [keyword, setKeyword] = useState('');
    const [stations, setStations] = useState<StationSummary[]>([]);

    useEffect(() => {
        if (!visible) return;
        let alive = true;
        fetchStations(keyword).then(list => {
            if (alive) setStations(list);
        });
        return () => {
            alive = false;
        };
    }, [keyword, visible]);

    useEffect(() => {
        if (!visible) setKeyword('');
    }, [visible]);

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} onPress={onClose} />

            <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
                <View style={styles.handle} />

                <View style={styles.header}>
                    <Text style={styles.title}>{title}</Text>
                    <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="닫기">
                        <Ionicons name="close" size={24} color={NAVY} />
                    </Pressable>
                </View>

                <View style={styles.searchBox}>
                    <Ionicons name="search-outline" size={19} color={NAVY} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="역 이름을 검색하세요"
                        placeholderTextColor="#a1a8b8"
                        value={keyword}
                        onChangeText={setKeyword}
                        autoFocus
                        returnKeyType="search"
                    />
                </View>

                <FlatList
                    data={stations}
                    keyExtractor={item => String(item.id)}
                    keyboardShouldPersistTaps="handled"
                    style={styles.list}
                    ListEmptyComponent={<Text style={styles.empty}>검색 결과가 없어요</Text>}
                    renderItem={({ item }) => (
                        <Pressable
                            style={({ pressed }) => [styles.item, pressed && item.isSupported && styles.pressed]}
                            disabled={!item.isSupported}
                            onPress={() => onSelect(item)}
                            accessibilityState={{ disabled: !item.isSupported }}
                        >
                            <Text style={[styles.itemName, !item.isSupported && styles.disabledText]}>
                                {item.name}
                            </Text>

                            <View style={styles.badges}>
                                {item.lines.map(lineNo => (
                                    <LineBadge
                                        key={lineNo}
                                        line={{ id: lineNo, name: `${lineNo}호선`, color: LINE_COLORS[lineNo] ?? null }}
                                        size={18}
                                    />
                                ))}
                            </View>

                            <View style={styles.flex} />

                            {!item.isSupported && (
                                <View style={styles.unsupported}>
                                    <Text style={styles.unsupportedText}>미지원</Text>
                                </View>
                            )}
                        </Pressable>
                    )}
                />
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },

    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(15,28,63,0.35)',
    },

    sheet: {
        maxHeight: '75%',
        paddingHorizontal: 20,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        backgroundColor: '#ffffff',
    },

    handle: {
        width: 36,
        height: 4,
        marginTop: 10,
        alignSelf: 'center',
        borderRadius: 999,
        backgroundColor: '#d5dae3',
    },

    header: {
        marginTop: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },

    title: {
        color: NAVY,
        fontSize: 18,
        fontWeight: '800',
    },

    searchBox: {
        height: 48,
        marginTop: 14,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderRadius: 14,
        backgroundColor: BACKGROUND,
    },

    searchInput: {
        flex: 1,
        color: NAVY,
        fontSize: 15,
        fontWeight: '600',
    },

    list: {
        marginTop: 8,
    },

    item: {
        height: 54,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },

    itemName: {
        color: NAVY,
        fontSize: 16,
        fontWeight: '700',
    },

    disabledText: {
        color: '#a1a8b8',
    },

    badges: {
        flexDirection: 'row',
        gap: 4,
    },

    unsupported: {
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 7,
        backgroundColor: BACKGROUND,
    },

    unsupportedText: {
        color: SECONDARY,
        fontSize: 12,
        fontWeight: '700',
    },

    empty: {
        marginTop: 24,
        textAlign: 'center',
        color: SECONDARY,
        fontSize: 14,
        fontWeight: '600',
    },

    pressed: {
        opacity: 0.6,
    },
});
