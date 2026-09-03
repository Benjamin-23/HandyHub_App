import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { SERVICE_CATEGORY_LABELS } from '@/constants/categories';
import { C, NO_WEB_OUTLINE } from '@/constants/handyhub-theme';
import { useAuth, type AuthRole } from '@/hooks/use-auth';

type AuthMode = 'signIn' | 'signUp';
type AuthMethod = 'email' | 'phone' | 'google';

export function LoginScreen() {
  const {
    isAuthenticating,
    error,
    otpSent,
    pendingPhone,
    signIn,
    signUp,
    requestPhoneOtp,
    verifyPhoneOtp,
    signInWithGoogle,
    changePhoneNumber,
  } = useAuth();
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [method, setMethod] = useState<AuthMethod>('email');
  const [role, setRole] = useState<AuthRole>('customer');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [location, setLocation] = useState('');
  const [referralCode, setReferralCode] = useState('');

  const showSignUpDetails = mode === 'signUp' && (method !== 'phone' || !otpSent);
  const workerExtra = { location: location.trim(), skills, referralCode: referralCode.trim() || undefined };

  function submit() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (method === 'email') {
      if (mode === 'signIn') signIn(email.trim(), password);
      else signUp(name, email.trim(), password, role, workerExtra);
      return;
    }
    if (method === 'google') {
      signInWithGoogle(mode === 'signUp' ? { role, ...workerExtra } : undefined);
      return;
    }
    if (!otpSent) {
      requestPhoneOtp(phone.trim(), mode === 'signUp' ? { name, role, ...workerExtra } : undefined);
    } else {
      verifyPhoneOtp(otp.trim());
    }
  }

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) return;
    Haptics.selectionAsync();
    setMode(nextMode);
    if (otpSent) changePhoneNumber();
    setOtp('');
  }

  function switchMethod(nextMethod: AuthMethod) {
    if (nextMethod === method) return;
    Haptics.selectionAsync();
    setMethod(nextMethod);
    if (otpSent) changePhoneNumber();
    setOtp('');
  }

  function switchRole(nextRole: AuthRole) {
    if (nextRole === role) return;
    Haptics.selectionAsync();
    setRole(nextRole);
  }

  function toggleSkill(label: string) {
    Haptics.selectionAsync();
    setSkills((current) =>
      current.includes(label) ? current.filter((item) => item !== label) : [...current, label],
    );
  }

  function editPhoneNumber() {
    Haptics.selectionAsync();
    changePhoneNumber();
    setOtp('');
  }

  const submitLabel =
    method === 'email'
      ? mode === 'signIn'
        ? 'Sign In'
        : 'Create Account'
      : method === 'google'
        ? 'Continue with Google'
        : !otpSent
          ? mode === 'signIn'
            ? 'Send Code'
            : 'Send Code & Create Account'
          : 'Verify & Continue';

  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.brandRow}>
            <View style={styles.brandDiamond} />
            <Text style={styles.brandName}>HandyHub</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              Haptics.selectionAsync();
              switchMode('signIn');
              switchMethod('email');
            }}
            style={styles.staffLoginLink}>
            <Ionicons color={C.accent} name="shield-checkmark-outline" size={13} />
            <Text style={styles.staffLoginText}>Login as Staff</Text>
          </Pressable>
          <Text style={styles.headline}>
            {mode === 'signIn' ? 'Welcome back' : 'Create your account'}
          </Text>
          <Text style={styles.subhead}>
            {mode === 'signIn'
              ? 'Sign in to book trusted pros near you.'
              : 'Join HandyHub to book or work jobs near you.'}
          </Text>

          <View style={styles.card}>
            <View style={styles.modeToggle}>
              {(['signIn', 'signUp'] as const).map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: mode === item }}
                  key={item}
                  onPress={() => switchMode(item)}
                  style={[styles.modeButton, mode === item && styles.modeButtonActive]}>
                  <Text style={[styles.modeLabel, mode === item && styles.modeLabelActive]}>
                    {item === 'signIn' ? 'Sign In' : 'Sign Up'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === 'signUp' && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>I am a</Text>
                <View style={styles.roleToggle}>
                  {(['customer', 'worker'] as const).map((item) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: role === item }}
                      key={item}
                      onPress={() => switchRole(item)}
                      style={[styles.roleButton, role === item && styles.roleButtonActive]}>
                      <Ionicons
                        color={role === item ? '#FFFFFF' : C.muted}
                        name={item === 'customer' ? 'person-outline' : 'construct-outline'}
                        size={16}
                      />
                      <Text style={[styles.roleLabel, role === item && styles.roleLabelActive]}>
                        {item === 'customer' ? 'Customer' : 'Worker'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.methodToggle}>
              {(['email', 'phone', 'google'] as const).map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: method === item }}
                  key={item}
                  onPress={() => switchMethod(item)}
                  style={[styles.methodButton, method === item && styles.methodButtonActive]}>
                  <Ionicons
                    color={method === item ? C.brand : C.muted}
                    name={item === 'email' ? 'mail-outline' : item === 'phone' ? 'call-outline' : 'logo-google'}
                    size={14}
                  />
                  <Text style={[styles.methodLabel, method === item && styles.methodLabelActive]}>
                    {item === 'email' ? 'Email' : item === 'phone' ? 'Phone' : 'Google'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {showSignUpDetails && method !== 'google' && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Full name</Text>
                <View style={styles.inputRow}>
                  <Ionicons color={C.muted} name="person-outline" size={17} />
                  <TextInput
                    autoCapitalize="words"
                    onChangeText={setName}
                    placeholder="Patrick Mwangi"
                    placeholderTextColor={C.muted}
                    style={styles.input}
                    value={name}
                  />
                </View>
              </View>
            )}

            {method === 'email' ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Email</Text>
                  <View style={styles.inputRow}>
                    <Ionicons color={C.muted} name="mail-outline" size={17} />
                    <TextInput
                      autoCapitalize="none"
                      autoComplete="email"
                      keyboardType="email-address"
                      onChangeText={setEmail}
                      placeholder="you@example.com"
                      placeholderTextColor={C.muted}
                      style={styles.input}
                      value={email}
                    />
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <View style={styles.inputRow}>
                    <Ionicons color={C.muted} name="lock-closed-outline" size={17} />
                    <TextInput
                      autoCapitalize="none"
                      onChangeText={setPassword}
                      placeholder="••••••••"
                      placeholderTextColor={C.muted}
                      secureTextEntry={!passwordVisible}
                      style={styles.input}
                      value={password}
                    />
                    <Pressable hitSlop={8} onPress={() => setPasswordVisible((visible) => !visible)}>
                      <Ionicons
                        color={C.muted}
                        name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
                        size={17}
                      />
                    </Pressable>
                  </View>
                </View>
              </>
            ) : method === 'google' ? (
              <View style={styles.googleNote}>
                <Ionicons color={C.muted} name="logo-google" size={17} />
                <Text style={styles.googleNoteText}>
                  You&apos;ll continue in a secure Google sign-in window.
                </Text>
              </View>
            ) : !otpSent ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Phone number</Text>
                <View style={styles.inputRow}>
                  <Ionicons color={C.muted} name="call-outline" size={17} />
                  <TextInput
                    autoComplete="tel"
                    keyboardType="phone-pad"
                    onChangeText={setPhone}
                    placeholder="+254 700 000000"
                    placeholderTextColor={C.muted}
                    style={styles.input}
                    value={phone}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.field}>
                <View style={styles.otpHeaderRow}>
                  <Text style={styles.fieldLabel}>Verification code</Text>
                  <Pressable hitSlop={8} onPress={editPhoneNumber}>
                    <Text style={styles.changeNumberText}>Change number</Text>
                  </Pressable>
                </View>
                <Text style={styles.otpSentNote}>Code sent to {pendingPhone}</Text>
                <View style={styles.inputRow}>
                  <Ionicons color={C.muted} name="shield-checkmark-outline" size={17} />
                  <TextInput
                    keyboardType="number-pad"
                    maxLength={6}
                    onChangeText={setOtp}
                    placeholder="123456"
                    placeholderTextColor={C.muted}
                    style={styles.input}
                    value={otp}
                  />
                </View>
              </View>
            )}

            {showSignUpDetails && role === 'worker' && (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Your skills</Text>
                  <View style={styles.skillsWrap}>
                    {SERVICE_CATEGORY_LABELS.map((label) => {
                      const selected = skills.includes(label);
                      return (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          key={label}
                          onPress={() => toggleSkill(label)}
                          style={[styles.skillChip, selected && styles.skillChipActive]}>
                          <Text style={[styles.skillChipLabel, selected && styles.skillChipLabelActive]}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Location</Text>
                  <View style={styles.inputRow}>
                    <Ionicons color={C.muted} name="location-outline" size={17} />
                    <TextInput
                      onChangeText={setLocation}
                      placeholder="Westlands, Nairobi"
                      placeholderTextColor={C.muted}
                      style={styles.input}
                      value={location}
                    />
                  </View>
                </View>
              </>
            )}

            {showSignUpDetails && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Referral code (optional)</Text>
                <View style={styles.inputRow}>
                  <Ionicons color={C.muted} name="gift-outline" size={17} />
                  <TextInput
                    autoCapitalize="characters"
                    onChangeText={setReferralCode}
                    placeholder="Got one from a HandyHub agent?"
                    placeholderTextColor={C.muted}
                    style={styles.input}
                    value={referralCode}
                  />
                </View>
              </View>
            )}

            {error && (
              <View style={styles.errorRow}>
                <Ionicons color={C.brand} name="alert-circle" size={14} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              disabled={isAuthenticating}
              onPress={submit}
              style={[styles.submitButton, isAuthenticating && styles.submitButtonDisabled]}>
              {isAuthenticating ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitText}>{submitLabel}</Text>
              )}
            </Pressable>
          </View>

          <Text style={styles.footerNote}>
            By continuing you agree to HandyHub&apos;s Terms and Privacy Policy.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.ink },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 32, justifyContent: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 22 },
  brandDiamond: { width: 12, height: 12, borderRadius: 3, backgroundColor: C.accent, transform: [{ rotate: '45deg' }] },
  brandName: { color: '#FFFFFF', fontWeight: '800', fontSize: 21, letterSpacing: -0.4 },
  staffLoginLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginBottom: 18 },
  staffLoginText: { color: C.accent, fontWeight: '700', fontSize: 12 },
  headline: { color: '#FFFFFF', fontSize: 26, fontWeight: '800', letterSpacing: -0.4, marginBottom: 6 },
  subhead: { color: '#AEB8DA', fontSize: 13.5, lineHeight: 19, marginBottom: 26, maxWidth: 300 },
  card: { backgroundColor: C.card, borderRadius: 22, padding: 18 },
  modeToggle: { flexDirection: 'row', backgroundColor: C.cream, padding: 3, borderRadius: 14, marginBottom: 18 },
  modeButton: { flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center' },
  modeButtonActive: { backgroundColor: C.card, shadowColor: C.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 2 },
  modeLabel: { color: C.muted, fontWeight: '700', fontSize: 12.5 },
  modeLabelActive: { color: C.ink },
  roleToggle: { flexDirection: 'row', gap: 8 },
  roleButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.cream },
  roleButtonActive: { backgroundColor: C.brand, borderColor: C.brand },
  roleLabel: { color: C.muted, fontWeight: '700', fontSize: 12.5 },
  roleLabelActive: { color: '#FFFFFF' },
  methodToggle: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  methodButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.line },
  methodButtonActive: { borderColor: C.brand },
  methodLabel: { color: C.muted, fontWeight: '700', fontSize: 12 },
  methodLabelActive: { color: C.brand },
  googleNote: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.cream, borderRadius: 13, borderWidth: 1, borderColor: C.line, paddingHorizontal: 13, paddingVertical: 14, marginBottom: 14 },
  googleNoteText: { color: C.muted, fontSize: 12, flex: 1, lineHeight: 17 },
  otpHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  changeNumberText: { color: C.brand, fontWeight: '700', fontSize: 11 },
  otpSentNote: { color: C.muted, fontSize: 11.5, marginBottom: 8 },
  field: { marginBottom: 14 },
  fieldLabel: { color: C.muted, fontWeight: '700', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderRadius: 13, paddingHorizontal: 13, backgroundColor: C.cream },
  input: { flex: 1, color: C.ink, fontSize: 14, paddingVertical: 0, ...NO_WEB_OUTLINE },
  skillsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.cream },
  skillChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  skillChipLabel: { color: C.muted, fontWeight: '700', fontSize: 12 },
  skillChipLabelActive: { color: '#FFFFFF' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  errorText: { color: C.brand, fontSize: 11.5, fontWeight: '600', flex: 1 },
  submitButton: { minHeight: 50, borderRadius: 14, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  submitButtonDisabled: { opacity: 0.7 },
  submitText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  footerNote: { color: '#7C88B8', fontSize: 10.5, textAlign: 'center', marginTop: 20, lineHeight: 15 },
});
