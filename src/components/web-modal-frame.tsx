import type { ReactNode } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { WEB_APP_HEIGHT, WEB_APP_WIDTH, webAppScale } from '@/constants/web-app-frame';

/** Web Modal portals render under document.body, outside RootLayout's scaled app. */
export default function WebModalFrame({ children }: { children: ReactNode }) {
    const { width, height } = useWindowDimensions();
    if (Platform.OS !== 'web') return <>{children}</>;

    const scale = webAppScale(width, height);
    return (
        <View style={styles.viewport}>
            <View style={{ width: WEB_APP_WIDTH * scale, height: WEB_APP_HEIGHT * scale, overflow: 'hidden' }}>
                <View style={[styles.app, { transform: [{ scale }] }]}>{children}</View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    viewport: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    app: { width: WEB_APP_WIDTH, height: WEB_APP_HEIGHT, transformOrigin: 'top left' },
});
