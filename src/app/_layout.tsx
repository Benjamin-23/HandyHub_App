// Only the weights app-text.tsx's fontFamilyForWeight() actually maps to are
// loaded here — Google Sans Flex for the bold "display" weight (headlines,
// buttons, badges), PT Sans regular/bold for everything else.
import { GoogleSansFlex_800ExtraBold } from '@expo-google-fonts/google-sans-flex/800ExtraBold';
import { useFonts as useGoogleSansFlex } from '@expo-google-fonts/google-sans-flex/useFonts';
import { PTSans_400Regular } from '@expo-google-fonts/pt-sans/400Regular';
import { PTSans_700Bold } from '@expo-google-fonts/pt-sans/700Bold';
import { useFonts as usePTSans } from '@expo-google-fonts/pt-sans/useFonts';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { C } from '@/constants/handyhub-theme';
import { AuthProvider } from '@/hooks/use-auth';

export default function RootLayout() {
  const [displayFontsLoaded] = useGoogleSansFlex({ GoogleSansFlex_800ExtraBold });
  const [bodyFontsLoaded] = usePTSans({
    PTSans_400Regular,
    PTSans_700Bold,
  });

  if (!displayFontsLoaded || !bodyFontsLoaded) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
});
