import {
    ImageBackground,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function LoginScreen() {
    return (
        <View style={styles.container}>
            <StatusBar hidden />

            <ImageBackground
                source={require('../../assets/images/linkro/login.png')}
                style={styles.background}
                resizeMode="stretch"
            >
                {/* 카카오 로그인 */}
                <Pressable
                    style={styles.kakaoButton}
                    onPress={() => {
                        console.log('카카오 로그인 클릭');
                    }}
                />

                {/* 휴대폰 번호 로그인 */}
                <Pressable
                    style={styles.phoneButton}
                    onPress={() => {
                        console.log('휴대폰 번호 로그인 클릭');
                    }}
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

    kakaoButton: {
        position: 'absolute',
        left: '8%',
        right: '8%',
        top: '46%',
        height: '9%',
    },

    phoneButton: {
        position: 'absolute',
        left: '8%',
        right: '8%',
        top: '56%',
        height: '9%',
    },
});