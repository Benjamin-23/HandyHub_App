import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { C } from '@/constants/handyhub-theme';
import { useAuth } from '@/hooks/use-auth';
import { updateProfile, uploadIdDocument } from '@/lib/profiles';

type IdType = 'National ID' | 'Passport';

export function VerifyIdentityScreen({ onDone }: { onDone: () => void }) {
  const { user, refreshProfile } = useAuth();
  const [idType, setIdType] = useState<IdType>('National ID');
  const [idNumber, setIdNumber] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoExtension, setPhotoExtension] = useState<'jpg' | 'png'>('jpg');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickPhoto() {
    Haptics.selectionAsync();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access to upload your ID.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
      base64: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      setError('Could not read that photo — try another one.');
      return;
    }
    setPhotoUri(asset.uri);
    setPhotoBase64(asset.base64);
    setPhotoExtension(asset.uri.toLowerCase().endsWith('.png') ? 'png' : 'jpg');
    setError(null);
  }

  async function submit() {
    if (!user) return;
    setError(null);
    if (!idNumber.trim()) return setError('Enter your ID number.');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsSubmitting(true);
    try {
      let idDocumentPath: string | undefined;
      if (photoBase64) {
        idDocumentPath = await uploadIdDocument(user.id, photoBase64, photoExtension);
      }
      await updateProfile(user.id, {
        idType,
        idNumber: idNumber.trim(),
        idVerificationStatus: 'pending',
        ...(idDocumentPath ? { idDocumentPath } : {}),
      });
      await refreshProfile();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your ID for review.');
    }
    setIsSubmitting(false);
  }

  function skip() {
    Haptics.selectionAsync();
    onDone();
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.headline}>Verify your identity</Text>
        <Text style={styles.subhead}>
          Confirming your ID unlocks full access to jobs on HandyHub. You can also do this later from your profile.
        </Text>

        <View style={styles.card}>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>ID type</Text>
            <View style={styles.typeToggle}>
              {(['National ID', 'Passport'] as const).map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: idType === item }}
                  key={item}
                  onPress={() => setIdType(item)}
                  style={[styles.typeButton, idType === item && styles.typeButtonActive]}>
                  <Text style={[styles.typeLabel, idType === item && styles.typeLabelActive]}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>ID number</Text>
            <View style={styles.inputRow}>
              <Ionicons color={C.muted} name="card-outline" size={17} />
              <TextInput
                autoCapitalize="characters"
                onChangeText={setIdNumber}
                placeholder="e.g. 30123456"
                placeholderTextColor={C.muted}
                style={styles.input}
                value={idNumber}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>ID photo</Text>
            <Pressable onPress={pickPhoto} style={styles.photoPicker}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              ) : (
                <>
                  <Ionicons color={C.muted} name="camera-outline" size={22} />
                  <Text style={styles.photoPickerText}>Upload a photo of your ID</Text>
                </>
              )}
            </Pressable>
          </View>

          {error && (
            <View style={styles.errorRow}>
              <Ionicons color={C.brand} name="alert-circle" size={14} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            disabled={isSubmitting}
            onPress={submit}
            style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}>
            {isSubmitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.submitText}>Submit for review</Text>
            )}
          </Pressable>

          <Pressable onPress={skip} style={styles.skipButton}>
            <Text style={styles.skipText}>Skip for now</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.ink },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 32, justifyContent: 'center' },
  headline: { color: '#FFFFFF', fontSize: 24, fontWeight: '800', letterSpacing: -0.4, marginBottom: 6 },
  subhead: { color: '#AEB8DA', fontSize: 13.5, lineHeight: 19, marginBottom: 24 },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 18 },
  field: { marginBottom: 14 },
  fieldLabel: { color: C.muted, fontWeight: '700', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  typeToggle: { flexDirection: 'row', gap: 8 },
  typeButton: { flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: C.line, backgroundColor: C.cream },
  typeButtonActive: { backgroundColor: C.brand, borderColor: C.brand },
  typeLabel: { color: C.muted, fontWeight: '700', fontSize: 12.5 },
  typeLabelActive: { color: '#FFFFFF' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderWidth: 1, borderColor: C.line, borderRadius: 13, paddingHorizontal: 13, backgroundColor: C.cream },
  input: { flex: 1, color: C.ink, fontSize: 14, paddingVertical: 0, outlineWidth: 1.5, outlineColor: '#D1D5DB', outlineStyle: 'solid' },
  photoPicker: { minHeight: 120, borderRadius: 13, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', backgroundColor: C.cream, alignItems: 'center', justifyContent: 'center', gap: 6, overflow: 'hidden' },
  photoPickerText: { color: C.muted, fontWeight: '600', fontSize: 12.5 },
  photoPreview: { width: '100%', height: 160 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  errorText: { color: C.brand, fontSize: 11.5, fontWeight: '600', flex: 1 },
  submitButton: { minHeight: 50, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitButtonDisabled: { opacity: 0.7 },
  submitText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  skipButton: { alignItems: 'center', paddingVertical: 14 },
  skipText: { color: C.muted, fontWeight: '700', fontSize: 12.5 },
});
