import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import Passenger, { type PassengerTone } from '@/components/passenger';

const MEMBER_TONES: PassengerTone[] = ['pink', 'sky', 'mint', 'yellow', 'orange', 'green'];

/** A presentation-only identity color shared by the member list and chat. */
export function memberTone(userId: string, myUserId: string): PassengerTone {
    if (userId === myUserId) return 'me';
    let hash = 0;
    for (let index = 0; index < userId.length; index++) hash = (Math.imul(hash, 31) + userId.charCodeAt(index)) >>> 0;
    return MEMBER_TONES[hash % MEMBER_TONES.length];
}

const crown = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 16">
<path d="M3 12 1 3 7 7 12 1 17 7 23 3 21 12Z" fill="#F4C04E" stroke="#C98F1E" stroke-width="1.2" stroke-linejoin="round"/>
<path d="M3 12H21V15H3Z" fill="#F4C04E" stroke="#C98F1E" stroke-width="1.2"/>
</svg>`;
const uri = `data:image/svg+xml;utf8,${encodeURIComponent(crown)}`;

type Props = { tone: PassengerTone; size: number; isOwner?: boolean };

export default function MemberAvatar({ tone, size, isOwner = false }: Props) {
    return (
        <View style={{ width: size, height: size * 1.1 }}>
            <Passenger tone={tone} size={size} shadow={false} />
            {isOwner && <Image source={{ uri }} style={[styles.crown, { left: (size - 20) / 2 }]} contentFit="contain" accessible accessibilityLabel="방장" />}
        </View>
    );
}

const styles = StyleSheet.create({
    crown: { position: 'absolute', top: -5, width: 20, height: 14, transform: [{ rotate: '-6deg' }] },
});
