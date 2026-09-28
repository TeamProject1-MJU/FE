import {
    ImageBackground,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function Onboarding2() {
    return (
        <View style={styles.container}>
            <StatusBar hidden />

            <ImageBackground
                source={require('../../assets/images/linkro/onboarding-2.png')}
                style={styles.background}
                resizeMode="stretch"
            >
                {/* 건너뛰기 */}
                <Pressable
                    style={styles.skipButton}
                    onPress={() => router.replace('/login')}
                />

                {/* 다음 */}
                <Pressable
                    style={styles.nextButton}
                    onPress={() => router.replace('/login')}
                />
            </ImageBackground>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },

    background: {
        flex: 1,
        width: '100%',
        height: '100%',
    },

    skipButton: {
        position: 'absolute',
        top: '3%',
        right: '3%',
        width: '25%',
        height: '8%',
    },

    nextButton: {
        position: 'absolute',
        right: '2%',
        bottom: '2%',
        width: '25%',
        height: '13%',
    },
});