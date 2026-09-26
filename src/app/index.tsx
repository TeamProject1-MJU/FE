import {
    Image,
    Platform,
    StyleSheet,
    View,
} from 'react-native';

import { StatusBar } from 'expo-status-bar';

export default function Index() {
    return (
        <View style={styles.page}>
            <StatusBar hidden />

            <View style={styles.phone}>
                <Image
                    source={require('../../assets/images/linkro/splash-screen.png')}
                    style={styles.splashImage}
                    resizeMode="cover"
                />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    /*
     * PC 웹에서 보이는 바깥 배경
     * 실제 휴대폰에서는 네이비 배경으로 처리
     */
    page: {
        flex: 1,

        backgroundColor:
            Platform.OS === 'web'
                ? '#EEF2F7'
                : '#081B49',

        alignItems: 'center',
        justifyContent: 'center',
    },

    /*
     * PC에서만 아이폰 비율처럼 보여주는 영역
     *
     * 실제 iPhone / Android에서는
     * 화면 전체를 사용함
     */
    phone: {
        width:
            Platform.OS === 'web'
                ? 393
                : '100%',

        height:
            Platform.OS === 'web'
                ? 852
                : '100%',

        backgroundColor: '#081B49',

        overflow: 'hidden',

        ...(Platform.OS === 'web'
            ? {
                borderRadius: 40,

                shadowColor: '#000000',

                shadowOpacity: 0.18,

                shadowRadius: 20,

                shadowOffset: {
                    width: 0,
                    height: 8,
                },
            }
            : {}),
    },

    /*
     * 스플래시 화면 전체 이미지
     */
    splashImage: {
        width: '100%',
        height: '100%',
    },
});