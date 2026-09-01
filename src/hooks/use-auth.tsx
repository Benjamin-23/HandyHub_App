import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { signInWithGoogle as googleSignIn } from '@/lib/google-auth';
import { fetchProfile, type Profile, type ProfileRole } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';

export type AuthRole = ProfileRole;
export type AuthUser = Profile;

export type SignUpExtra = {
  location?: string;
  skills?: string[];
  referralCode?: string;
};

type GoogleSignUpDetails = { role: AuthRole } & SignUpExtra;
type PhoneSignUpDetails = { name: string; role: AuthRole } & SignUpExtra;

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticating: boolean;
  error: string | null;
  otpSent: boolean;
  pendingPhone: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string, role: AuthRole, extra?: SignUpExtra) => Promise<void>;
  requestPhoneOtp: (phone: string, signUp?: PhoneSignUpDetails) => Promise<void>;
  verifyPhoneOtp: (code: string) => Promise<void>;
  signInWithGoogle: (signUp?: GoogleSignUpDetails) => Promise<void>;
  changePhoneNumber: () => void;
  signOut: () => void;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

function messageFor(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function metadataFor(details: (SignUpExtra & { name?: string; role?: AuthRole }) | undefined) {
  const data: Record<string, unknown> = {};
  if (!details) return data;
  if (details.name) data.name = details.name;
  if (details.role) data.role = details.role;
  if (details.location) data.location = details.location;
  if (details.skills) data.skills = details.skills;
  if (details.referralCode) data.referral_code_entered = details.referralCode;
  return data;
}

function requiresWorkerDetails(role: AuthRole, extra?: SignUpExtra) {
  if (role !== 'worker') return null;
  if (!extra?.skills || extra.skills.length === 0) return 'Select at least one skill.';
  if (!extra.location?.trim()) return 'Enter your location.';
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState(false);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session) {
        try {
          const profile = await fetchProfile(data.session.user.id);
          if (!cancelled) setUser(profile);
        } catch {
          if (!cancelled) setUser(null);
        }
      }
      if (!cancelled) setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setUser(null);
        return;
      }
      fetchProfile(session.user.id)
        .then((profile) => setUser(profile))
        .catch(() => setUser(null));
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) return setError('Enter a valid email address.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    setIsAuthenticating(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    if (signInError) setError(messageFor(signInError, 'Could not sign in.'));
    setIsAuthenticating(false);
  }

  async function signUp(name: string, email: string, password: string, role: AuthRole, extra?: SignUpExtra) {
    setError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) return setError('Enter your name.');
    if (!trimmedEmail.includes('@')) return setError('Enter a valid email address.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    const workerIssue = requiresWorkerDetails(role, extra);
    if (workerIssue) return setError(workerIssue);

    setIsAuthenticating(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      options: { data: metadataFor({ ...extra, name: trimmedName, role }) },
    });
    if (signUpError) {
      setError(messageFor(signUpError, 'Could not create account.'));
    } else if (!data.session) {
      setError('Check your email to confirm your account, then sign in.');
    }
    setIsAuthenticating(false);
  }

  async function requestPhoneOtp(phone: string, signUp?: PhoneSignUpDetails) {
    setError(null);
    const trimmed = phone.trim();
    if (!PHONE_PATTERN.test(trimmed)) return setError('Enter a valid phone number.');
    if (signUp) {
      if (!signUp.name.trim()) return setError('Enter your name.');
      const workerIssue = requiresWorkerDetails(signUp.role, signUp);
      if (workerIssue) return setError(workerIssue);
    }

    setIsAuthenticating(true);
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: trimmed,
      options: signUp ? { data: metadataFor(signUp) } : undefined,
    });
    if (otpError) {
      setError(messageFor(otpError, 'Could not send verification code.'));
    } else {
      setPendingPhone(trimmed);
      setOtpSent(true);
    }
    setIsAuthenticating(false);
  }

  async function verifyPhoneOtp(code: string) {
    setError(null);
    if (!pendingPhone) return setError('Request a code first.');
    if (!/^[0-9]{6}$/.test(code.trim())) return setError('Enter the 6-digit code.');
    setIsAuthenticating(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      phone: pendingPhone,
      token: code.trim(),
      type: 'sms',
    });
    if (verifyError) setError(messageFor(verifyError, 'Could not verify code.'));
    setOtpSent(false);
    setPendingPhone(null);
    setIsAuthenticating(false);
  }

  async function signInWithGoogle(signUp?: GoogleSignUpDetails) {
    setError(null);
    if (signUp) {
      const workerIssue = requiresWorkerDetails(signUp.role, signUp);
      if (workerIssue) return setError(workerIssue);
    }
    setIsAuthenticating(true);
    try {
      const session = await googleSignIn();
      if (session && signUp) {
        const { error: updateError } = await supabase.auth.updateUser({ data: metadataFor(signUp) });
        if (updateError) setError(messageFor(updateError, 'Signed in, but could not save your profile.'));
      }
    } catch (err) {
      setError(messageFor(err, 'Could not sign in with Google.'));
    }
    setIsAuthenticating(false);
  }

  async function refreshProfile() {
    if (!user) return;
    try {
      const profile = await fetchProfile(user.id);
      setUser(profile);
    } catch (err) {
      setError(messageFor(err, 'Could not refresh your profile.'));
    }
  }

  function changePhoneNumber() {
    setOtpSent(false);
    setError(null);
  }

  function signOut() {
    setError(null);
    setOtpSent(false);
    setPendingPhone(null);
    void supabase.auth.signOut();
  }

  const value = useMemo(
    () => ({
      user,
      isLoading,
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
      signOut,
      refreshProfile,
    }),
    [user, isLoading, isAuthenticating, error, otpSent, pendingPhone],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
