import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { C } from '@/constants/handyhub-theme';
import { useAuth } from '@/hooks/use-auth';
import { fetchRecruits, type Profile } from '@/lib/profiles';

const VERIFICATION_LABEL: Record<Profile['idVerificationStatus'], string> = {
  unverified: 'Not verified',
  pending: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected',
};

function RecruitRow({ recruit }: { recruit: Profile }) {
  return (
    <View style={styles.recruitRow}>
      <View style={styles.recruitAvatar}>
        <Ionicons color={C.brand} name={recruit.role === 'worker' ? 'construct-outline' : 'person-outline'} size={16} />
      </View>
      <View style={styles.recruitInfo}>
        <Text style={styles.recruitName}>{recruit.name}</Text>
        <Text style={styles.recruitMeta}>
          {recruit.role === 'worker' ? 'Worker' : 'Customer'}
          {recruit.location ? ` · ${recruit.location}` : ''}
        </Text>
        {recruit.role === 'worker' && recruit.skills.length > 0 && (
          <Text style={styles.recruitSkills} numberOfLines={1}>
            {recruit.skills.join(', ')}
          </Text>
        )}
      </View>
      {recruit.role === 'worker' && (
        <View style={[styles.statusPill, recruit.idVerificationStatus === 'verified' && styles.statusPillVerified]}>
          <Text style={styles.statusPillText}>{VERIFICATION_LABEL[recruit.idVerificationStatus]}</Text>
        </View>
      )}
    </View>
  );
}

export function AgentScreen() {
  const { user, signOut } = useAuth();
  const [recruits, setRecruits] = useState<Profile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => (user ? fetchRecruits(user.id) : Promise.resolve([])), [user]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((rows) => {
        if (!cancelled) setRecruits(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your recruits.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function onRefresh() {
    setIsRefreshing(true);
    try {
      setRecruits(await load());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your recruits.');
    }
    setIsRefreshing(false);
  }

  const workers = recruits.filter((recruit) => recruit.role === 'worker');
  const customers = recruits.filter((recruit) => recruit.role === 'customer');

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Agent dashboard</Text>
          <Text style={styles.headline}>{user?.name}</Text>
        </View>
        <Pressable onPress={signOut} style={styles.headerButton}>
          <Ionicons color="#FFFFFF" name="log-out-outline" size={16} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} tintColor={C.brand} />}
        showsVerticalScrollIndicator={false}>
        <View style={styles.referralCard}>
          <Text style={styles.referralLabel}>Your referral code</Text>
          <Text style={styles.referralCode}>{user?.referralCode ?? '—'}</Text>
          <Text style={styles.referralHint}>Share this code — anyone who signs up with it is tracked as your recruit.</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{workers.length}</Text>
            <Text style={styles.statLabel}>Workers recruited</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{customers.length}</Text>
            <Text style={styles.statLabel}>Customers recruited</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Your recruits</Text>
        {isLoading ? (
          <ActivityIndicator color={C.brand} style={styles.loading} />
        ) : error ? (
          <Text style={styles.emptyText}>{error}</Text>
        ) : recruits.length === 0 ? (
          <Text style={styles.emptyText}>No one has signed up with your referral code yet.</Text>
        ) : (
          recruits.map((recruit) => <RecruitRow key={recruit.id} recruit={recruit} />)
        )}

        <View style={styles.comingSoon}>
          <Ionicons color={C.muted} name="briefcase-outline" size={18} />
          <Text style={styles.comingSoonText}>
            Helping customers apply for jobs and matching them with the right worker is coming soon.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.ink, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  eyebrow: { color: '#AEB8DA', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  headline: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  headerButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },
  referralCard: { backgroundColor: C.card, borderRadius: 18, padding: 18, marginBottom: 14 },
  referralLabel: { color: C.muted, fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  referralCode: { color: C.brand, fontWeight: '800', fontSize: 24, letterSpacing: 1, marginBottom: 6 },
  referralHint: { color: C.muted, fontSize: 12, lineHeight: 17 },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 20 },
  statCard: { flex: 1, backgroundColor: C.card, borderRadius: 16, padding: 16, alignItems: 'center' },
  statValue: { color: C.ink, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  statLabel: { color: C.muted, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  sectionTitle: { color: C.ink, fontSize: 15, fontWeight: '800', marginBottom: 10 },
  loading: { marginVertical: 20 },
  emptyText: { color: C.muted, fontSize: 12.5, lineHeight: 18 },
  recruitRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 12, marginBottom: 10 },
  recruitAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#FBEFEC', alignItems: 'center', justifyContent: 'center' },
  recruitInfo: { flex: 1 },
  recruitName: { color: C.ink, fontWeight: '700', fontSize: 13.5 },
  recruitMeta: { color: C.muted, fontSize: 11.5, marginTop: 1 },
  recruitSkills: { color: C.muted, fontSize: 11, marginTop: 2 },
  statusPill: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: '#FBE9EA' },
  statusPillVerified: { backgroundColor: '#E7F3F0' },
  statusPillText: { fontSize: 10, fontWeight: '700', color: C.ink },
  comingSoon: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.card, borderRadius: 14, padding: 14, marginTop: 8 },
  comingSoonText: { color: C.muted, fontSize: 11.5, flex: 1, lineHeight: 16 },
});
