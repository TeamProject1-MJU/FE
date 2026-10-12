import { Stack } from 'expo-router';
import {
    Platform,
    StyleSheet,
    useWindowDimensions,
    View,
} from 'react-native';

const DESIGN_WIDTH = 393;
const DESIGN_HEIGHT = 852;

export default function RootLayout() {
    const { width, height } = useWindowDimensions();

    const isWeb = Platform.OS === 'web';

    if (!isWeb) {
        return (
            <View style={styles.nativePage}>
                <Stack screenOptions={{ headerShown: false }} />
            </View>
        );
    }

    const maxScale = 0.9;

    const webScale = Math.min(
        maxScale,
        width / DESIGN_WIDTH,
        height / DESIGN_HEIGHT,
    );

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
                    <Stack screenOptions={{ headerShown: false }} />
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