import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { C } from '@/constants/handyhub-theme';
import { useAuth } from '@/hooks/use-auth';
import { updateProfile } from '@/lib/profiles';

const ROLE_LABEL: Record<string, string> = { customer: 'Customer', worker: 'Worker', agent: 'Agent' };
const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export function ProfileMenu({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { user, signOut, refreshProfile } = useAuth();
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  function startEditingPhone() {
    Haptics.selectionAsync();
    setPhoneInput(user?.phone ?? '');
    setError(null);
    setEditingPhone(true);
  }

  async function savePhone() {
    if (!user) return;
    const trimmed = phoneInput.trim();
    if (!PHONE_PATTERN.test(trimmed)) {
      setError('Enter a valid phone number.');
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await updateProfile(user.id, { phone: trimmed });
      await refreshProfile();
      setEditingPhone(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that number.');
    }
    setIsSaving(false);
  }

  function handleClose() {
    setEditingPhone(false);
    setError(null);
    onClose();
  }

  return (
    <Modal animationType="slide" onRequestClose={handleClose} transparent visible={visible}>
      <Pressable onPress={handleClose} style={styles.backdrop}>
        <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.sheetSafeArea}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.sheet}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0).toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.role}>{ROLE_LABEL[user.role] ?? user.role}</Text>

          <View style={styles.divider} />

          <View style={styles.phoneRow}>
            <Ionicons color={C.muted} name="call-outline" size={20} />
            {editingPhone ? (
              <View style={styles.phoneEditRow}>
                <TextInput
                  autoFocus
                  keyboardType="phone-pad"
                  onChangeText={setPhoneInput}
                  placeholder="e.g. 0712345678"
                  placeholderTextColor={C.muted}
                  style={styles.phoneInput}
                  value={phoneInput}
                />
                <Pressable disabled={isSaving} hitSlop={6} onPress={savePhone} style={styles.phoneSaveButton}>
                  {isSaving ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons color="#FFFFFF" name="checkmark" size={19} />}
                </Pressable>
              </View>
            ) : user.phone ? (
              <>
                <Text style={styles.phoneText}>{user.phone}</Text>
                <Pressable hitSlop={8} onPress={startEditingPhone}>
                  <Text style={styles.phoneAction}>Change</Text>
                </Pressable>
              </>
            ) : (
              <Pressable onPress={startEditingPhone} style={styles.addPhoneButton}>
                <Text style={styles.phoneAction}>Add phone number</Text>
              </Pressable>
            )}
          </View>
          {error && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.divider} />

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              signOut();
            }}
            style={styles.signOutButton}>
            <Ionicons color={C.brand} name="log-out-outline" size={20} />
            <Text style={styles.signOutText}>Log out</Text>
          </Pressable>
        </Pressable>
        </SafeAreaView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(19,32,67,0.45)', justifyContent: 'flex-end' },
  sheetSafeArea: { backgroundColor: C.cream, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheet: { padding: 22, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FBEFEC', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarText: { color: C.brand, fontWeight: '800', fontSize: 21 },
  name: { color: C.ink, fontSize: 17, fontWeight: '800', marginBottom: 2 },
  role: { color: C.muted, fontSize: 12, marginBottom: 4 },
  divider: { alignSelf: 'stretch', height: 1, backgroundColor: C.line, marginVertical: 14 },
  phoneRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10 },
  phoneText: { flex: 1, color: C.ink, fontWeight: '700', fontSize: 13.5 },
  phoneAction: { color: C.brand, fontWeight: '700', fontSize: 12.5 },
  addPhoneButton: { flex: 1 },
  phoneEditRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  phoneInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    color: C.ink,
    backgroundColor: C.card,
    outlineWidth: 1.5,
    outlineColor: '#D1D5DB',
    outlineStyle: 'solid',
  },
  phoneSaveButton: { width: 42, height: 42, borderRadius: 12, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center' },
  errorText: { alignSelf: 'stretch', color: C.brand, fontSize: 11.5, fontWeight: '600', marginTop: 8 },
  signOutButton: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#FBE9EA' },
  signOutText: { color: C.brand, fontWeight: '700', fontSize: 13.5 },
});
