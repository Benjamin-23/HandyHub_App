import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C } from '@/constants/handyhub-theme';
import { useAuth } from '@/hooks/use-auth';

export function PendingApprovalScreen() {
  const { signOut } = useAuth();

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons color={C.accent} name="hourglass-outline" size={30} />
        </View>
        <Text style={styles.headline}>Awaiting activation</Text>
        <Text style={styles.body}>
          Your agent account is set up but hasn&apos;t been activated yet. A HandyHub admin will turn it on shortly —
          check back soon.
        </Text>
        <Pressable onPress={signOut} style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.ink },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  headline: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginBottom: 10, textAlign: 'center' },
  body: { color: '#AEB8DA', fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginBottom: 28 },
  signOutButton: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: '#3A4676' },
  signOutText: { color: '#FFFFFF', fontWeight: '700', fontSize: 13 },
});
