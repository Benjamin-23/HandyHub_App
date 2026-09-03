import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '@/components/app-text';
import { SERVICE_CATEGORY_LABELS } from '@/constants/categories';
import { C } from '@/constants/handyhub-theme';
import { useAuth } from '@/hooks/use-auth';
import { fetchWorkerRatingSummary, type RatingSummary } from '@/lib/jobs';
import { updateProfile, type IdVerificationStatus } from '@/lib/profiles';

const VISIBLE_SKILL_COUNT = 2;

const VERIFICATION_LABEL: Record<IdVerificationStatus, string> = {
  unverified: 'Not verified',
  pending: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected',
};

export function WorkerProfileScreen() {
  const { user, refreshProfile, signOut } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [pendingSkill, setPendingSkill] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ratingSummary, setRatingSummary] = useState<RatingSummary | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchWorkerRatingSummary(user.id)
      .then((summary) => { if (!cancelled) setRatingSummary(summary); })
      .catch(() => {
        // Best-effort — the profile still renders fine without a rating summary.
      });
    return () => { cancelled = true; };
  }, [user]);

  if (!user) return null;

  const hiddenCount = Math.max(user.skills.length - VISIBLE_SKILL_COUNT, 0);
  const displayedSkills = showAllSkills ? user.skills : user.skills.slice(0, VISIBLE_SKILL_COUNT);
  const availableSkills = SERVICE_CATEGORY_LABELS.filter((label) => !user.skills.includes(label));

  async function addSkill(label: string) {
    if (!user) return;
    Haptics.selectionAsync();
    setError(null);
    setPendingSkill(label);
    try {
      await updateProfile(user.id, { skills: [...user.skills, label] });
      await refreshProfile();
      setPickerOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that skill.');
    }
    setPendingSkill(null);
  }

  async function removeSkill(label: string) {
    if (!user) return;
    Haptics.selectionAsync();
    setError(null);
    setPendingSkill(label);
    try {
      await updateProfile(user.id, { skills: user.skills.filter((skill) => skill !== label) });
      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that skill.');
    }
    setPendingSkill(null);
  }

  return (
    <View style={styles.screenContent}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Profile</Text>
        <Pressable
          hitSlop={8}
          onPress={() => {
            Haptics.selectionAsync();
            signOut();
          }}
          style={styles.headerButton}>
          <Ionicons color="#FFFFFF" name="log-out-outline" size={20} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons color={C.brand} name="construct-outline" size={26} />
          </View>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.role}>Worker{user.location ? ` · ${user.location}` : ''}</Text>

          {ratingSummary && ratingSummary.count > 0 && (
            <View style={styles.ratingSummaryRow}>
              <Text style={styles.ratingSummaryStars}>★</Text>
              <Text style={styles.ratingSummaryValue}>{ratingSummary.average.toFixed(1)}</Text>
              <Text style={styles.ratingSummaryCount}>
                ({ratingSummary.count} {ratingSummary.count === 1 ? 'rating' : 'ratings'})
              </Text>
            </View>
          )}

          <View style={[styles.verifyPill, user.idVerificationStatus === 'verified' && styles.verifyPillOk]}>
            <Ionicons
              color={user.idVerificationStatus === 'verified' ? C.teal : C.muted}
              name={user.idVerificationStatus === 'verified' ? 'checkmark-circle' : 'time-outline'}
              size={13}
            />
            <Text style={[styles.verifyPillText, user.idVerificationStatus === 'verified' && styles.verifyPillTextOk]}>
              {VERIFICATION_LABEL[user.idVerificationStatus]}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Skills</Text>

          {displayedSkills.length === 0 ? (
            <Text style={styles.emptyText}>You haven&apos;t added any skills yet.</Text>
          ) : (
            <View style={styles.skillsWrap}>
              {displayedSkills.map((skill) => (
                <View key={skill} style={styles.skillChip}>
                  <Text style={styles.skillChipText}>{skill}</Text>
                  <Pressable
                    disabled={pendingSkill !== null}
                    hitSlop={6}
                    onPress={() => removeSkill(skill)}
                    style={styles.skillRemoveButton}>
                    {pendingSkill === skill ? (
                      <ActivityIndicator color={C.muted} size="small" />
                    ) : (
                      <Ionicons color={C.muted} name="close" size={12} />
                    )}
                  </Pressable>
                </View>
              ))}
              {hiddenCount > 0 && (
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowAllSkills((show) => !show);
                  }}
                  style={[styles.skillChip, styles.skillChipMore]}>
                  <Text style={[styles.skillChipText, styles.skillChipMoreText]}>
                    {showAllSkills ? 'Show less' : `+${hiddenCount} more`}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setPickerOpen((open) => !open);
            }}
            style={styles.addSkillButton}>
            <Ionicons color={C.brand} name={pickerOpen ? 'close' : 'add'} size={15} />
            <Text style={styles.addSkillText}>{pickerOpen ? 'Close' : 'Add a skill'}</Text>
          </Pressable>

          {pickerOpen && (
            <View style={styles.pickerWrap}>
              {availableSkills.length === 0 ? (
                <Text style={styles.emptyText}>You&apos;ve added every available skill.</Text>
              ) : (
                <View style={styles.skillsWrap}>
                  {availableSkills.map((label) => (
                    <Pressable
                      disabled={pendingSkill !== null}
                      key={label}
                      onPress={() => addSkill(label)}
                      style={[styles.skillOption, pendingSkill === label && styles.skillOptionSaving]}>
                      {pendingSkill === label ? (
                        <ActivityIndicator color={C.muted} size="small" />
                      ) : (
                        <>
                          <Ionicons color={C.muted} name="add-circle-outline" size={14} />
                          <Text style={styles.skillOptionText}>{label}</Text>
                        </>
                      )}
                    </Pressable>
                  ))}
                </View>
              )}
              {error && (
                <View style={styles.errorRow}>
                  <Ionicons color={C.brand} name="alert-circle" size={13} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenContent: { flex: 1, backgroundColor: C.cream },
  header: {
    minHeight: 55,
    backgroundColor: C.ink2,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    paddingHorizontal: 19,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  headerButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 17, paddingBottom: 26 },
  card: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 18, marginBottom: 14, alignItems: 'center' },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FBEFEC', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  name: { color: C.ink, fontSize: 17, fontWeight: '800', marginBottom: 3 },
  role: { color: C.muted, fontSize: 12, marginBottom: 10 },
  ratingSummaryRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 10 },
  ratingSummaryStars: { color: C.accent, fontSize: 14 },
  ratingSummaryValue: { color: C.ink, fontWeight: '800', fontSize: 14 },
  ratingSummaryCount: { color: C.muted, fontSize: 11.5 },
  verifyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.cream, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10 },
  verifyPillOk: { backgroundColor: '#E7F3F0' },
  verifyPillText: { color: C.muted, fontWeight: '700', fontSize: 10.5 },
  verifyPillTextOk: { color: C.teal },
  sectionTitle: { alignSelf: 'flex-start', color: C.ink, fontWeight: '800', fontSize: 14, marginBottom: 12 },
  emptyText: { alignSelf: 'flex-start', color: C.muted, fontSize: 12, marginBottom: 12 },
  skillsWrap: { alignSelf: 'stretch', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  skillChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.cream },
  skillChipMore: { backgroundColor: '#FBEFEC', borderColor: '#FBEFEC' },
  skillChipText: { color: C.ink, fontWeight: '700', fontSize: 12 },
  skillChipMoreText: { color: C.brand },
  skillRemoveButton: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center' },
  addSkillButton: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingVertical: 6 },
  addSkillText: { color: C.brand, fontWeight: '700', fontSize: 12.5 },
  pickerWrap: { alignSelf: 'stretch', borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed', marginTop: 6, paddingTop: 12 },
  skillOption: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.cream },
  skillOptionSaving: { opacity: 0.7 },
  skillOptionText: { color: C.ink, fontWeight: '600', fontSize: 12 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  errorText: { color: C.brand, fontSize: 11, fontWeight: '600', flex: 1 },
});
