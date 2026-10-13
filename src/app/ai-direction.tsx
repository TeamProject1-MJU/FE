
import { useState } from 'react';
import { router } from 'expo-router';
import {
    Alert,
    Image,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';

const NAVY = '#0f1c3f';
const MINT = '#2bcf9a';
const AI = '#6a5ae0';
const BACKGROUND = '#f3f5f8';
const WHITE = '#ffffff';
const SECONDARY = '#6b7488';
const BORDER = '#e6e9ef';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function AiDirectionScreen() {
    const insets = useSafeAreaInsets();

    const [imageUri, setImageUri] = useState<string | null>(null);
    const [message, setMessage] = useState('');

    const goBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/home');
        }
    };

    const chooseImage = async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 0.85,
            });

            if (!result.canceled && result.assets.length > 0) {
                setImageUri(result.assets[0].uri);
                setMessage('');
            }
        } catch {
            setMessage('사진을 불러오지 못했습니다. 다시 시도해 주세요.');
        }
    };

    const takePhoto = async () => {
        try {
            if (Platform.OS === 'web') {
                setMessage(
                    '웹에서는 앨범 선택을 이용해 주세요. 카메라 촬영은 모바일 앱에서 사용할 수 있습니다.',
                );
                return;
            }

            const permission =
                await ImagePicker.requestCameraPermissionsAsync();

            if (!permission.granted) {
                Alert.alert(
                    '카메라 권한 필요',
                    '표지판을 촬영하려면 카메라 권한이 필요합니다.',
                );
                return;
            }

            const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                allowsEditing: false,
                quality: 0.85,
            });

            if (!result.canceled && result.assets.length > 0) {
                setImageUri(result.assets[0].uri);
                setMessage('');
            }
        } catch {
            setMessage('사진 촬영에 실패했습니다. 다시 시도해 주세요.');
        }
    };

    const analyzeImage = () => {
        if (!imageUri) {
            setMessage('먼저 표지판 사진을 선택해 주세요.');
            return;
        }

        setMessage(
            '사진이 준비되었습니다. 실제 AI 방향 분석은 API 연동 후 이용할 수 있습니다.',
        );
    };

    const clearImage = () => {
        setImageUri(null);
        setMessage('');
    };

    return (
        <View style={styles.container}>
            <StatusBar style="dark" />

            {/* 상단 헤더 */}
            <View
                style={[
                    styles.header,
                    { paddingTop: insets.top + 12 },
                ]}
            >
                <Pressable
                    onPress={goBack}
                    style={styles.backButton}
                >
                    <Ionicons
                        name="chevron-back"
                        size={25}
                        color={NAVY}
                    />
                </Pressable>

                <Text style={styles.headerTitle}>
                    AI 방향 안내
                </Text>

                <View style={styles.headerRight} />
            </View>

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                {/* 기능 소개 */}
                <View style={styles.intro}>
                    <View style={styles.aiLabel}>
                        <Ionicons
                            name="sparkles"
                            size={14}
                            color={AI}
                        />
                        <Text style={styles.aiLabelText}>
                            AI 이동 도우미
                        </Text>
                    </View>

                    <Text style={styles.title}>
                        지금 가는 방향이{'\n'}맞는지 확인해 보세요
                    </Text>

                    <Text style={styles.description}>
                        지하철 표지판을 촬영하면 선택한 경로와
                        비교하여 올바른 이동 방향인지 안내해 드립니다.
                    </Text>
                </View>

                {/* 이미지 선택 영역 */}
                <View style={styles.uploadCard}>
                    <Text style={styles.sectionTitle}>
                        표지판 사진
                    </Text>

                    <Text style={styles.sectionDescription}>
                        역명, 노선, 방면이 잘 보이도록 촬영해 주세요.
                    </Text>

                    {imageUri ? (
                        <View style={styles.previewContainer}>
                            <Image
                                source={{ uri: imageUri }}
                                style={styles.previewImage}
                                resizeMode="contain"
                            />

                            <Pressable
                                style={styles.removeButton}
                                onPress={clearImage}
                            >
                                <Ionicons
                                    name="close"
                                    size={19}
                                    color={NAVY}
                                />
                            </Pressable>
                        </View>
                    ) : (
                        <View style={styles.placeholder}>
                            <View style={styles.cameraCircle}>
                                <Ionicons
                                    name="camera-outline"
                                    size={35}
                                    color={AI}
                                />
                            </View>

                            <Text style={styles.placeholderTitle}>
                                표지판 사진을 등록해 주세요
                            </Text>

                            <Text style={styles.placeholderDescription}>
                                촬영하거나 앨범에서 사진을 선택할 수 있어요.
                            </Text>
                        </View>
                    )}

                    <View style={styles.buttonRow}>
                        <ActionButton
                            icon="camera-outline"
                            label="사진 촬영"
                            onPress={takePhoto}
                            primary
                        />
                        <ActionButton
                            icon="images-outline"
                            label="앨범 선택"
                            onPress={chooseImage}
                        />
                    </View>
                </View>

                {/* 분석 안내 */}
                <View style={styles.infoCard}>
                    <View style={styles.infoHeading}>
                        <Ionicons
                            name="information-circle-outline"
                            size={20}
                            color={NAVY}
                        />
                        <Text style={styles.infoTitle}>
                            AI는 무엇을 확인하나요?
                        </Text>
                    </View>

                    <InfoRow text="표지판의 역명·노선·방면 정보" />
                    <InfoRow text="선택한 지하철 경로의 이동 방향" />
                    <InfoRow text="현재 표지판과 이동 방향의 일치 여부" />
                </View>

                {/* API 연동 전 상태 */}
                {message.length > 0 && (
                    <View style={styles.messageCard}>
                        <Ionicons
                            name="alert-circle-outline"
                            size={19}
                            color={NAVY}
                        />
                        <Text style={styles.messageText}>
                            {message}
                        </Text>
                    </View>
                )}

                <Pressable
                    style={({ pressed }) => [
                        styles.analyzeButton,
                        !imageUri && styles.analyzeButtonDisabled,
                        pressed && imageUri && styles.pressed,
                    ]}
                    onPress={analyzeImage}
                >
                    <Ionicons
                        name="sparkles"
                        size={19}
                        color={WHITE}
                    />

                    <Text style={styles.analyzeButtonText}>
                        AI 방향 분석하기
                    </Text>
                </Pressable>

                <Text style={styles.bottomNote}>
                    현재는 화면 구현 단계입니다.
                    실제 AI 분석 결과는 API 연동 후 제공됩니다.
                </Text>
            </ScrollView>
        </View>
    );
}

