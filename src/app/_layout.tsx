import AuthGate from '@/components/auth-gate';
import SplashOverlay from '@/components/splash/splash-overlay';
import { tabScreenOptions } from '@/utils/tab-navigation';
import { WEB_APP_WIDTH as DESIGN_WIDTH, WEB_APP_HEIGHT as DESIGN_HEIGHT, webAppScale } from '@/constants/web-app-frame';
import type { ReactNode } from 'react';
import { Stack } from 'expo-router';
import {
    Platform,
    StyleSheet,
    useWindowDimensions,
    View,
} from 'react-native';

const screenLayout = ({ children }: { children: ReactNode }) => <AuthGate>{children}</AuthGate>;

export default function RootLayout() {
    const { width, height } = useWindowDimensions();

    const isWeb = Platform.OS === 'web';
    const stack = <Stack screenOptions={{ headerShown: false }} screenLayout={screenLayout}>
        <Stack.Screen name="home" options={tabScreenOptions} />
        <Stack.Screen name="route-search" options={tabScreenOptions} />
        <Stack.Screen name="rooms/index" options={tabScreenOptions} />
        <Stack.Screen name="my" options={tabScreenOptions} />
    </Stack>;

    if (!isWeb) {
        return (
            <View style={styles.nativePage}>
                {stack}
                <SplashOverlay />
            </View>
        );
    }

    const webScale = webAppScale(width, height);

    const scaledWidth = DESIGN_WIDTH * webScale;
    const scaledHeight = DESIGN_HEIGHT * webScale;

    return (
        <View style={styles.webPage}>
            <View
                style={{
                    width: scaledWidth,
                    height: scaledHeight,
                    overflow: 'hidden',
                }}
            >
                <View
                    style={[
                        styles.webApp,
                        {
                            transform: [{ scale: webScale }],
                        },
                    ]}
                >
                    {stack}
                    <SplashOverlay />
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    nativePage: {
        flex: 1,
        backgroundColor: '#fff',
    },

    webPage: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#222',
    },

    webApp: {
        width: DESIGN_WIDTH,
        height: DESIGN_HEIGHT,
        transformOrigin: 'top left',
        overflow: 'hidden',
        backgroundColor: '#fff',
    },
});
