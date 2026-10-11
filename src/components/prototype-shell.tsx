import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export function PrototypeShell({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
    return (
        <View style={[styles.phone, dark && styles.darkPhone]}>
            <StatusBar hidden />
            <View style={styles.statusBar}>
                <Text style={[styles.time, dark && styles.light]}>9:41</Text>
                <View style={styles.statusRight}>
                    <Text style={[styles.statusIcon, dark && styles.light]}>▮▮▮</Text>
                    <Text style={[styles.statusIcon, dark && styles.light]}>⌁</Text>
                    <View style={[styles.battery, dark && styles.batteryDark]}>
                        <View style={[styles.batteryFill, dark && styles.batteryFillDark]} />
                    </View>
                </View>
            </View>
            <View style={styles.content}>{children}</View>
            <View style={[styles.homeIndicator, dark && styles.homeIndicatorDark]} />
        </View>
    );
}

const styles = StyleSheet.create({
    phone: { flex: 1, backgroundColor: '#f8f9fb', overflow: 'hidden' },
    darkPhone: { backgroundColor: '#14264d' },
    statusBar: { height: 47, paddingTop: 13, paddingHorizontal: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    time: { color: '#293b5f', fontSize: 14, fontWeight: '800' },
    light: { color: '#fff' },
    statusRight: { flexDirection: 'row', gap: 7, alignItems: 'center' },
    statusIcon: { color: '#293b5f', fontSize: 11, fontWeight: '800' },
    battery: { width: 22, height: 10, borderWidth: 1.5, borderColor: '#293b5f', borderRadius: 3, padding: 1 },
    batteryDark: { borderColor: '#fff' },
    batteryFill: { width: '72%', height: '100%', borderRadius: 1.5, backgroundColor: '#293b5f' },
    batteryFillDark: { backgroundColor: '#fff' },
    content: { flex: 1, paddingHorizontal: 18, paddingBottom: 20 },
    homeIndicator: { position: 'absolute', left: '50%', bottom: 7, width: 126, height: 4, marginLeft: -63, borderRadius: 3, backgroundColor: '#293b5f', zIndex: 30 },
    homeIndicatorDark: { backgroundColor: '#fff' },
});
