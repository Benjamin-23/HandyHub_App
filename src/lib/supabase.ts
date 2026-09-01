import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Set them in .env (see .env.example).',
  );
}

// expo-router's web output renders on a Node server, where `window` doesn't
// exist. The web build of AsyncStorage reaches for `window.localStorage`, so
// fall back to a no-op store there and use real persistence in the browser
// and on native, where AsyncStorage works normally.
const isServerRender = Platform.OS === 'web' && typeof window === 'undefined';
const authStorage = isServerRender
  ? { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }
  : AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Supabase stops refreshing the session while the app is backgrounded; this keeps
// the token fresh when the app returns to the foreground.
if (!isServerRender) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
