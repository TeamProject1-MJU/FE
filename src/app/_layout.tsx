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
    const isDesktopWeb = isWeb && width >= 600;

    const webScale = isDesktopWeb ? 0.9 : 1;

    let frameWidth = width;
    let frameHeight = height;

    if (isWeb) {
        frameWidth = Math.min(width, DESIGN_WIDTH);
        frameHeight = Math.min(height, DESIGN_HEIGHT);
    }

    return (
        <View style={styles.page}>
            <View
                style={[
                    styles.app,
                    isWeb
                        ? {
                            width: frameWidth,
                            height: frameHeight,
                            transform: [{ scale: webScale }],
                        }
                        : {
                            flex: 1,
                        },
                ]}
            >
                <Stack screenOptions={{ headerShown: false }} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    page: {
        flex: 1,
        alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
        justifyContent: Platform.OS === 'web' ? 'center' : 'flex-start',
        backgroundColor: '#222',
    },

    app: {
        overflow: 'hidden',
        backgroundColor: '#fff',
    },
});