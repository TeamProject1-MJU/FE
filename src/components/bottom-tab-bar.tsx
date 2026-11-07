import { ComponentProps } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

const NAVY = '#0f1c3f';
const DISABLED = '#a1a8b8';
const DIVIDER = '#e6e9ef';
const CARD = '#ffffff';

export const TAB_BAR_CONTENT_HEIGHT = 58;

type TabKey = 'home' | 'route' | 'rooms' | 'my';
type IoniconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { key: TabKey; label: string; icon: IoniconName; activeIcon: IoniconName; go: () => void }[] = [
    { key: 'home', label: '홈', icon: 'home-outline', activeIcon: 'home', go: () => router.navigate('/home') },
    { key: 'route', label: '경로', icon: 'navigate-outline', activeIcon: 'navigate', go: () => router.push('/route-search') },
    { key: 'rooms', label: '약속방', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles', go: () => router.navigate('/rooms') },
    { key: 'my', label: '마이', icon: 'person-outline', activeIcon: 'person', go: () => router.navigate('/my') },
];

/** 탭바 높이 (화면 아래 여백 계산용) */
export function useTabBarHeight() {
    const insets = useSafeAreaInsets();
    return TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 8);
}

/**
 * 하단 탭바 (홈·경로·약속방·마이) (#42)
 * TODO: 홈·마이 화면의 탭바도 이 컴포넌트로 바꿉니다.
 */
export default function BottomTabBar({ active }: { active: TabKey }) {
    const insets = useSafeAreaInsets();
    const height = useTabBarHeight();

    return (
        <View style={[styles.bar, { height, paddingBottom: Math.max(insets.bottom, 8) }]}>
    {TABS.map(tab => {
        const selected = tab.key === active;
        return (
            <Pressable
                key={tab.key}
        style={styles.item}
        onPress={selected ? undefined : tab.go}
        accessibilityRole="tab"
        accessibilityLabel={tab.label}
        accessibilityState={{ selected }}
    >
        <Ionicons name={selected ? tab.activeIcon : tab.icon} size={23} color={selected ? NAVY : DISABLED} />
        <Text style={[styles.label, selected && styles.labelActive]}>{tab.label}</Text>
        </Pressable>
    );
    })}
    </View>
);
}

const styles = StyleSheet.create({
    bar: {
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

    item: {
        width: 68,
        alignItems: 'center',
        gap: 3,
    },

    label: {
        color: DISABLED,
        fontSize: 12,
        fontWeight: '600',
    },

    labelActive: {
        color: NAVY,
        fontWeight: '800',
    },
});