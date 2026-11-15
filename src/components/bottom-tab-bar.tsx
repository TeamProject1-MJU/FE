import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UiColors } from '@/constants/linkro-colors';

export const TAB_BAR_CONTENT_HEIGHT = 54;

type TabKey = 'home' | 'route' | 'rooms' | 'my';
const TABS: { key: TabKey; label: string; go: () => void }[] = [
    { key: 'home', label: '홈', go: () => router.navigate('/home') },
    { key: 'route', label: '경로', go: () => router.push('/route-search') },
    { key: 'rooms', label: '약속방', go: () => router.navigate('/rooms') },
    { key: 'my', label: '마이', go: () => router.navigate('/my') },
];

const ICON_PATHS: Record<TabKey, string> = {
    home: '<path d="M3.5 10.2 12 3.5l8.5 6.7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z"/>',
    route: '<circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/><path d="M8.5 18.5H16a3.5 3.5 0 0 0 0-7H8a3.5 3.5 0 0 1 0-7h7.5"/>',
    rooms: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.3c2.1.7 3.5 2.8 3.5 5.7"/>',
    my: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
};

const iconSources = new Map<string, { uri: string }>();

function iconSource(tab: TabKey, color: string) {
    const key = `${tab}:${color}`;
    let source = iconSources.get(key);
    if (!source) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[tab]}</svg>`;
        source = { uri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
        iconSources.set(key, source);
    }
    return source;
}

/** 탭바 높이 (화면 아래 여백 계산용) */
export function useTabBarHeight() {
    const insets = useSafeAreaInsets();
    return TAB_BAR_CONTENT_HEIGHT + Math.max(insets.bottom, 8);
}

/**
 * 하단 탭바 (홈·경로·약속방·마이) (#42)
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
                        <Image
                            source={iconSource(tab.key, selected ? UiColors.purple : UiColors.tabInactive)}
                            style={styles.icon}
                            contentFit="contain"
                            accessible={false}
                        />
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
        zIndex: 10,
        paddingTop: 6,
        paddingHorizontal: 8,
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: UiColors.lineSoft,
        backgroundColor: UiColors.white,
    },

    item: {
        flex: 1,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
    },

    icon: {
        width: 24,
        height: 24,
    },

    label: {
        color: UiColors.tabInactive,
        fontSize: 11,
        fontWeight: '500',
    },

    labelActive: {
        color: UiColors.purple,
        fontWeight: '700',
    },
});
