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

    let frameWidth = width;
    let frameHeight = height;

    if (isWeb) {
        const ratio = DESIGN_WIDTH / DESIGN_HEIGHT;

        frameWidth = Math.min(width, DESIGN_WIDTH);
        frameHeight = frameWidth / ratio;

        if (frameHeight > height) {
            frameHeight = height;
            frameWidth = frameHeight * ratio;
        }
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