import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '@/components/app-text';
import { DateTimePickerField, LocationPicker } from '@/components/job-scheduling-fields';
import { ProfileMenu } from '@/components/profile-menu';
import { SERVICE_CATEGORY_LABELS } from '@/constants/categories';
import { C } from '@/constants/handyhub-theme';
import { useAuth } from '@/hooks/use-auth';
import { formatScheduled } from '@/lib/format';
import { createJobForCustomer, fetchAgentCustomerJobs, suggestWorkerForJob, type Job, type JobStatus } from '@/lib/jobs';
import { fetchAvailableWorkers, fetchRecruits, type Profile, type WorkerListing } from '@/lib/profiles';

const VERIFICATION_LABEL: Record<Profile['idVerificationStatus'], string> = {
  unverified: 'Not verified',
  pending: 'Pending review',
  verified: 'Verified',
  rejected: 'Rejected',
};

const ACTIVE_STATUSES: JobStatus[] = ['open', 'negotiating', 'accepted', 'in_progress'];

const AGENT_STATUS_LABEL: Record<JobStatus, string> = {
  open: 'Open',
  negotiating: 'Negotiating',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const AGENT_STATUS_TONE: Record<JobStatus, 'open' | 'active' | 'done'> = {
  open: 'open',
  negotiating: 'open',
  accepted: 'active',
  in_progress: 'active',
  completed: 'done',
  cancelled: 'done',
};

function isReferred(customer: Profile, agentId?: string) {
  return customer.recruitedBy === agentId;
}

function RecruitRow({ recruit, agentId }: { recruit: Profile; agentId?: string }) {
  const relationship = isReferred(recruit, agentId) ? 'Referred' : 'Assigned';
  return (
    <View style={styles.recruitRow}>
      <View style={styles.recruitAvatar}>
        <Ionicons color={C.brand} name={recruit.role === 'worker' ? 'construct-outline' : 'person-outline'} size={16} />
      </View>
      <View style={styles.recruitInfo}>
        <Text style={styles.recruitName}>{recruit.name}</Text>
        <Text style={styles.recruitMeta}>
          {recruit.role === 'worker' ? 'Worker' : `Customer · ${relationship}`}
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

function JobRow({ job, onSuggest }: { job: Job; onSuggest: () => void }) {
  const suggested = !!job.suggestedWorkerId;
  const tone = AGENT_STATUS_TONE[job.status];
  const displayPrice = job.finalPrice ?? job.currentOffer ?? job.listedPrice;

  return (
    <View style={styles.jobRow}>
      <View style={styles.jobHeaderRow}>
        <Text style={styles.jobCustomer}>{job.customerName ?? 'Customer'}</Text>
        <View style={[styles.jobStatusPill, styles[`jobStatusPill_${tone}`]]}>
          <Text style={[styles.jobStatusPillText, styles[`jobStatusPillText_${tone}`]]}>{AGENT_STATUS_LABEL[job.status]}</Text>
        </View>
      </View>
      <Text style={styles.jobService}>
        {job.category} · {job.service}
      </Text>
      <View style={styles.jobMetaRow}>
        {displayPrice !== undefined && (
          <View style={styles.jobMetaItem}>
            <Text style={styles.jobMetaPrice}>KSh {displayPrice.toLocaleString()}{job.payType === 'hourly' ? '/hr' : ''}</Text>
          </View>
        )}
        {job.workerName && (
          <View style={styles.jobMetaItem}>
            <Ionicons color={C.muted} name="construct-outline" size={12} />
            <Text style={styles.jobMetaText}>{job.workerName}</Text>
          </View>
        )}
        {job.status === 'completed' && job.completedAt ? (
          <View style={styles.jobMetaItem}>
            <Ionicons color={C.muted} name="checkmark-done-outline" size={12} />
            <Text style={styles.jobMetaText}>Completed {formatScheduled(job.completedAt)}</Text>
          </View>
        ) : (
          job.scheduledAt && (
            <View style={styles.jobMetaItem}>
              <Ionicons color={C.muted} name="calendar-outline" size={12} />
              <Text style={styles.jobMetaText}>{formatScheduled(job.scheduledAt)}</Text>
            </View>
          )
        )}
        {job.location && (
          <View style={styles.jobMetaItem}>
            <Ionicons color={C.muted} name="location-outline" size={12} />
            <Text style={styles.jobMetaText} numberOfLines={1}>
              {job.location}
            </Text>
          </View>
        )}
      </View>

      {job.status === 'completed' && job.rating && (
        <Text style={styles.suggestedNote}>Rated {job.rating} ★</Text>
      )}

      {job.status === 'open' && (
        <>
          {suggested && (
            <Text style={styles.suggestedNote}>
              Assigned to {job.suggestedWorkerName ?? 'a worker'} — waiting for negotiation.
            </Text>
          )}
          <Pressable disabled={suggested} onPress={onSuggest} style={[styles.suggestButton, suggested && styles.suggestButtonDone]}>
            <Ionicons color={suggested ? C.teal : '#FFFFFF'} name={suggested ? 'checkmark' : 'person-add-outline'} size={14} />
            <Text style={[styles.suggestButtonText, suggested && styles.suggestButtonTextDone]}>
              {suggested ? 'Suggested' : 'Suggest a worker'}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function AgentPostJobModal({ visible, onClose, customers, agentId, onCreated }: {
  visible: boolean;
  onClose: () => void;
  customers: Profile[];
  agentId?: string;
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [category, setCategory] = useState<string>(SERVICE_CATEGORY_LABELS[0]);
  const [service, setService] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [location, setLocation] = useState('');
  const [scheduledAt, setScheduledAt] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const referred = customers.filter((c) => isReferred(c, agentId));
  const assigned = customers.filter((c) => !isReferred(c, agentId));
  const canSubmit = !!customerId && service.trim().length > 0 && Number(offerAmount) > 0;

  function reset() {
    setCustomerId(null);
    setCategory(SERVICE_CATEGORY_LABELS[0]);
    setService('');
    setOfferAmount('');
    setLocation('');
    setScheduledAt(undefined);
    setError(null);
  }

  function close() {
    reset();
    onClose();
  }

  async function submit() {
    if (!canSubmit || !customerId) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await createJobForCustomer({
        customerId,
        category,
        service: service.trim(),
        payType: 'task',
        offer: Number(offerAmount),
        location: location.trim() || undefined,
        scheduledAt,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this job.');
    }
    setIsSubmitting(false);
  }

  return (
    <Modal animationType="slide" onRequestClose={close} transparent visible={visible}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.modalSheet, styles.postJobSheet]}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>Post a job for a customer</Text>
            <Text style={styles.modalSubtitle}>
              Goes live exactly like a job they&apos;d post themselves — any matching pro can pick it up and negotiate.
            </Text>

            {customers.length === 0 && (
              <Text style={styles.emptyText}>You don&apos;t have any referred or assigned customers yet.</Text>
            )}

            {referred.length > 0 && (
              <>
                <Text style={styles.formLabel}>Referred customers</Text>
                <View style={styles.customerPickRow}>
                  {referred.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => setCustomerId(c.id)}
                      style={[styles.customerChip, customerId === c.id && styles.customerChipActive]}>
                      <Text style={[styles.customerChipText, customerId === c.id && styles.customerChipTextActive]}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {assigned.length > 0 && (
              <>
                <Text style={styles.formLabel}>Assigned customers</Text>
                <View style={styles.customerPickRow}>
                  {assigned.map((c) => (
                    <Pressable
                      key={c.id}
                      onPress={() => setCustomerId(c.id)}
                      style={[styles.customerChip, customerId === c.id && styles.customerChipActive]}>
                      <Text style={[styles.customerChipText, customerId === c.id && styles.customerChipTextActive]}>{c.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.formLabel}>Category</Text>
            <View style={styles.customerPickRow}>
              {SERVICE_CATEGORY_LABELS.map((label) => (
                <Pressable
                  key={label}
                  onPress={() => setCategory(label)}
                  style={[styles.customerChip, category === label && styles.customerChipActive]}>
                  <Text style={[styles.customerChipText, category === label && styles.customerChipTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.formLabel}>What do they need done?</Text>
            <TextInput
              onChangeText={setService}
              placeholder="e.g. Fix a leaking kitchen tap"
              placeholderTextColor={C.muted}
              style={styles.formInput}
              value={service}
            />

            <Text style={styles.formLabel}>Offer (KSh)</Text>
            <TextInput
              keyboardType="number-pad"
              onChangeText={setOfferAmount}
              placeholder="e.g. 1500"
              placeholderTextColor={C.muted}
              style={styles.formInput}
              value={offerAmount}
            />

            <Text style={styles.formLabel}>Location (optional)</Text>
            <LocationPicker onChange={setLocation} value={location} />

            <Text style={styles.formLabel}>When (optional)</Text>
            <DateTimePickerField onChange={setScheduledAt} valueIso={scheduledAt} />

            {error && (
              <View style={styles.errorRow}>
                <Ionicons color={C.brand} name="alert-circle" size={13} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              disabled={!canSubmit || isSubmitting}
              onPress={submit}
              style={[styles.suggestButton, (!canSubmit || isSubmitting) && styles.suggestButtonDisabled]}>
              {isSubmitting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.suggestButtonText}>Post job</Text>}
            </Pressable>
            <Pressable disabled={isSubmitting} onPress={close} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function AgentScreen() {
  const { user } = useAuth();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [recruits, setRecruits] = useState<Profile[]>([]);
  const [customerJobs, setCustomerJobs] = useState<Job[]>([]);
  const [availableWorkers, setAvailableWorkers] = useState<WorkerListing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [suggestingJob, setSuggestingJob] = useState<Job | null>(null);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [jobsTab, setJobsTab] = useState<'active' | 'completed'>('active');
  const [postJobOpen, setPostJobOpen] = useState(false);

  async function copyReferralCode() {
    if (!user?.referralCode) return;
    Haptics.selectionAsync();
    await Clipboard.setStringAsync(user.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const load = useCallback(async () => {
    if (!user) return { recruits: [], jobs: [], workers: [] };
    const [recruitRows, jobRows, workerRows] = await Promise.all([
      fetchRecruits(user.id),
      fetchAgentCustomerJobs(),
      fetchAvailableWorkers(),
    ]);
    return { recruits: recruitRows, jobs: jobRows, workers: workerRows };
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    load()
      .then(({ recruits: recruitRows, jobs, workers }) => {
        if (cancelled) return;
        setRecruits(recruitRows);
        setCustomerJobs(jobs);
        setAvailableWorkers(workers);
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
      const { recruits: recruitRows, jobs, workers } = await load();
      setRecruits(recruitRows);
      setCustomerJobs(jobs);
      setAvailableWorkers(workers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your recruits.');
    }
    setIsRefreshing(false);
  }

  const matchingWorkers = useMemo(
    () => (suggestingJob ? availableWorkers.filter((worker) => worker.skills.includes(suggestingJob.category)) : []),
    [suggestingJob, availableWorkers],
  );

  async function handleSuggest(worker: WorkerListing) {
    if (!suggestingJob) return;
    setIsSuggesting(true);
    try {
      await suggestWorkerForJob(suggestingJob.id, worker.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCustomerJobs((prev) =>
        prev.map((job) =>
          job.id === suggestingJob.id ? { ...job, suggestedWorkerId: worker.id, suggestedWorkerName: worker.name } : job,
        ),
      );
      setSuggestingJob(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send that suggestion.');
    }
    setIsSuggesting(false);
  }

  async function handleJobCreated() {
    setPostJobOpen(false);
    setJobsTab('active');
    try {
      setCustomerJobs((await load()).jobs);
    } catch {
      // Best-effort refresh — the new job still exists even if this refetch fails.
    }
  }

  const workers = recruits.filter((recruit) => recruit.role === 'worker');
  const customers = recruits.filter((recruit) => recruit.role === 'customer');
  const activeJobs = customerJobs.filter((job) => ACTIVE_STATUSES.includes(job.status));
  const completedJobs = customerJobs.filter((job) => !ACTIVE_STATUSES.includes(job.status));
  const visibleJobs = jobsTab === 'active' ? activeJobs : completedJobs;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Agent dashboard</Text>
          <Text style={styles.headline}>{user?.name}</Text>
        </View>
        <Pressable hitSlop={6} onPress={() => setProfileMenuOpen(true)} style={styles.headerButton}>
          <Ionicons color="#FFFFFF" name="person-outline" size={20} />
        </Pressable>
      </View>
      <ProfileMenu onClose={() => setProfileMenuOpen(false)} visible={profileMenuOpen} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} tintColor={C.brand} />}
        showsVerticalScrollIndicator={false}>
        <View style={styles.referralCard}>
          <Text style={styles.referralLabel}>Your referral code</Text>
          <View style={styles.referralCodeRow}>
            <Text style={styles.referralCode}>{user?.referralCode ?? '—'}</Text>
            <Pressable disabled={!user?.referralCode} onPress={copyReferralCode} style={styles.referralCopyButton}>
              <Ionicons color={copied ? C.teal : C.brand} name={copied ? 'checkmark' : 'copy-outline'} size={14} />
              <Text style={[styles.referralCopyText, copied && styles.referralCopyTextCopied]}>
                {copied ? 'Copied' : 'Copy'}
              </Text>
            </Pressable>
          </View>
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
          recruits.map((recruit) => <RecruitRow agentId={user?.id} key={recruit.id} recruit={recruit} />)
        )}

        <View style={[styles.jobsSectionHeader, styles.jobsSectionTitle]}>
          <Text style={styles.sectionTitle}>Your customers&apos; jobs</Text>
          <Pressable onPress={() => setPostJobOpen(true)} style={styles.postJobButton}>
            <Ionicons color={C.brand} name="add" size={14} />
            <Text style={styles.postJobButtonText}>Post for a customer</Text>
          </Pressable>
        </View>

        <View style={styles.jobsTabRow}>
          <Pressable onPress={() => setJobsTab('active')} style={[styles.jobsTabChip, jobsTab === 'active' && styles.jobsTabChipActive]}>
            <Text style={[styles.jobsTabText, jobsTab === 'active' && styles.jobsTabTextActive]}>Active ({activeJobs.length})</Text>
          </Pressable>
          <Pressable onPress={() => setJobsTab('completed')} style={[styles.jobsTabChip, jobsTab === 'completed' && styles.jobsTabChipActive]}>
            <Text style={[styles.jobsTabText, jobsTab === 'completed' && styles.jobsTabTextActive]}>Completed ({completedJobs.length})</Text>
          </Pressable>
        </View>

        {!isLoading && visibleJobs.length === 0 ? (
          <View style={styles.comingSoon}>
            <Ionicons color={C.muted} name="briefcase-outline" size={18} />
            <Text style={styles.comingSoonText}>
              {jobsTab === 'active'
                ? "None of your customers have an active job right now — you'll see it here as soon as they post one."
                : 'No completed jobs yet.'}
            </Text>
          </View>
        ) : (
          visibleJobs.map((job) => <JobRow job={job} key={job.id} onSuggest={() => setSuggestingJob(job)} />)
        )}
      </ScrollView>

      <AgentPostJobModal
        agentId={user?.id}
        customers={customers}
        onClose={() => setPostJobOpen(false)}
        onCreated={handleJobCreated}
        visible={postJobOpen}
      />

      <Modal animationType="slide" onRequestClose={() => setSuggestingJob(null)} transparent visible={!!suggestingJob}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Suggest a worker</Text>
            <Text style={styles.modalSubtitle}>
              {suggestingJob ? `For ${suggestingJob.customerName ?? 'this customer'}'s ${suggestingJob.category.toLowerCase()} job` : ''}
            </Text>
            <ScrollView style={styles.modalList}>
              {matchingWorkers.length === 0 ? (
                <Text style={styles.emptyText}>No verified workers with this skill are available right now.</Text>
              ) : (
                matchingWorkers.map((worker) => (
                  <Pressable
                    disabled={isSuggesting}
                    key={worker.id}
                    onPress={() => handleSuggest(worker)}
                    style={styles.workerOption}>
                    <View style={styles.recruitAvatar}>
                      <Ionicons color={C.brand} name="construct-outline" size={16} />
                    </View>
                    <View style={styles.recruitInfo}>
                      <Text style={styles.recruitName}>{worker.name}</Text>
                      <Text style={styles.recruitMeta}>
                        {worker.location ?? 'Location not set'}
                        {worker.ratingCount > 0 ? ` · ★ ${worker.ratingAverage.toFixed(1)}` : ''}
                      </Text>
                    </View>
                    {isSuggesting && <ActivityIndicator color={C.brand} size="small" />}
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable disabled={isSuggesting} onPress={() => setSuggestingJob(null)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.ink, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  eyebrow: { color: '#AEB8DA', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  headline: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  headerButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },
  referralCard: { backgroundColor: C.card, borderRadius: 18, padding: 18, marginBottom: 14 },
  referralLabel: { color: C.muted, fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 },
  referralCodeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  referralCode: { color: C.brand, fontWeight: '800', fontSize: 24, letterSpacing: 1 },
  referralCopyButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 11, borderRadius: 10, backgroundColor: C.cream, borderWidth: 1, borderColor: C.line },
  referralCopyText: { color: C.brand, fontWeight: '700', fontSize: 11.5 },
  referralCopyTextCopied: { color: C.teal },
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
  jobsSectionTitle: { marginTop: 8 },
  jobsSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  postJobButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: '#FBEFEC' },
  postJobButtonText: { color: C.brand, fontWeight: '700', fontSize: 11.5 },
  jobsTabRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  jobsTabChip: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  jobsTabChipActive: { backgroundColor: C.ink, borderColor: C.ink },
  jobsTabText: { color: C.muted, fontWeight: '700', fontSize: 12 },
  jobsTabTextActive: { color: '#FFFFFF' },
  jobRow: { backgroundColor: C.card, borderRadius: 14, padding: 14, marginBottom: 10 },
  jobHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4, gap: 8 },
  jobCustomer: { color: C.ink, fontWeight: '700', fontSize: 13.5, flex: 1 },
  jobStatusPill: { paddingVertical: 4, paddingHorizontal: 9, borderRadius: 8 },
  jobStatusPill_open: { backgroundColor: '#E9EDFB' },
  jobStatusPill_active: { backgroundColor: '#FFF0DA' },
  jobStatusPill_done: { backgroundColor: '#E7F3F0' },
  jobStatusPillText: { fontSize: 10, fontWeight: '700' },
  jobStatusPillText_open: { color: '#3D57C4' },
  jobStatusPillText_active: { color: C.orange },
  jobStatusPillText_done: { color: C.teal },
  jobService: { color: C.muted, fontSize: 12, marginBottom: 8 },
  jobMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 10 },
  jobMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  jobMetaText: { color: C.muted, fontSize: 11.5 },
  jobMetaPrice: { color: C.brand, fontWeight: '700', fontSize: 12 },
  suggestedNote: { color: C.teal, fontWeight: '700', fontSize: 11, marginBottom: 8 },
  suggestButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.brand, borderRadius: 10, paddingVertical: 9 },
  suggestButtonDone: { backgroundColor: '#E7F3F0' },
  suggestButtonDisabled: { opacity: 0.5 },
  suggestButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12.5 },
  suggestButtonTextDone: { color: C.teal },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(19,32,67,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: C.cream, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '75%' },
  postJobSheet: { maxHeight: '88%' },
  modalTitle: { color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 2 },
  modalSubtitle: { color: C.muted, fontSize: 12, marginBottom: 14 },
  modalList: { marginBottom: 14 },
  workerOption: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 12, marginBottom: 10 },
  modalClose: { alignItems: 'center', paddingVertical: 12 },
  modalCloseText: { color: C.muted, fontWeight: '700', fontSize: 13 },
  formLabel: { color: C.muted, fontWeight: '700', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, marginTop: 12, marginBottom: 8 },
  formInput: { height: 44, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 13, fontSize: 13, color: C.ink, backgroundColor: C.card, outlineWidth: 1.5, outlineColor: '#D1D5DB', outlineStyle: 'solid' },
  customerPickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  customerChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  customerChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  customerChipText: { color: C.ink, fontWeight: '600', fontSize: 12 },
  customerChipTextActive: { color: '#FFFFFF' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  errorText: { color: C.brand, fontSize: 11.5, fontWeight: '600', flex: 1 },
});
