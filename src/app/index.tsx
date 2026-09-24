import { View, Text, Pressable, StyleSheet } from 'react-native';

export default function HomeScreen() {
  return (
      <View style={styles.container}>
        <Text style={styles.title}>LinkRo</Text>
        <Text style={styles.subtitle}>지하철 이동을 더 편리하게</Text>

        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>경로 탐색</Text>
        </Pressable>

        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>중간역 추천</Text>
        </Pressable>

        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>혼잡도 확인</Text>
        </Pressable>

        <Pressable style={styles.button}>
          <Text style={styles.buttonText}>표지판 AI 안내</Text>
        </Pressable>
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
  },
  button: {
    padding: 16,
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 12,
  },
  buttonText: {
    fontSize: 16,
    textAlign: 'center',
  },
});