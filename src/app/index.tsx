import { Image, StyleSheet, View } from 'react-native';
import { useEffect } from 'react';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function SplashScreen() {
    useEffect(() => {
        const timer = setTimeout(() => {
            router.replace('/onboarding-1');
        }, 2000);

        return () => clearTimeout(timer);
    }, []);

    return (
        <View style={styles.container}>
            <StatusBar hidden />

            <Image
                source={require('../../assets/images/linkro/splash-screen.png')}
                style={styles.image}
                resizeMode="stretch"
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },

    image: {
        width: '100%',
        height: '100%',
    },
});