function ActionButton({
                          icon,
                          label,
                          onPress,
                          primary = false,
                      }: {
    icon: IconName;
    label: string;
    onPress: () => void;
    primary?: boolean;
}) {
    return (
        <Pressable
            style={({ pressed }) => [
                styles.actionButton,
                primary
                    ? styles.actionButtonPrimary
                    : styles.actionButtonSecondary,
                pressed && styles.pressed,
            ]}
            onPress={onPress}
        >
            <Ionicons
                name={icon}
                size={18}
                color={primary ? WHITE : NAVY}
            />

            <Text
                style={[
                    styles.actionButtonText,
                    primary
                        ? styles.actionTextPrimary
                        : styles.actionTextSecondary,
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );
}

function InfoRow({ text }: { text: string }) {
    return (
        <View style={styles.infoRow}>
            <Ionicons
                name="checkmark-circle"
                size={17}
                color={MINT}
            />
            <Text style={styles.infoRowText}>
                {text}
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BACKGROUND,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
        backgroundColor: WHITE,
        borderBottomWidth: 1,
        borderBottomColor: BORDER,
    },
    backButton: {
        width: 36,
        height: 36,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: NAVY,
    },
    headerRight: {
        width: 36,
    },
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 20,
        paddingTop: 24,
        paddingBottom: 36,
    },
    intro: {
        marginBottom: 24,
    },
    aiLabel: {
        alignSelf: 'flex-start',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 20,
        backgroundColor: '#f0eefd',
        marginBottom: 15,
    },
    aiLabelText: {
        fontSize: 12,
        fontWeight: '700',
        color: AI,
    },
    title: {
        fontSize: 24,
        fontWeight: '800',
        lineHeight: 33,
        color: NAVY,
        marginBottom: 12,
    },
    description: {
        fontSize: 14,
        lineHeight: 23,
        color: SECONDARY,
    },
    uploadCard: {
        backgroundColor: WHITE,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: BORDER,
        padding: 18,
    },
    sectionTitle: {
        fontSize: 17,
        fontWeight: '700',
        color: NAVY,
        marginBottom: 7,
    },
    sectionDescription: {
        fontSize: 13,
        color: SECONDARY,
        marginBottom: 18,
    },
    placeholder: {
        minHeight: 210,
        borderWidth: 1.5,
        borderStyle: 'dashed',
        borderColor: '#cfd4e1',
        borderRadius: 14,
        backgroundColor: '#fafbfe',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 15,
    },
    cameraCircle: {
        width: 68,
        height: 68,
        borderRadius: 34,
        backgroundColor: '#f0eefd',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 13,
    },
    placeholderTitle: {
        color: NAVY,
        fontSize: 15,
        fontWeight: '700',
        marginBottom: 7,
    },
    placeholderDescription: {
        color: SECONDARY,
        fontSize: 12,
        textAlign: 'center',
        lineHeight: 19,
    },
    previewContainer: {
        height: 235,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: '#eef0f5',
        position: 'relative',
    },
    previewImage: {
        width: '100%',
        height: '100%',
    },
    removeButton: {
        position: 'absolute',
        top: 10,
        right: 10,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: WHITE,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 15,
    },
    actionButton: {
        flex: 1,
        height: 45,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 7,
    },
    actionButtonPrimary: {
        backgroundColor: NAVY,
    },
    actionButtonSecondary: {
        backgroundColor: '#f1f3f8',
        borderWidth: 1,
        borderColor: BORDER,
    },
    actionButtonText: {
        fontSize: 13,
        fontWeight: '700',
    },
    actionTextPrimary: {
        color: WHITE,
    },
    actionTextSecondary: {
        color: NAVY,
    },
    infoCard: {
        backgroundColor: WHITE,
        borderRadius: 16,
        padding: 18,
        marginTop: 18,
        borderWidth: 1,
        borderColor: BORDER,
    },
    infoHeading: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 15,
    },
    infoTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: NAVY,
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 10,
    },
    infoRowText: {
        fontSize: 13,
        color: SECONDARY,
    },
    messageCard: {
        marginTop: 18,
        padding: 15,
        backgroundColor: '#ebeff7',
        borderRadius: 12,
        flexDirection: 'row',
        gap: 9,
        alignItems: 'flex-start',
    },
    messageText: {
        flex: 1,
        color: NAVY,
        fontSize: 13,
        lineHeight: 20,
    },
    analyzeButton: {
        marginTop: 20,
        height: 54,
        backgroundColor: AI,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 9,
    },
    analyzeButtonDisabled: {
        backgroundColor: '#a6a1c9',
    },
    analyzeButtonText: {
        color: WHITE,
        fontSize: 16,
        fontWeight: '700',
    },
    bottomNote: {
        textAlign: 'center',
        fontSize: 12,
        color: SECONDARY,
        lineHeight: 19,
        marginTop: 15,
    },
    pressed: {
        opacity: 0.75,
    },
});
