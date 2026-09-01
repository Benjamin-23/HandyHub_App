import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AgentScreen } from '@/components/agent-screen';
import { LoginScreen } from '@/components/login-screen';
import { NotificationBell } from '@/components/notification-bell';
import { PendingApprovalScreen } from '@/components/pending-approval-screen';
import { VerifyIdentityScreen } from '@/components/verify-identity-screen';
import { WorkerProfileScreen } from '@/components/worker-profile-screen';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS, type ServiceCategory } from '@/constants/categories';
import { C } from '@/constants/handyhub-theme';
import { useAuth, type AuthUser } from '@/hooks/use-auth';
import {
  acceptOffer,
  claimJob,
  completeJobWithCode,
  confirmSchedule,
  counterOffer,
  fetchCustomerJobs,
  fetchJobCounterpartPhone,
  fetchWorkerJobs,
  postJob,
  rateJob,
  recordPayment,
  remitJob,
  startJob,
  updateJobDetails,
  type Job,
  type JobPaymentMethod,
  type JobStatus,
} from '@/lib/jobs';
import { fetchAvailableWorkers, type IdVerificationStatus, type WorkerListing } from '@/lib/profiles';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function useTapScale(target = 0.94) {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return {
    animatedStyle,
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutated by design
    onPressIn: () => { scale.value = withSpring(target, { damping: 16, stiffness: 260 }); },
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared values are mutated by design
    onPressOut: () => { scale.value = withSpring(1, { damping: 16, stiffness: 260 }); },
  };
}

const JOB_POLL_INTERVAL_MS = 15000;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const TIME_SLOTS = (() => {
  const slots: string[] = [];
  for (let h = 7; h <= 20; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
})();

function formatTimeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const hours12 = h % 12 === 0 ? 12 : h % 12;
  return `${hours12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function formatScheduled(iso: string): string {
  const d = new Date(iso);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${formatTimeLabel(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)}`;
}

type Mode = 'customer' | 'worker';
type CustomerTab = 'home' | 'orders' | 'wallet' | 'messages';
type WorkerTab = 'jobs' | 'earnings' | 'messages' | 'profile';

type IconName =
  | 'person' | 'bell' | 'search' | 'clear' | 'checkmark' | 'arrowUp' | 'arrowDown'
  | 'alert' | 'checkCircle' | 'calendar' | 'shield' | 'document' | 'home' | 'orders' | 'wallet' | 'messages';

type IconSpec =
  | { family: 'ionicons'; glyph: keyof typeof Ionicons.glyphMap }
  | { family: 'mci'; glyph: keyof typeof MaterialCommunityIcons.glyphMap };

const ICONS: Record<IconName, IconSpec> = {
  person: { family: 'ionicons', glyph: 'person' },
  bell: { family: 'ionicons', glyph: 'notifications' },
  search: { family: 'ionicons', glyph: 'search' },
  clear: { family: 'ionicons', glyph: 'close-circle' },
  checkmark: { family: 'ionicons', glyph: 'checkmark' },
  arrowUp: { family: 'ionicons', glyph: 'arrow-up' },
  arrowDown: { family: 'ionicons', glyph: 'arrow-down' },
  alert: { family: 'ionicons', glyph: 'alert-circle' },
  checkCircle: { family: 'ionicons', glyph: 'checkmark-circle' },
  calendar: { family: 'ionicons', glyph: 'calendar' },
  shield: { family: 'ionicons', glyph: 'shield-checkmark' },
  document: { family: 'ionicons', glyph: 'document-text' },
  home: { family: 'ionicons', glyph: 'home' },
  orders: { family: 'ionicons', glyph: 'cube' },
  wallet: { family: 'ionicons', glyph: 'wallet' },
  messages: { family: 'ionicons', glyph: 'chatbubble-ellipses' },
};

// Real worker profiles, fetched from Supabase — see fetchAvailableWorkers().
type Professional = WorkerListing;

function Icon({ name, color, size = 18 }: { name: IconName; color: string; size?: number }) {
  const spec = ICONS[name];
  if (spec.family === 'mci') return <MaterialCommunityIcons color={color} name={spec.glyph} size={size} />;
  return <Ionicons color={color} name={spec.glyph} size={size} />;
}

function CustomerHeader({ query, onQueryChange, name, onSignOut }: {
  query: string;
  onQueryChange: (value: string) => void;
  name: string;
  onSignOut: () => void;
}) {
  return (
    <View style={styles.hero}>
      <View style={styles.brandRow}>
        <View style={styles.brandNameRow}>
          <View style={styles.brandDiamond} />
          <Text style={styles.brandName}>HandyHub</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={onSignOut} style={styles.headerButton}><Icon name="person" color="#FFFFFF" size={14} /></Pressable>
          <NotificationBell />
        </View>
      </View>
      <Text style={styles.greeting}>Good evening, {name}</Text>
      <Text style={styles.headline}>Who&apos;s fixing things today?</Text>
      <View style={styles.searchBar}>
        <Icon name="search" color="#9AA4C8" size={15} />
        <TextInput
          accessibilityLabel="Search professionals"
          onChangeText={onQueryChange}
          placeholder="Search plumbers, electricians..."
          placeholderTextColor="#9AA4C8"
          returnKeyType="search"
          style={styles.searchInput}
          value={query}
        />
        {query.length > 0 && (
          <Pressable hitSlop={8} onPress={() => onQueryChange('')}>
            <Icon name="clear" color="#9AA4C8" size={16} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

function CategoryIcon({ icon, color, size = 18 }: { icon: ServiceCategory['icon']; color: string; size?: number }) {
  if (icon.family === 'mci') return <MaterialCommunityIcons color={color} name={icon.glyph as keyof typeof MaterialCommunityIcons.glyphMap} size={size} />;
  return <Ionicons color={color} name={icon.glyph as keyof typeof Ionicons.glyphMap} size={size} />;
}

function CategoryTile({ category, active, onPress }: { category: ServiceCategory; active: boolean; onPress: () => void }) {
  const { animatedStyle, onPressIn, onPressOut } = useTapScale();
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[styles.categoryItem, animatedStyle]}>
      <View
        style={[
          styles.categoryIcon,
          { backgroundColor: category.background },
          active && { borderWidth: 2, borderColor: category.color },
        ]}>
        <CategoryIcon color={category.color} icon={category.icon} size={23} />
      </View>
      <Text style={[styles.categoryLabel, active && { color: category.color }]}>{category.label}</Text>
    </AnimatedPressable>
  );
}

function CategoryGrid({ activeCategory, onSelect }: { activeCategory: string | null; onSelect: (label: string) => void }) {
  return (
    <View style={styles.categoryGrid}>
      {SERVICE_CATEGORIES.map((category) => (
        <CategoryTile
          active={category.label === activeCategory}
          category={category}
          key={category.label}
          onPress={() => onSelect(category.label)}
        />
      ))}
    </View>
  );
}

function ProCard({ pro, onPress }: { pro: Professional; onPress: () => void }) {
  const { animatedStyle, onPressIn, onPressOut } = useTapScale(0.97);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={[styles.proCard, animatedStyle]}>
      <View style={styles.avatarWrap}>
        <View style={styles.avatarInitials}>
          <Text style={styles.avatarInitialsText}>{pro.name.charAt(0).toUpperCase()}</Text>
        </View>
        {pro.idVerificationStatus === 'verified' && (
          <View style={styles.verified}><Icon name="checkmark" color="#FFFFFF" size={9} /></View>
        )}
      </View>
      <View style={styles.proInfo}>
        <Text style={styles.proName}>{pro.name}</Text>
        {(pro.ratingCount > 0 || pro.location) && (
          <View style={styles.metaRow}>
            {pro.ratingCount > 0 && (
              <Text style={styles.rating}>★ {pro.ratingAverage.toFixed(1)} ({pro.ratingCount})</Text>
            )}
            {pro.location && <Text style={styles.meta}>{pro.ratingCount > 0 ? ` · ${pro.location}` : pro.location}</Text>}
          </View>
        )}
        <View style={styles.tagRow}>
          {pro.skills.map((skill, index) => (
            <View key={skill} style={[styles.tag, index > 0 && styles.tagAlt]}>
              <Text style={[styles.tagText, index > 0 && styles.tagTextAlt]}>{skill}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.negotiateArea}>
        <View style={styles.negotiatePill}><Text style={styles.negotiateText}>Negotiable</Text></View>
        <Text style={styles.quoteHint}>Quote on request</Text>
      </View>
    </AnimatedPressable>
  );
}

function EmptyState({ icon, title, text }: { icon: IconName; title: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIcon}><Icon name={icon} color={C.muted} size={26} /></View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function CustomerHome({ onBook, onPostJob, name, onSignOut }: {
  onBook: (pro: Professional) => void;
  onPostJob: () => void;
  name: string;
  onSignOut: () => void;
}) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [workers, setWorkers] = useState<Professional[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAvailableWorkers()
      .then((data) => { if (!cancelled) { setWorkers(data); setError(null); } })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load workers.'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return workers.filter((pro) => {
      const matchesCategory = !activeCategory || pro.skills.includes(activeCategory);
      const matchesQuery = !q || pro.name.toLowerCase().includes(q) || pro.skills.some((skill) => skill.toLowerCase().includes(q));
      return matchesCategory && matchesQuery;
    });
  }, [workers, query, activeCategory]);

  const filtering = query.length > 0 || activeCategory !== null;

  return (
    <View style={styles.screenContent}>
      <CustomerHeader name={name} onQueryChange={setQuery} onSignOut={onSignOut} query={query} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.customerScroll}>
        <Text style={styles.sectionTitle}>Categories</Text>
        <CategoryGrid
          activeCategory={activeCategory}
          onSelect={(label) => {
            Haptics.selectionAsync();
            setActiveCategory((current) => (current === label ? null : label));
          }}
        />
        <View style={styles.promo}>
          <View>
            <Text style={styles.promoTitle}>First job, on us</Text>
            <Text style={styles.promoText}>Get 20% off your first booking, paid via M-Pesa.</Text>
          </View>
          <Text style={styles.promoPercent}>20%</Text>
        </View>
        <View style={styles.sectionHeadingRow}>
          <Text style={styles.sectionTitle}>{activeCategory ? `${activeCategory} pros` : 'Available pros'}</Text>
          {filtering && (
            <Pressable onPress={() => { setActiveCategory(null); setQuery(''); }}>
              <Text style={styles.seeAll}>Clear</Text>
            </Pressable>
          )}
        </View>
        {isLoading ? (
          <ActivityIndicator color={C.brand} style={styles.ordersLoading} />
        ) : error ? (
          <EmptyState icon="alert" text={error} title="Could not load workers" />
        ) : filtered.length > 0 ? (
          filtered.map((pro) => <ProCard key={pro.id} onPress={() => onBook(pro)} pro={pro} />)
        ) : (
          <EmptyState
            icon="search"
            text="Try a different search term or category."
            title="No pros found"
          />
        )}
      </ScrollView>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPostJob(); }}
        style={({ pressed }) => [styles.postJobFab, pressed && styles.pressed]}>
        <Ionicons color="#FFFFFF" name="add" size={22} />
      </Pressable>
    </View>
  );
}

function StatusPill({ children, tone }: { children: string; tone: 'orange' | 'blue' | 'green' }) {
  return (
    <View style={[styles.statusPill, styles[`statusPill_${tone}`]]}>
      <Text style={[styles.statusPillText, styles[`statusPillText_${tone}`]]}>{children}</Text>
    </View>
  );
}

function OrderBase({ service, professional, status, tone, date, price, children }: {
  service: string;
  professional: string;
  status: string;
  tone: 'orange' | 'blue' | 'green';
  date?: string;
  price?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.orderCard}>
      <View style={styles.orderTop}>
        <View style={styles.orderTitleWrap}>
          <Text style={styles.orderService}>{service}</Text>
          <Text style={styles.orderWith}>with {professional}</Text>
        </View>
        <StatusPill tone={tone}>{status}</StatusPill>
      </View>
      {date && price && (
        <View style={styles.orderMetaRow}>
          <Text style={styles.orderDate}>{date}</Text>
          <Text style={styles.orderAmount}>{price}</Text>
        </View>
      )}
      {children}
    </View>
  );
}

// Shows once the job is matched (worker_id set) and the caller is a
// participant — self-hides otherwise, so it's safe to render unconditionally.
// See get_job_counterpart_phone() in schema.sql.
function CounterpartCall({ job, name }: { job: Job; name: string }) {
  const [phone, setPhone] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchJobCounterpartPhone(job.id)
      .then((value) => { if (!cancelled) setPhone(value); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [job.id, job.status]);

  if (!phone) return null;

  return (
    <Pressable
      onPress={() => { Haptics.selectionAsync(); Linking.openURL(`tel:${phone}`); }}
      style={styles.callRow}>
      <Ionicons color={C.teal} name="call" size={13} />
      <Text style={styles.callRowText}>Call {name} · {phone}</Text>
    </Pressable>
  );
}

// A real calendar-grid date picker + time-slot picker, entirely custom (no
// native module) so it behaves identically on iOS, Android, and web.
function DateTimePickerField({ valueIso, onChange }: {
  valueIso?: string;
  onChange: (iso: string | undefined) => void;
}) {
  const initial = valueIso ? new Date(valueIso) : null;
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(initial?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial?.getMonth() ?? today.getMonth());
  const [selectedDay, setSelectedDay] = useState<number | null>(initial?.getDate() ?? null);
  const [selectedTime, setSelectedTime] = useState<string | null>(
    initial ? `${String(initial.getHours()).padStart(2, '0')}:${String(initial.getMinutes()).padStart(2, '0')}` : null,
  );

  const firstOfMonth = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstOfMonth.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function commit(day: number | null, time: string | null) {
    if (day === null || !time) return;
    const [h, m] = time.split(':').map(Number);
    onChange(new Date(viewYear, viewMonth, day, h, m, 0).toISOString());
  }

  function selectDay(day: number) {
    Haptics.selectionAsync();
    setSelectedDay(day);
    commit(day, selectedTime);
  }

  function selectTime(time: string) {
    Haptics.selectionAsync();
    setSelectedTime(time);
    commit(selectedDay, time);
  }

  function goMonth(delta: number) {
    const next = new Date(viewYear, viewMonth + delta, 1);
    const floor = new Date(today.getFullYear(), today.getMonth(), 1);
    if (next < floor) return;
    Haptics.selectionAsync();
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function clear() {
    Haptics.selectionAsync();
    setSelectedDay(null);
    setSelectedTime(null);
    onChange(undefined);
  }

  const displayText = selectedDay && selectedTime
    ? `${MONTH_NAMES[viewMonth]} ${selectedDay}, ${formatTimeLabel(selectedTime)}`
    : 'Pick date & time';

  return (
    <View>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); setOpen((value) => !value); }}
        style={styles.dateTimeTrigger}>
        <Ionicons color={C.brand} name="calendar-outline" size={13} />
        <Text style={styles.dateTimeTriggerText}>{displayText}</Text>
        {(selectedDay !== null || selectedTime !== null) && (
          <Pressable hitSlop={8} onPress={clear}>
            <Ionicons color={C.muted} name="close-circle" size={14} />
          </Pressable>
        )}
      </Pressable>

      {open && (
        <View style={styles.calendarWrap}>
          <View style={styles.calendarHeader}>
            <Pressable hitSlop={8} onPress={() => goMonth(-1)}>
              <Ionicons color={C.ink} name="chevron-back" size={14} />
            </Pressable>
            <Text style={styles.calendarHeaderText}>{MONTH_NAMES[viewMonth]} {viewYear}</Text>
            <Pressable hitSlop={8} onPress={() => goMonth(1)}>
              <Ionicons color={C.ink} name="chevron-forward" size={14} />
            </Pressable>
          </View>

          <View style={styles.calendarWeekRow}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Text key={index} style={styles.calendarWeekday}>{label}</Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {cells.map((day, index) => {
              if (day === null) return <View key={index} style={styles.calendarCell} />;
              const isPast = new Date(viewYear, viewMonth, day) < today;
              const isSelected = day === selectedDay;
              return (
                <Pressable
                  disabled={isPast}
                  key={index}
                  onPress={() => selectDay(day)}
                  style={[styles.calendarCell, isSelected && styles.calendarCellSelected]}>
                  <Text
                    style={[
                      styles.calendarCellText,
                      isPast && styles.calendarCellTextDisabled,
                      isSelected && styles.calendarCellTextSelected,
                    ]}>
                    {day}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.calendarTimeLabel}>Time</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.timeSlotRow}>
              {TIME_SLOTS.map((slot) => (
                <Pressable
                  key={slot}
                  onPress={() => selectTime(slot)}
                  style={[styles.timeSlotChip, selectedTime === slot && styles.timeSlotChipActive]}>
                  <Text style={[styles.timeSlotText, selectedTime === slot && styles.timeSlotTextActive]}>
                    {formatTimeLabel(slot)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

// Lets either side adjust the location or scheduled date/time up until a
// price is agreed — the description and category are never editable by
// either side, and the DB rejects the update once past 'negotiating'.
function JobDetailsEditor({ job, busy, onSave }: {
  job: Job;
  busy: boolean;
  onSave: (updates: { location?: string; scheduledAt?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(job.location ?? '');
  const [scheduledAt, setScheduledAt] = useState(job.scheduledAt);

  const preAgreement = job.status === 'open' || job.status === 'negotiating';
  // Unlike location, the schedule can still shift after a price is agreed —
  // it just needs the other side to confirm (see the pending-reschedule note above).
  const canEditSchedule = preAgreement || job.status === 'accepted' || job.status === 'in_progress';

  if (!canEditSchedule) return null;

  function resetFields() {
    setLocation(job.location ?? '');
    setScheduledAt(job.scheduledAt);
  }

  if (!open) {
    return (
      <Pressable
        onPress={() => { Haptics.selectionAsync(); resetFields(); setOpen(true); }}
        style={styles.editDetailsLink}>
        <Ionicons color={C.muted} name="pencil-outline" size={11} />
        <Text style={styles.editDetailsText}>{preAgreement ? 'Edit location or schedule' : 'Reschedule'}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.editDetailsWrap}>
      {preAgreement && (
        <TextInput
          editable={!busy}
          onChangeText={setLocation}
          placeholder="Location (optional)"
          placeholderTextColor={C.muted}
          style={styles.counterInput}
          value={location}
        />
      )}
      <DateTimePickerField onChange={setScheduledAt} valueIso={scheduledAt} />
      <View style={styles.dualActions}>
        <Pressable disabled={busy} onPress={() => setOpen(false)} style={[styles.smallAction, styles.smallActionGhost]}>
          <Text style={styles.smallActionGhostText}>Cancel</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => {
            onSave({ location: location.trim() || undefined, scheduledAt });
            setOpen(false);
          }}
          style={[styles.smallAction, styles.smallActionPrimary]}>
          <Text style={styles.smallActionPrimaryText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

// Lets the customer record how they're paying — through the app (commission
// auto-deducted from the worker at completion) or directly to the worker in
// cash/mobile money (a transaction code is kept as a record of it, and the
// worker remits HandyHub's 10% separately).
function PaymentMethodPicker({ job, busy, onRecord }: {
  job: Job;
  busy: boolean;
  onRecord: (method: JobPaymentMethod, transactionCode?: string) => void;
}) {
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [code, setCode] = useState('');

  if (job.paymentMethod) {
    return (
      <View style={styles.paymentInfoRow}>
        <Ionicons color={C.teal} name={job.paymentMethod === 'in_app' ? 'phone-portrait-outline' : 'cash-outline'} size={13} />
        <Text style={styles.paymentInfoText}>
          {job.paymentMethod === 'in_app'
            ? 'Paying via app — 10% commission auto-deducted'
            : `Paying the pro directly · Code: ${job.transactionCode}`}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.paymentPickerWrap}>
      <Text style={styles.paymentPickerLabel}>How are you paying?</Text>
      {!showCodeInput ? (
        <View style={styles.dualActions}>
          <Pressable disabled={busy} onPress={() => onRecord('in_app')} style={[styles.smallAction, styles.smallActionPrimary]}>
            <Text style={styles.smallActionPrimaryText}>Pay via app</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => setShowCodeInput(true)} style={[styles.smallAction, styles.smallActionGhost]}>
            <Text style={styles.smallActionGhostText}>Pay pro directly</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.counterRow}>
          <TextInput
            editable={!busy}
            onChangeText={setCode}
            placeholder="Transaction code (e.g. M-Pesa)"
            placeholderTextColor={C.muted}
            style={styles.counterInput}
            value={code}
          />
          <Pressable
            disabled={busy || !code.trim()}
            onPress={() => { onRecord('direct', code.trim()); setCode(''); setShowCodeInput(false); }}
            style={[styles.smallAction, styles.smallActionPrimary, styles.counterButton]}>
            <Text style={styles.smallActionPrimaryText}>Confirm</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function CustomerJobCard({ job, busy, onAccept, onCounter, onEdit, onConfirmSchedule, onRate, onRecordPayment }: {
  job: Job;
  busy: boolean;
  onAccept: (job: Job) => void;
  onCounter: (job: Job, amount: number) => void;
  onEdit: (job: Job, updates: { location?: string; scheduledAt?: string }) => void;
  onConfirmSchedule: (job: Job) => void;
  onRate: (job: Job, rating: number) => void;
  onRecordPayment: (job: Job, method: JobPaymentMethod, transactionCode?: string) => void;
}) {
  const [counterValue, setCounterValue] = useState('');
  const proCountered = job.status === 'negotiating' && job.offerBy === 'worker';
  const displayPrice = job.finalPrice ?? job.currentOffer ?? job.listedPrice;

  const statusText =
    job.status === 'open' ? 'Finding a pro'
      : job.status === 'negotiating' ? (proCountered ? 'Pro countered' : 'Waiting for pro')
        : job.status === 'accepted' ? 'Accepted'
          : job.status === 'in_progress' ? 'In progress'
            : job.status === 'completed' ? 'Completed'
              : 'Cancelled';
  const tone: 'orange' | 'blue' | 'green' =
    job.status === 'completed' ? 'green' : job.status === 'accepted' || job.status === 'in_progress' ? 'orange' : 'blue';

  const showPriceRow = job.status === 'in_progress' || job.status === 'completed';

  return (
    <OrderBase
      date={showPriceRow ? (job.status === 'in_progress' ? 'Today' : 'Done') : undefined}
      price={showPriceRow && displayPrice !== undefined ? `KSh ${displayPrice}${job.payType === 'hourly' ? '/hr' : ''}` : undefined}
      professional={job.workerName ?? 'Not yet matched'}
      service={job.service}
      status={statusText}
      tone={tone}>
      {job.scheduledAt && (
        <View style={styles.scheduleRow}>
          <Ionicons color={C.muted} name="calendar-outline" size={12} />
          <Text style={styles.scheduleText}>{formatScheduled(job.scheduledAt)}</Text>
        </View>
      )}

      {job.status === 'open' && (
        <Text style={styles.ticketHint}>Posted — waiting for a matching pro to respond.</Text>
      )}

      {job.status === 'negotiating' && (
        <View style={styles.offerThread}>
          <View style={proCountered ? styles.offerTheirs : styles.offerMine}>
            <Text style={proCountered ? styles.offerWhoRed : styles.offerWho}>
              {proCountered ? `${job.workerName ?? 'The pro'} offered` : 'You offered'}
            </Text>
            <Text style={styles.offerAmount}>KSh {job.currentOffer}</Text>
          </View>
          {proCountered ? (
            <>
              <View style={styles.dualActions}>
                <Pressable
                  disabled={busy}
                  onPress={() => onAccept(job)}
                  style={[styles.smallAction, styles.smallActionPrimary]}>
                  <Text style={styles.smallActionPrimaryText}>Accept KSh {job.currentOffer}</Text>
                </Pressable>
              </View>
              <View style={styles.counterRow}>
                <TextInput
                  editable={!busy}
                  keyboardType="number-pad"
                  onChangeText={setCounterValue}
                  placeholder="Your counter (KSh)"
                  placeholderTextColor={C.muted}
                  style={styles.counterInput}
                  value={counterValue}
                />
                <Pressable
                  disabled={busy || !Number(counterValue)}
                  onPress={() => { onCounter(job, Number(counterValue)); setCounterValue(''); }}
                  style={[styles.smallAction, styles.smallActionGhost, styles.counterButton]}>
                  <Text style={styles.smallActionGhostText}>
                    {Number(counterValue) === job.currentOffer ? 'Accept' : 'Counter'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <Text style={styles.ticketHint}>Waiting for {job.workerName ?? 'the pro'} to respond.</Text>
          )}
        </View>
      )}

      {job.status === 'accepted' && (
        <Text style={styles.successLine}>Price agreed at KSh {job.finalPrice}. Waiting for the pro to start.</Text>
      )}

      {(job.status === 'accepted' || job.status === 'in_progress') && (
        <PaymentMethodPicker
          busy={busy}
          job={job}
          onRecord={(method, code) => onRecordPayment(job, method, code)}
        />
      )}

      {job.status === 'in_progress' && job.completionCode && (
        <View style={styles.completionTicket}>
          <View>
            <Text style={styles.ticketLabel}>Completion code</Text>
            <Text style={styles.ticketCode}>{job.completionCode.split('').join('  ')}</Text>
          </View>
          <Text style={styles.ticketHint}>Share only once the job{'\n'}is done</Text>
        </View>
      )}

      {(job.status === 'accepted' || job.status === 'in_progress') && job.scheduleSetBy === 'worker' && !job.scheduleConfirmed && (
        <View style={styles.rescheduleNote}>
          <Ionicons color="#3D57C4" name="calendar" size={14} />
          <Text style={styles.rescheduleText}>
            {job.workerName ?? 'The pro'} proposed a new time —{' '}
            <Text style={styles.bold}>{job.scheduledAt ? formatScheduled(job.scheduledAt) : 'see details'}</Text>.
          </Text>
        </View>
      )}
      {(job.status === 'accepted' || job.status === 'in_progress') && job.scheduleSetBy === 'worker' && !job.scheduleConfirmed && (
        <View style={styles.dualActions}>
          <Pressable disabled={busy} onPress={() => onConfirmSchedule(job)} style={[styles.smallAction, styles.smallActionPrimary]}>
            <Text style={styles.smallActionPrimaryText}>Confirm new time</Text>
          </Pressable>
        </View>
      )}

      {job.status === 'completed' && (
        <View style={styles.ratingRow}>
          <Text style={styles.ratingPrompt}>{job.rating ? 'You rated this job' : 'How was the job?'}</Text>
          <View style={styles.ratingStars}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Pressable disabled={busy || !!job.rating} key={star} onPress={() => onRate(job, star)}>
                <Text style={styles.ratingStar}>{job.rating && star <= job.rating ? '★' : '☆'}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <CounterpartCall job={job} name={job.workerName ?? 'the pro'} />
      <JobDetailsEditor busy={busy} job={job} onSave={(updates) => onEdit(job, updates)} />
    </OrderBase>
  );
}

function OrdersScreen({ userId, refreshKey }: { userId: string; refreshKey: number }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => fetchCustomerJobs(userId), [userId]);

  // Poll so a price change or accept from the worker's side (or a new match
  // on an open job) shows up here without the customer having to pull-to-refresh.
  useEffect(() => {
    let cancelled = false;
    function poll() {
      load()
        .then((data) => { if (!cancelled) { setJobs(data); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your jobs.'); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    }
    poll();
    const interval = setInterval(poll, JOB_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [load, refreshKey]);

  async function refresh() {
    setJobs(await load());
    setError(null);
  }

  async function onRefresh() {
    setIsRefreshing(true);
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your jobs.');
    }
    setIsRefreshing(false);
  }

  async function handleAccept(job: Job) {
    if (job.currentOffer === undefined) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBusyJobId(job.id);
    try {
      await acceptOffer(job.id, job.currentOffer);
      await refresh();
    } catch (err) {
      Alert.alert('Could not accept', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleCounter(job: Job, amount: number) {
    // Typing back the price already on the table isn't a counter — it's an
    // agreement. Accept outright instead of bouncing the same number back.
    const matchesCurrentOffer = job.currentOffer !== undefined && amount === job.currentOffer;
    Haptics.impactAsync(matchesCurrentOffer ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
    setBusyJobId(job.id);
    try {
      if (matchesCurrentOffer) await acceptOffer(job.id, amount);
      else await counterOffer(job.id, amount, 'customer');
      await refresh();
    } catch (err) {
      Alert.alert('Could not send counter-offer', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleEdit(job: Job, updates: { location?: string; scheduledAt?: string }) {
    setBusyJobId(job.id);
    try {
      await updateJobDetails(job.id, updates);
      await refresh();
    } catch (err) {
      Alert.alert('Could not save changes', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleConfirmSchedule(job: Job) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBusyJobId(job.id);
    try {
      await confirmSchedule(job.id);
      await refresh();
    } catch (err) {
      Alert.alert('Could not confirm', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleRate(job: Job, value: number) {
    Haptics.selectionAsync();
    setBusyJobId(job.id);
    try {
      await rateJob(job.id, value);
      await refresh();
    } catch (err) {
      Alert.alert('Could not save rating', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleRecordPayment(job: Job, method: JobPaymentMethod, transactionCode?: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusyJobId(job.id);
    try {
      await recordPayment(job.id, method, transactionCode);
      await refresh();
    } catch (err) {
      Alert.alert('Could not save payment method', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  const liveJobs = jobs.filter((job) => job.status !== 'cancelled');
  const awaitingJobs = liveJobs.filter((job) => job.status === 'open' || job.status === 'negotiating');
  const activeJobs = liveJobs.filter((job) => job.status === 'accepted' || job.status === 'in_progress');
  const completedJobs = liveJobs.filter((job) => job.status === 'completed');

  function jobCard(job: Job) {
    return (
      <CustomerJobCard
        busy={busyJobId === job.id}
        job={job}
        key={job.id}
        onAccept={handleAccept}
        onConfirmSchedule={handleConfirmSchedule}
        onCounter={handleCounter}
        onEdit={handleEdit}
        onRate={handleRate}
        onRecordPayment={handleRecordPayment}
      />
    );
  }

  return (
    <View style={styles.screenContent}>
      <SimpleHeader title="My Orders" />
      <ScrollView
        contentContainerStyle={styles.ordersScroll}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} tintColor={C.brand} />}
        showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <ActivityIndicator color={C.brand} style={styles.ordersLoading} />
        ) : (
          <>
            {error && (
              <View style={styles.errorRow}>
                <Ionicons color={C.brand} name="alert-circle" size={14} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {liveJobs.length === 0 ? (
              <EmptyState
                icon="orders"
                text="Book a pro or post a job from Home to see it tracked here."
                title="No orders yet"
              />
            ) : (
              <>
                {awaitingJobs.length > 0 && (
                  <>
                    <Text style={styles.ordersSection}>Awaiting agreement</Text>
                    {awaitingJobs.map(jobCard)}
                  </>
                )}

                {activeJobs.length > 0 && (
                  <>
                    <Text style={styles.ordersSection}>Active</Text>
                    {activeJobs.map(jobCard)}
                  </>
                )}

                {completedJobs.length > 0 && (
                  <>
                    <Text style={styles.ordersSection}>Completed</Text>
                    {completedJobs.map(jobCard)}
                  </>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const initialTransactions = [
  { name: 'M-Pesa top up', date: 'Today, 9:12 AM', amount: '+2,000', positive: true },
  { name: 'Kitchen sink repair', date: 'Today, 2:30 PM', amount: '−1,600', positive: false },
  { name: 'Wardrobe assembly', date: '12 Aug', amount: '−2,100', positive: false },
  { name: 'M-Pesa top up', date: '2 Aug', amount: '+5,000', positive: true },
];

function WalletScreen({ userId }: { userId: string }) {
  const [balance, setBalance] = useState(4250);
  const [transactions, setTransactions] = useState(initialTransactions);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoadingPayments, setIsLoadingPayments] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchCustomerJobs(userId)
      .then((data) => { if (!cancelled) setJobs(data); })
      .catch(() => {
        // Best-effort — the wallet screen still renders fine without this breakdown.
      })
      .finally(() => { if (!cancelled) setIsLoadingPayments(false); });
    return () => { cancelled = true; };
  }, [userId]);

  const paidViaApp = jobs
    .filter((job) => job.paymentMethod === 'in_app')
    .reduce((sum, job) => sum + (job.finalPrice ?? job.listedPrice ?? job.currentOffer ?? 0), 0);
  const paidDirect = jobs
    .filter((job) => job.paymentMethod === 'direct')
    .reduce((sum, job) => sum + (job.finalPrice ?? job.listedPrice ?? job.currentOffer ?? 0), 0);

  function topUp() {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBalance((current) => current + 1000);
    setTransactions((current) => [{ name: 'M-Pesa top up', date: 'Just now', amount: '+1,000', positive: true }, ...current]);
  }

  function withdraw() {
    if (!balance) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTransactions((current) => [{ name: 'Wallet withdrawal', date: 'Just now', amount: `−${balance.toLocaleString()}`, positive: false }, ...current]);
    setBalance(0);
  }

  return (
    <View style={styles.screenContent}>
      <SimpleHeader title="Wallet" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.walletScroll}>
        <View style={styles.balanceCard}>
          <View style={styles.balanceOrb} />
          <Text style={styles.balanceLabel}>Available balance</Text>
          <Text style={styles.balanceAmount}>KSh {balance.toLocaleString()}</Text>
          <View style={styles.walletActions}>
            <Pressable onPress={topUp} style={[styles.walletButton, styles.topUpButton]}><Text style={styles.topUpText}>+ Top Up</Text></Pressable>
            <Pressable onPress={withdraw} style={[styles.walletButton, styles.withdrawButton]}><Text style={styles.withdrawText}>Withdraw</Text></Pressable>
          </View>
        </View>

        <Text style={styles.ordersSection}>How you&apos;ve paid</Text>
        {isLoadingPayments ? (
          <ActivityIndicator color={C.brand} style={styles.ordersLoading} />
        ) : (
          <View style={styles.paymentSplitRow}>
            <View style={styles.paymentSplitCard}>
              <Text style={styles.paymentSplitLabel}>Paid via app</Text>
              <Text style={styles.paymentSplitAmount}>KSh {paidViaApp.toLocaleString()}</Text>
              <Text style={styles.paymentSplitSub}>Commission auto-deducted</Text>
            </View>
            <View style={styles.paymentSplitCard}>
              <Text style={styles.paymentSplitLabel}>Paid directly</Text>
              <Text style={styles.paymentSplitAmount}>KSh {paidDirect.toLocaleString()}</Text>
              <Text style={styles.paymentSplitSub}>Cash / mobile money to pro</Text>
            </View>
          </View>
        )}

        <Text style={styles.ordersSection}>Recent transactions</Text>
        {transactions.map((transaction, index) => (
          <View style={styles.transactionRow} key={`${transaction.name}-${transaction.date}-${index}`}>
            <View style={[styles.transactionIcon, { backgroundColor: transaction.positive ? '#E7F3F0' : '#FBE9EA' }]}>
              <Icon name={transaction.positive ? 'arrowUp' : 'arrowDown'} color={transaction.positive ? C.teal : '#E84A67'} size={15} />
            </View>
            <View style={styles.transactionInfo}><Text style={styles.transactionName}>{transaction.name}</Text><Text style={styles.transactionDate}>{transaction.date}</Text></View>
            <Text style={[styles.transactionAmount, transaction.positive && styles.transactionPositive]}>{transaction.amount}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const conversations = [
  { name: 'James Mwangi', image: 'https://i.pravatar.cc/100?img=13', preview: "I'll be there in 15 minutes, traffic is light", time: '2:14 PM', unread: true },
  { name: 'Grace Wanjiru', image: 'https://i.pravatar.cc/100?img=32', preview: 'Sure, tomorrow 10am works well for me', time: 'Yesterday' },
  { name: 'Peter Otieno', image: 'https://i.pravatar.cc/100?img=51', preview: "Job's done, thank you for having me!", time: '12 Aug' },
  { name: 'Mary Achieng', image: 'https://i.pravatar.cc/100?img=45', preview: 'Thank you, see you next time 😊', time: '3 Aug' },
];

function MessagesScreen() {
  const [read, setRead] = useState<string[]>([]);
  return (
    <View style={styles.screenContent}>
      <SimpleHeader title="Messages" />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.messagesScroll}>
        {conversations.map((conversation) => {
          const unread = conversation.unread && !read.includes(conversation.name);
          return (
            <Pressable key={conversation.name} onPress={() => setRead((items) => [...items, conversation.name])} style={styles.messageRow}>
              <View><Image source={conversation.image} contentFit="cover" style={styles.messageAvatar} />{unread && <View style={styles.messageUnread} />}</View>
              <View style={styles.messageContent}><Text style={styles.messageName}>{conversation.name}</Text><Text numberOfLines={1} style={styles.messagePreview}>{conversation.preview}</Text></View>
              <Text style={styles.messageTime}>{conversation.time}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function CustomerScreen({ tab, userId, jobsRefreshKey, onBook, onPostJob, name, onSignOut }: {
  tab: CustomerTab;
  userId: string;
  jobsRefreshKey: number;
  onBook: (pro: Professional) => void;
  onPostJob: () => void;
  name: string;
  onSignOut: () => void;
}) {
  if (tab === 'home') return <CustomerHome name={name} onBook={onBook} onPostJob={onPostJob} onSignOut={onSignOut} />;
  if (tab === 'orders') return <OrdersScreen refreshKey={jobsRefreshKey} userId={userId} />;
  if (tab === 'wallet') return <WalletScreen userId={userId} />;
  return <MessagesScreen />;
}

function SimpleHeader({ title, onSignOut, right }: { title: string; onSignOut?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.simpleHeader}>
      <Text style={styles.simpleHeaderTitle}>{title}</Text>
      <View style={styles.simpleHeaderActions}>
        {right}
        {onSignOut && (
          <Pressable onPress={onSignOut} style={styles.headerButton}>
            <Icon name="person" color="#FFFFFF" size={14} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const WORKER_STATUS_ORDER: JobStatus[] = ['negotiating', 'open', 'accepted', 'in_progress', 'completed'];
const WORKER_STATUS_LABEL: Record<JobStatus, string> = {
  open: 'New requests',
  negotiating: 'Negotiating',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const WORKER_STATUS_BADGE: Record<JobStatus, 'upcoming' | 'live' | 'done'> = {
  open: 'upcoming',
  negotiating: 'upcoming',
  accepted: 'live',
  in_progress: 'live',
  completed: 'done',
  cancelled: 'done',
};

function WorkerJobCard({ job, busy, onAccept, onCounter, onStart, onComplete, onEdit }: {
  job: Job;
  busy: boolean;
  onAccept: (job: Job) => void;
  onCounter: (job: Job, amount: number) => void;
  onStart: (job: Job) => void;
  onComplete: (job: Job, code: string) => void;
  onEdit: (job: Job, updates: { location?: string; scheduledAt?: string }) => void;
}) {
  const [counterValue, setCounterValue] = useState('');
  const [codeValue, setCodeValue] = useState('');

  const myTurn = job.status === 'open' || (job.status === 'negotiating' && job.offerBy === 'customer');
  const price = job.finalPrice ?? job.currentOffer ?? job.listedPrice;
  const badge = WORKER_STATUS_BADGE[job.status];

  return (
    <View style={styles.jobCard}>
      <View style={styles.jobTop}>
        <View style={styles.jobInfo}>
          <Text style={styles.jobService}>{job.service}</Text>
          <Text style={styles.jobCustomer}>
            Customer: {job.customerName ?? 'Unknown'}{job.location ? ` · ${job.location}` : ''}
            {job.scheduledAt ? ` · ${formatScheduled(job.scheduledAt)}` : ''}
          </Text>
        </View>
        <View style={[styles.jobBadge, styles[`jobBadge_${badge}`]]}>
          <Text style={[styles.jobBadgeText, styles[`jobBadgeText_${badge}`]]}>
            {job.status === 'negotiating' ? (myTurn ? 'Your turn' : 'Waiting on customer') : WORKER_STATUS_LABEL[job.status]}
          </Text>
        </View>
      </View>
      <View style={styles.jobDivider} />
      <View style={styles.jobFoot}>
        <View style={styles.jobFootLeft}>
          <View style={styles.jobPayTypePill}>
            <Text style={styles.jobPayTypeText}>{job.payType === 'hourly' ? 'Per hour' : 'Per task'}</Text>
          </View>
        </View>
        {price !== undefined && <Text style={styles.jobPrice}>KSh {price}</Text>}
      </View>

      {myTurn && (
        <>
          <View style={styles.dualActions}>
            <Pressable disabled={busy} onPress={() => onAccept(job)} style={[styles.smallAction, styles.smallActionPrimary]}>
              <Text style={styles.smallActionPrimaryText}>Accept KSh {price}</Text>
            </Pressable>
          </View>
          <View style={styles.counterRow}>
            <TextInput
              editable={!busy}
              keyboardType="number-pad"
              onChangeText={setCounterValue}
              placeholder="Your counter (KSh)"
              placeholderTextColor={C.muted}
              style={styles.counterInput}
              value={counterValue}
            />
            <Pressable
              disabled={busy || !Number(counterValue)}
              onPress={() => { onCounter(job, Number(counterValue)); setCounterValue(''); }}
              style={[styles.smallAction, styles.smallActionGhost, styles.counterButton]}>
              <Text style={styles.smallActionGhostText}>
                {Number(counterValue) === price ? 'Accept' : 'Counter'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {job.status === 'negotiating' && !myTurn && (
        <Text style={styles.ticketHint}>Waiting for {job.customerName ?? 'the customer'} to respond.</Text>
      )}

      {job.paymentMethod && (job.status === 'accepted' || job.status === 'in_progress') && (
        <View style={styles.paymentInfoRow}>
          <Ionicons color={C.teal} name={job.paymentMethod === 'in_app' ? 'phone-portrait-outline' : 'cash-outline'} size={13} />
          <Text style={styles.paymentInfoText}>
            {job.paymentMethod === 'in_app'
              ? 'Customer paying via app — commission auto-deducted'
              : 'Customer paying you directly — remember to remit 10%'}
          </Text>
        </View>
      )}

      {job.status === 'accepted' && (
        <Pressable
          disabled={busy}
          onPress={() => onStart(job)}
          style={({ pressed }) => [styles.jobAction, pressed && styles.pressed]}>
          <Text style={styles.jobActionText}>Start Job</Text>
        </Pressable>
      )}

      {job.status === 'in_progress' && (
        job.paymentMethod ? (
          <View style={styles.counterRow}>
            <TextInput
              editable={!busy}
              keyboardType="number-pad"
              maxLength={4}
              onChangeText={setCodeValue}
              placeholder="Completion code from customer"
              placeholderTextColor={C.muted}
              style={styles.counterInput}
              value={codeValue}
            />
            <Pressable
              disabled={busy || codeValue.length !== 4}
              onPress={() => onComplete(job, codeValue)}
              style={[styles.smallAction, styles.smallActionPrimary, styles.counterButton]}>
              <Text style={styles.smallActionPrimaryText}>Complete</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={styles.ticketHint}>Waiting for the customer to record payment before you can complete this job.</Text>
        )
      )}

      {(job.status === 'accepted' || job.status === 'in_progress') && job.scheduleSetBy === 'worker' && !job.scheduleConfirmed && (
        <Text style={styles.ticketHint}>Waiting for the customer to confirm the new time.</Text>
      )}

      <CounterpartCall job={job} name={job.customerName ?? 'the customer'} />
      {job.workerId && <JobDetailsEditor busy={busy} job={job} onSave={(updates) => onEdit(job, updates)} />}
    </View>
  );
}

function WorkerJobs({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => fetchWorkerJobs(), []);

  // Poll so a customer's counter-offer shows up here without the worker
  // having to pull-to-refresh.
  useEffect(() => {
    let cancelled = false;
    function poll() {
      load()
        .then((data) => { if (!cancelled) { setJobs(data); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your jobs.'); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    }
    poll();
    const interval = setInterval(poll, JOB_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [load]);

  async function refresh() {
    setJobs(await load());
    setError(null);
  }

  async function onRefresh() {
    setIsRefreshing(true);
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your jobs.');
    }
    setIsRefreshing(false);
  }

  async function handleAccept(job: Job) {
    if (!user) return;
    const price = job.currentOffer ?? job.listedPrice;
    if (price === undefined) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setBusyJobId(job.id);
    try {
      if (job.status === 'open') await claimJob(job.id, user.id);
      else await acceptOffer(job.id, price);
      await refresh();
    } catch (err) {
      Alert.alert('Could not accept', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleCounter(job: Job, amount: number) {
    if (!user) return;
    // Typing back the price already on the table isn't a counter — it's an
    // agreement. Accept/claim outright instead of bouncing the same number back.
    const price = job.currentOffer ?? job.listedPrice;
    const matchesCurrentOffer = price !== undefined && amount === price;
    Haptics.impactAsync(matchesCurrentOffer ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium);
    setBusyJobId(job.id);
    try {
      if (job.status === 'open') await claimJob(job.id, user.id, matchesCurrentOffer ? undefined : amount);
      else if (matchesCurrentOffer) await acceptOffer(job.id, amount);
      else await counterOffer(job.id, amount, 'worker');
      await refresh();
    } catch (err) {
      Alert.alert('Could not send counter-offer', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleStart(job: Job) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusyJobId(job.id);
    try {
      await startJob(job.id);
      await refresh();
    } catch (err) {
      Alert.alert('Could not start job', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  async function handleComplete(job: Job, code: string) {
    setBusyJobId(job.id);
    try {
      await completeJobWithCode(job.id, code);
      await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could not complete job', err instanceof Error ? err.message : 'Check the code and try again.');
    }
    setBusyJobId(null);
  }

  async function handleEdit(job: Job, updates: { location?: string; scheduledAt?: string }) {
    setBusyJobId(job.id);
    try {
      await updateJobDetails(job.id, updates);
      await refresh();
    } catch (err) {
      Alert.alert('Could not save changes', err instanceof Error ? err.message : 'Please try again.');
    }
    setBusyJobId(null);
  }

  const sections = WORKER_STATUS_ORDER
    .map((status) => ({ status, items: jobs.filter((job) => job.status === status) }))
    .filter((section) => section.items.length > 0);

  return (
    <View style={styles.screenContent}>
      <SimpleHeader onSignOut={onSignOut} right={<NotificationBell />} title="Today's Jobs" />
      <ScrollView
        contentContainerStyle={styles.workerScroll}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} tintColor={C.brand} />}
        showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <ActivityIndicator color={C.brand} style={styles.ordersLoading} />
        ) : sections.length === 0 ? (
          <EmptyState
            icon="orders"
            text="Add a skill on your profile to start seeing matching jobs here."
            title="No jobs match your skills yet"
          />
        ) : (
          sections.map(({ status, items }) => (
            <View key={status}>
              <Text style={styles.workerSectionTitle}>{WORKER_STATUS_LABEL[status]}</Text>
              {items.map((job) => (
                <WorkerJobCard
                  busy={busyJobId === job.id}
                  job={job}
                  key={job.id}
                  onAccept={handleAccept}
                  onComplete={handleComplete}
                  onCounter={handleCounter}
                  onEdit={handleEdit}
                  onStart={handleStart}
                />
              ))}
            </View>
          ))
        )}
        {error && (
          <View style={styles.errorRow}>
            <Ionicons color={C.brand} name="alert-circle" size={14} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function SettlementCard({ title, description, note, positive }: {
  title: string;
  description: string;
  note: string;
  positive: boolean;
}) {
  return (
    <View style={styles.settlementCard}>
      <Text style={styles.settlementTitle}>{title}</Text>
      <Text style={styles.settlementDescription}>{description}</Text>
      <View style={styles.settlementFoot}>
        <Text style={styles.settlementHint}>{positive ? 'Our fee is deducted automatically' : "Our fee isn't deducted automatically"}</Text>
        <Text style={[styles.settlementNote, positive ? styles.settlementPositive : styles.settlementWarning]}>{note}</Text>
      </View>
    </View>
  );
}

function WorkerEarnings() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isRemitting, setIsRemitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => fetchWorkerJobs(), []);

  // Poll so a job someone else just completed (or a remit that landed from
  // another device) shows up here without pulling to refresh.
  useEffect(() => {
    let cancelled = false;
    function poll() {
      load()
        .then((data) => { if (!cancelled) { setJobs(data); setError(null); } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your earnings.'); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    }
    poll();
    const interval = setInterval(poll, JOB_POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [load]);

  async function refresh() {
    setJobs(await load());
    setError(null);
  }

  async function onRefresh() {
    setIsRefreshing(true);
    try {
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your earnings.');
    }
    setIsRefreshing(false);
  }

  const completedJobs = jobs.filter((job) => job.status === 'completed' && job.finalPrice !== undefined);
  const pendingRemit = completedJobs.filter((job) => !job.remitted && (job.commission ?? 0) > 0);
  const remittedJobs = completedJobs
    .filter((job) => job.remitted && (job.commission ?? 0) > 0)
    .sort((a, b) => (b.remittedAt ?? '').localeCompare(a.remittedAt ?? ''));

  const totalEarned = completedJobs.reduce((sum, job) => sum + (job.finalPrice ?? 0) - (job.commission ?? 0), 0);
  const remittanceDue = pendingRemit.reduce((sum, job) => sum + (job.commission ?? 0), 0);

  const paidViaApp = jobs
    .filter((job) => job.paymentMethod === 'in_app')
    .reduce((sum, job) => sum + (job.finalPrice ?? job.listedPrice ?? job.currentOffer ?? 0), 0);
  const paidDirect = jobs
    .filter((job) => job.paymentMethod === 'direct')
    .reduce((sum, job) => sum + (job.finalPrice ?? job.listedPrice ?? job.currentOffer ?? 0), 0);

  async function remitAll() {
    if (pendingRemit.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsRemitting(true);
    try {
      for (const job of pendingRemit) {
        await remitJob(job.id);
      }
      await refresh();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert('Could not remit', err instanceof Error ? err.message : 'Please try again.');
    }
    setIsRemitting(false);
  }

  function withdraw() {
    Haptics.selectionAsync();
    Alert.alert('Withdrawals coming soon', 'Payouts to M-Pesa aren’t available yet — check back soon.');
  }

  return (
    <View style={styles.screenContent}>
      <SimpleHeader title="Earnings" />
      <ScrollView
        contentContainerStyle={styles.earningsScroll}
        refreshControl={<RefreshControl onRefresh={onRefresh} refreshing={isRefreshing} tintColor={C.brand} />}
        showsVerticalScrollIndicator={false}>
        {isLoading ? (
          <ActivityIndicator color={C.brand} style={styles.ordersLoading} />
        ) : (
          <>
            <View style={styles.balanceCard}>
              <View style={styles.balanceOrb} />
              <Text style={styles.balanceLabel}>Available balance · after HandyHub&apos;s 10% cut</Text>
              <Text style={styles.balanceAmount}>KSh {totalEarned.toLocaleString()}</Text>
              <Pressable onPress={withdraw} style={styles.earningsWithdraw}>
                <Text style={styles.topUpText}>Withdraw</Text>
              </Pressable>
            </View>

            {remittanceDue > 0 ? (
              <View style={styles.remittanceAlert}>
                <View style={styles.remittanceTitleRow}>
                  <Icon name="alert" color="#B70000" size={15} />
                  <Text style={styles.remittanceTitle}>KSh {remittanceDue.toLocaleString()} due for remittance</Text>
                </View>
                <Text style={styles.remittanceText}>
                  HandyHub takes a 10% commission on every completed job — separate from your balance above, owed by
                  you, not money you can spend. Remit it now the same way you&apos;d settle any other fee.
                </Text>
                <Pressable disabled={isRemitting} onPress={remitAll} style={styles.remitButton}>
                  <Text style={styles.remitButtonText}>{isRemitting ? 'Remitting…' : 'Remit Now'}</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.remittanceSuccess}>
                <Icon name="checkCircle" color={C.teal} size={17} />
                <View>
                  <Text style={styles.remittanceSuccessTitle}>All caught up</Text>
                  <Text style={styles.remittanceSuccessText}>No commission currently due.</Text>
                </View>
              </View>
            )}

            {error && (
              <View style={styles.errorRow}>
                <Ionicons color={C.brand} name="alert-circle" size={14} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Text style={styles.ordersSection}>How you&apos;ve been paid</Text>
            <View style={styles.paymentSplitRow}>
              <View style={styles.paymentSplitCard}>
                <Text style={styles.paymentSplitLabel}>Paid via app</Text>
                <Text style={styles.paymentSplitAmount}>KSh {paidViaApp.toLocaleString()}</Text>
                <Text style={styles.paymentSplitSub}>Commission auto-deducted</Text>
              </View>
              <View style={styles.paymentSplitCard}>
                <Text style={styles.paymentSplitLabel}>Paid directly</Text>
                <Text style={styles.paymentSplitAmount}>KSh {paidDirect.toLocaleString()}</Text>
                <Text style={styles.paymentSplitSub}>Cash / mobile money from customer</Text>
              </View>
            </View>

            <Text style={styles.ordersSection}>How your earnings work</Text>
            <SettlementCard title="Customer pays via app" description="HandyHub deducts its 10% automatically" note="Remitted instantly" positive />
            <SettlementCard title="Customer pays you directly" description="They give you a transaction code as proof" note="You remit the 10% yourself" positive={false} />

            <Text style={styles.ordersSection}>Remittance history</Text>
            {remittedJobs.length === 0 ? (
              <Text style={styles.emptyText}>Nothing remitted yet.</Text>
            ) : (
              remittedJobs.map((job) => (
                <View key={job.id} style={styles.transactionRow}>
                  <View style={[styles.transactionIcon, { backgroundColor: '#E7F3F0' }]}>
                    <Icon name="checkmark" color={C.teal} size={15} />
                  </View>
                  <View style={styles.transactionInfo}>
                    <Text style={styles.transactionName}>{job.service}</Text>
                    <Text style={styles.transactionDate}>
                      {job.paymentMethod === 'in_app' ? 'Auto-remitted · paid via app' : 'Remitted · paid directly'}
                      {job.remittedAt ? ` · ${formatScheduled(job.remittedAt)}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.transactionAmount}>−{job.commission?.toLocaleString()}</Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function VerificationBanner({ status, onVerify }: { status: IdVerificationStatus; onVerify: () => void }) {
  if (status === 'verified') return null;
  const copy =
    status === 'pending'
      ? { text: 'Your ID is under review — we’ll notify you once it’s verified.', showButton: false }
      : status === 'rejected'
        ? { text: 'Your ID verification was rejected. Please resubmit to unlock full access.', showButton: true }
        : { text: 'Verify your ID to unlock full access to jobs.', showButton: true };
  return (
    <View style={styles.verifyBanner}>
      <Icon name="alert" color={C.brand} size={15} />
      <Text style={styles.verifyBannerText}>{copy.text}</Text>
      {copy.showButton && (
        <Pressable onPress={onVerify} style={styles.verifyBannerButton}>
          <Text style={styles.verifyBannerButtonText}>Verify now</Text>
        </Pressable>
      )}
    </View>
  );
}

function WorkerScreen({ tab, onSignOut, verificationStatus, onVerify }: {
  tab: WorkerTab;
  onSignOut: () => void;
  verificationStatus: IdVerificationStatus;
  onVerify: () => void;
}) {
  return (
    <>
      <VerificationBanner onVerify={onVerify} status={verificationStatus} />
      {tab === 'jobs' ? (
        <WorkerJobs onSignOut={onSignOut} />
      ) : tab === 'earnings' ? (
        <WorkerEarnings />
      ) : tab === 'profile' ? (
        <WorkerProfileScreen />
      ) : (
        <MessagesScreen />
      )}
    </>
  );
}

const customerNav: { key: CustomerTab; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'orders', label: 'Orders', icon: 'orders' },
  { key: 'wallet', label: 'Wallet', icon: 'wallet' },
  { key: 'messages', label: 'Messages', icon: 'messages' },
];

const workerNav: { key: WorkerTab; label: string; icon: IconName }[] = [
  { key: 'jobs', label: 'Jobs', icon: 'orders' },
  { key: 'earnings', label: 'Earnings', icon: 'wallet' },
  { key: 'messages', label: 'Messages', icon: 'messages' },
  { key: 'profile', label: 'Profile', icon: 'person' },
];

function BottomNav({ mode, customerTab, workerTab, onCustomerTab, onWorkerTab }: {
  mode: Mode;
  customerTab: CustomerTab;
  workerTab: WorkerTab;
  onCustomerTab: (tab: CustomerTab) => void;
  onWorkerTab: (tab: WorkerTab) => void;
}) {
  const items = mode === 'customer' ? customerNav : workerNav;
  const active = mode === 'customer' ? customerTab : workerTab;
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const selected = item.key === active;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={item.key}
            onPress={() => mode === 'customer' ? onCustomerTab(item.key as CustomerTab) : onWorkerTab(item.key as WorkerTab)}
            style={styles.navItem}>
            <Icon name={item.icon} color={selected ? C.orange : C.muted} size={19} />
            <Text style={[styles.navLabel, selected && styles.navLabelActive]}>{item.label}</Text>
            <View style={[styles.navDot, selected && styles.navDotActive]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function BookingModal({ pro, onClose, onConfirm }: {
  pro: Professional | null;
  onClose: () => void;
  onConfirm: (category: string, offer: number, scheduledAt?: string) => void;
}) {
  const [offerAmount, setOfferAmount] = useState('');
  const [category, setCategory] = useState<string | undefined>(pro?.skills[0]);
  const [scheduledAt, setScheduledAt] = useState<string | undefined>(undefined);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={pro !== null}>
      <Pressable onPress={onClose} style={styles.modalBackdrop} />
      {pro && (
        <View style={styles.modalSheet}>
          <View style={styles.modalHandle} />
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.modalProRow}>
              <View style={styles.avatarInitials}>
                <Text style={styles.avatarInitialsText}>{pro.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.modalProInfo}>
                <Text style={styles.proName}>{pro.name}</Text>
                {(pro.ratingCount > 0 || pro.location) && (
                  <View style={styles.metaRow}>
                    {pro.ratingCount > 0 && (
                      <Text style={styles.rating}>★ {pro.ratingAverage.toFixed(1)} ({pro.ratingCount})</Text>
                    )}
                    {pro.location && <Text style={styles.meta}>{pro.ratingCount > 0 ? ` · ${pro.location}` : pro.location}</Text>}
                  </View>
                )}
              </View>
            </View>

            {pro.skills.length > 1 && (
              <>
                <Text style={[styles.modalLabel, styles.modalInputLabel]}>What do you need?</Text>
                <View style={styles.categoryPickerRow}>
                  {pro.skills.map((skill) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: category === skill }}
                      key={skill}
                      onPress={() => setCategory(skill)}
                      style={[styles.categoryPickerChip, category === skill && styles.categoryPickerChipActive]}>
                      <Text style={[styles.categoryPickerText, category === skill && styles.categoryPickerTextActive]}>{skill}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.modalLabel}>This pro quotes per job — send an offer to get started.</Text>

            <Text style={[styles.modalLabel, styles.modalInputLabel]}>Your offer (KSh)</Text>
            <TextInput
              keyboardType="number-pad"
              onChangeText={setOfferAmount}
              placeholder="e.g. 1500"
              placeholderTextColor={C.muted}
              style={styles.modalInput}
              value={offerAmount}
            />

            <Text style={[styles.modalLabel, styles.modalInputLabel]}>When (optional)</Text>
            <DateTimePickerField onChange={setScheduledAt} valueIso={scheduledAt} />

            <View style={styles.dualActions}>
              <Pressable
                disabled={!category || !Number(offerAmount)}
                onPress={() => category && onConfirm(category, Number(offerAmount), scheduledAt)}
                style={[styles.smallAction, styles.smallActionPrimary]}>
                <Text style={styles.smallActionPrimaryText}>Send Offer</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      )}
    </Modal>
  );
}

type PostJobParams = { category: string; service: string; offer: number; location?: string; scheduledAt?: string };

function PostJobModal({ visible, onClose, onConfirm }: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (params: PostJobParams) => void;
}) {
  const [category, setCategory] = useState<string>(SERVICE_CATEGORY_LABELS[0]);
  const [service, setService] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [location, setLocation] = useState('');
  const [scheduledAt, setScheduledAt] = useState<string | undefined>(undefined);

  const canSubmit = service.trim().length > 0 && Number(offerAmount) > 0;

  function submit() {
    if (!canSubmit) return;
    onConfirm({
      category,
      service: service.trim(),
      offer: Number(offerAmount),
      location: location.trim() || undefined,
      scheduledAt,
    });
    setCategory(SERVICE_CATEGORY_LABELS[0]);
    setService('');
    setOfferAmount('');
    setLocation('');
    setScheduledAt(undefined);
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <Pressable onPress={onClose} style={styles.modalBackdrop} />
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.postJobTitle}>Post a job</Text>
          <Text style={styles.modalLabel}>Any matching pro can pick this up and negotiate the price with you.</Text>

          <Text style={[styles.modalLabel, styles.modalInputLabel]}>Category</Text>
          <View style={styles.categoryPickerRow}>
            {SERVICE_CATEGORY_LABELS.map((label) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: category === label }}
                key={label}
                onPress={() => setCategory(label)}
                style={[styles.categoryPickerChip, category === label && styles.categoryPickerChipActive]}>
                <Text style={[styles.categoryPickerText, category === label && styles.categoryPickerTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={[styles.modalLabel, styles.modalInputLabel]}>What do you need done?</Text>
          <TextInput
            onChangeText={setService}
            placeholder="e.g. Fix a leaking kitchen tap"
            placeholderTextColor={C.muted}
            style={styles.modalInput}
            value={service}
          />

          <Text style={[styles.modalLabel, styles.modalInputLabel]}>Your offer (KSh)</Text>
          <TextInput
            keyboardType="number-pad"
            onChangeText={setOfferAmount}
            placeholder="e.g. 1500"
            placeholderTextColor={C.muted}
            style={styles.modalInput}
            value={offerAmount}
          />

          <Text style={[styles.modalLabel, styles.modalInputLabel]}>Location (optional)</Text>
          <TextInput
            onChangeText={setLocation}
            placeholder="e.g. Westlands, Nairobi"
            placeholderTextColor={C.muted}
            style={styles.modalInput}
            value={location}
          />

          <Text style={[styles.modalLabel, styles.modalInputLabel]}>When (optional)</Text>
          <DateTimePickerField onChange={setScheduledAt} valueIso={scheduledAt} />

          <View style={styles.dualActions}>
            <Pressable disabled={!canSubmit} onPress={submit} style={[styles.smallAction, styles.smallActionPrimary]}>
              <Text style={styles.smallActionPrimaryText}>Post Job</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function HomeScreen() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <SafeAreaView style={styles.splash} edges={['top', 'left', 'right', 'bottom']}>
        <ActivityIndicator color={C.accent} />
      </SafeAreaView>
    );
  }
  if (!user) return <LoginScreen />;
  if (user.role === 'agent') return user.agentActive ? <AgentScreen /> : <PendingApprovalScreen />;
  return <HandyHubApp key={user.id} role={user.role} user={user} />;
}

function HandyHubApp({ user, role }: { user: AuthUser; role: Mode }) {
  const { signOut } = useAuth();
  const [customerTab, setCustomerTab] = useState<CustomerTab>('home');
  const [workerTab, setWorkerTab] = useState<WorkerTab>('jobs');
  const [bookingTarget, setBookingTarget] = useState<Professional | null>(null);
  const [postJobModalVisible, setPostJobModalVisible] = useState(false);
  const [jobsRefreshKey, setJobsRefreshKey] = useState(0);
  const [isBooking, setIsBooking] = useState(false);
  const [showVerify, setShowVerify] = useState(role === 'worker' && user.idVerificationStatus === 'unverified');

  async function confirmBooking(category: string, offer: number, scheduledAt?: string) {
    if (!bookingTarget || isBooking) return;
    const pro = bookingTarget;
    setIsBooking(true);
    try {
      await postJob({
        customerId: user.id,
        workerId: pro.id,
        category,
        service: `${category} — booked via ${pro.name}`,
        payType: 'task',
        offer,
        scheduledAt,
      });
      setBookingTarget(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJobsRefreshKey((key) => key + 1);
      setCustomerTab('orders');
    } catch (err) {
      Alert.alert('Could not book this job', err instanceof Error ? err.message : 'Please try again.');
    }
    setIsBooking(false);
  }

  async function submitJobPost(params: PostJobParams) {
    if (isBooking) return;
    setIsBooking(true);
    try {
      await postJob({
        customerId: user.id,
        category: params.category,
        service: params.service,
        payType: 'task',
        offer: params.offer,
        location: params.location,
        scheduledAt: params.scheduledAt,
      });
      setPostJobModalVisible(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setJobsRefreshKey((key) => key + 1);
      setCustomerTab('orders');
    } catch (err) {
      Alert.alert('Could not post this job', err instanceof Error ? err.message : 'Please try again.');
    }
    setIsBooking(false);
  }

  if (showVerify) {
    return <VerifyIdentityScreen onDone={() => setShowVerify(false)} />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {role === 'customer' ? (
        <CustomerScreen
          jobsRefreshKey={jobsRefreshKey}
          name={user.name}
          onBook={setBookingTarget}
          onPostJob={() => setPostJobModalVisible(true)}
          onSignOut={signOut}
          tab={customerTab}
          userId={user.id}
        />
      ) : (
        <WorkerScreen
          onSignOut={signOut}
          onVerify={() => setShowVerify(true)}
          tab={workerTab}
          verificationStatus={user.idVerificationStatus}
        />
      )}
      <BottomNav
        mode={role}
        customerTab={customerTab}
        workerTab={workerTab}
        onCustomerTab={setCustomerTab}
        onWorkerTab={setWorkerTab}
      />
      <BookingModal key={bookingTarget?.id} onClose={() => setBookingTarget(null)} onConfirm={confirmBooking} pro={bookingTarget} />
      <PostJobModal onClose={() => setPostJobModalVisible(false)} onConfirm={submitJobPost} visible={postJobModalVisible} />
    </SafeAreaView>
  );
}

const shadow = {
  shadowColor: '#132043',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 10,
  elevation: 3,
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.ink },
  splash: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  screenContent: { flex: 1, backgroundColor: C.cream },
  postJobFab: { position: 'absolute', right: 20, bottom: 24, width: 54, height: 54, borderRadius: 27, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', ...shadow },
  verifyBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FBEFEC', paddingHorizontal: 16, paddingVertical: 10 },
  verifyBannerText: { flex: 1, color: C.ink, fontSize: 11.5, fontWeight: '600', lineHeight: 15 },
  verifyBannerButton: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.brand },
  verifyBannerButtonText: { color: '#FFFFFF', fontWeight: '700', fontSize: 10.5 },
  hero: { backgroundColor: C.ink, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, paddingHorizontal: 20, paddingTop: 9, paddingBottom: 17 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  brandNameRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandDiamond: { width: 10, height: 10, borderRadius: 3, backgroundColor: C.accent, transform: [{ rotate: '45deg' }] },
  brandName: { color: '#FFFFFF', fontWeight: '800', fontSize: 19, letterSpacing: -0.4 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: { width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  greeting: { fontSize: 11, color: '#AEB8DA', fontWeight: '500', marginBottom: 2 },
  headline: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.35, marginBottom: 14 },
  searchBar: { height: 45, flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 14, paddingHorizontal: 15 },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 13, paddingVertical: 0 },
  customerScroll: { paddingHorizontal: 18, paddingTop: 17, paddingBottom: 24 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: C.ink, marginBottom: 12 },
  sectionHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seeAll: { color: C.orange, fontWeight: '700', fontSize: 12, marginBottom: 12 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginBottom: 18 },
  categoryItem: { width: '25%', alignItems: 'center', gap: 6, marginBottom: 11 },
  categoryIcon: { width: 54, height: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', ...shadow },
  categoryLabel: { color: C.ink, fontWeight: '600', fontSize: 10.5, textAlign: 'center' },
  promo: { minHeight: 78, paddingHorizontal: 17, paddingVertical: 15, marginBottom: 22, borderRadius: 18, backgroundColor: C.orange, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
  promoTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  promoText: { color: '#FFFFFF', opacity: 0.92, maxWidth: 220, fontSize: 11.5, lineHeight: 16 },
  promoPercent: { color: 'rgba(255,255,255,0.38)', fontSize: 25, fontWeight: '800' },
  proCard: { backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10, ...shadow },
  pressed: { opacity: 0.76 },
  avatarWrap: { position: 'relative' },
  avatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 2.5, borderColor: C.teal },
  avatarGold: { borderColor: C.accent },
  avatarInitials: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FBEFEC', alignItems: 'center', justifyContent: 'center' },
  avatarInitialsText: { color: C.brand, fontWeight: '800', fontSize: 19 },
  verified: { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: C.card, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' },
  proInfo: { flex: 1, minWidth: 0 },
  proName: { color: C.ink, fontSize: 14, fontWeight: '800', marginBottom: 3 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  rating: { color: C.accent, fontWeight: '700', fontSize: 11.5 },
  meta: { color: C.muted, fontSize: 10.5 },
  tagRow: { flexDirection: 'row', gap: 4, marginTop: 5 },
  tag: { borderRadius: 20, backgroundColor: '#E7F3F0', paddingVertical: 3, paddingHorizontal: 8 },
  tagAlt: { backgroundColor: '#EFEAF9' },
  tagText: { color: C.teal, fontSize: 9, fontWeight: '700' },
  tagTextAlt: { color: C.purple },
  priceArea: { alignItems: 'flex-end', flexShrink: 0 },
  price: { color: C.ink, fontSize: 12.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  priceHint: { color: C.muted, fontSize: 9, lineHeight: 12, textAlign: 'right', marginTop: 2 },
  negotiateArea: { alignItems: 'flex-end', gap: 4 },
  negotiatePill: { backgroundColor: '#FBEFEC', borderRadius: 20, paddingVertical: 4, paddingHorizontal: 8 },
  negotiateText: { color: C.brand, fontSize: 8.5, fontWeight: '800' },
  quoteHint: { color: C.muted, fontSize: 8.5 },
  simpleHeader: { minHeight: 55, backgroundColor: C.ink2, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, paddingHorizontal: 19, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  simpleHeaderTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  simpleHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ordersScroll: { paddingHorizontal: 20, paddingTop: 3, paddingBottom: 26 },
  ordersLoading: { marginTop: 40 },
  ordersSection: { color: C.ink, fontWeight: '800', fontSize: 14, marginTop: 13, marginBottom: 10 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  errorText: { color: C.brand, fontSize: 11.5, fontWeight: '600', flex: 1 },
  counterRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  counterInput: { flex: 1, height: 39, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12, backgroundColor: C.cream, color: C.ink, fontSize: 12, outlineWidth: 0 },
  counterButton: { flex: 0, paddingHorizontal: 16 },
  callRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed' },
  callRowText: { color: C.teal, fontWeight: '700', fontSize: 11.5 },
  editDetailsLink: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', marginTop: 10 },
  editDetailsText: { color: C.muted, fontWeight: '700', fontSize: 11 },
  editDetailsWrap: { gap: 8, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed' },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
  scheduleText: { color: C.muted, fontWeight: '600', fontSize: 11 },
  paymentInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed' },
  paymentInfoText: { color: C.teal, fontWeight: '700', fontSize: 11 },
  paymentPickerWrap: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed' },
  paymentPickerLabel: { color: C.muted, fontWeight: '700', fontSize: 11, marginBottom: 8 },
  dateTimeTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12, backgroundColor: C.cream, marginTop: 7 },
  dateTimeTriggerText: { flex: 1, color: C.ink, fontWeight: '600', fontSize: 12 },
  calendarWrap: { marginTop: 8, padding: 10, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.cream, maxWidth: 240, alignSelf: 'center' },
  calendarHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  calendarHeaderText: { color: C.ink, fontWeight: '800', fontSize: 11.5 },
  calendarWeekRow: { flexDirection: 'row', marginBottom: 2 },
  calendarWeekday: { flex: 1, textAlign: 'center', color: C.muted, fontWeight: '700', fontSize: 9 },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calendarCellSelected: { backgroundColor: C.brand, borderRadius: 999 },
  calendarCellText: { color: C.ink, fontSize: 10.5, fontWeight: '600' },
  calendarCellTextDisabled: { color: C.line },
  calendarCellTextSelected: { color: '#FFFFFF', fontWeight: '800' },
  calendarTimeLabel: { color: C.muted, fontWeight: '700', fontSize: 10, marginTop: 8, marginBottom: 6 },
  timeSlotRow: { flexDirection: 'row', gap: 6 },
  timeSlotChip: { paddingVertical: 6, paddingHorizontal: 9, borderRadius: 9, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  timeSlotChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  timeSlotText: { color: C.muted, fontWeight: '700', fontSize: 10.5 },
  timeSlotTextActive: { color: '#FFFFFF' },
  orderCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 13, marginBottom: 9 },
  orderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  orderTitleWrap: { flex: 1 },
  orderService: { color: C.ink, fontWeight: '800', fontSize: 13 },
  orderWith: { color: C.muted, fontSize: 10.5, marginTop: 2 },
  statusPill: { borderRadius: 20, paddingVertical: 5, paddingHorizontal: 8, maxWidth: 100 },
  statusPillText: { fontWeight: '800', textTransform: 'uppercase', fontSize: 8, textAlign: 'center' },
  statusPill_orange: { backgroundColor: '#FFF0DA' },
  statusPillText_orange: { color: C.orange },
  statusPill_blue: { backgroundColor: '#E9EDFB' },
  statusPillText_blue: { color: '#3D57C4' },
  statusPill_green: { backgroundColor: '#E7F3F0' },
  statusPillText_green: { color: C.teal },
  orderMetaRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed', marginTop: 10, paddingTop: 9 },
  orderDate: { color: C.muted, fontSize: 10.5 },
  orderAmount: { color: C.ink, fontWeight: '800', fontSize: 11.5, fontVariant: ['tabular-nums'] },
  offerThread: { gap: 7, borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed', marginTop: 10, paddingTop: 10 },
  offerMine: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: C.cream, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  offerTheirs: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FBEFEC', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10 },
  offerWho: { color: C.muted, fontSize: 10.5, fontWeight: '600' },
  offerWhoRed: { color: C.brand, fontSize: 10.5, fontWeight: '700' },
  offerAmount: { color: C.ink, fontSize: 10.5, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dualActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallAction: { flex: 1, minHeight: 39, paddingHorizontal: 8, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  smallActionPrimary: { backgroundColor: C.teal },
  smallActionGhost: { backgroundColor: C.cream, borderWidth: 1, borderColor: C.line },
  smallActionPrimaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 10.5, textAlign: 'center' },
  smallActionGhostText: { color: C.ink, fontWeight: '800', fontSize: 10.5, textAlign: 'center' },
  successLine: { color: C.teal, fontWeight: '700', fontSize: 10.5, marginTop: 11, textAlign: 'center' },
  completionTicket: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, borderStyle: 'dashed', marginTop: 10, paddingTop: 10 },
  ticketLabel: { color: C.muted, fontSize: 8, textTransform: 'uppercase', fontWeight: '800', letterSpacing: 0.8, marginBottom: 4 },
  ticketCode: { color: C.brand, backgroundColor: '#FBEFEC', borderRadius: 7, paddingVertical: 5, paddingHorizontal: 9, fontWeight: '800', fontSize: 17, letterSpacing: 2 },
  ticketHint: { color: C.muted, fontSize: 8, lineHeight: 11, textAlign: 'right' },
  rescheduleNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#E9EDFB', padding: 10, borderRadius: 10, marginTop: 10 },
  rescheduleText: { color: C.ink, fontSize: 10.5, lineHeight: 15, flex: 1 },
  bold: { fontWeight: '800' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.line, marginTop: 10, paddingTop: 10 },
  ratingPrompt: { color: C.muted, fontSize: 10.5 },
  ratingStars: { flexDirection: 'row' },
  ratingStar: { color: C.accent, fontSize: 16, letterSpacing: 2 },
  walletScroll: { paddingHorizontal: 31, paddingTop: 15, paddingBottom: 26 },
  balanceCard: { minHeight: 145, overflow: 'hidden', backgroundColor: C.ink2, borderRadius: 20, padding: 20, marginBottom: 3 },
  balanceOrb: { position: 'absolute', width: 140, height: 140, borderRadius: 70, top: -65, right: -45, backgroundColor: 'rgba(242,169,59,0.12)' },
  balanceLabel: { color: '#AEB8DA', fontSize: 10.5, marginBottom: 6 },
  balanceAmount: { color: '#FFFFFF', fontSize: 27, fontWeight: '800', letterSpacing: 0.5, marginBottom: 17, fontVariant: ['tabular-nums'] },
  walletActions: { flexDirection: 'row', gap: 9 },
  walletButton: { flex: 1, borderRadius: 11, paddingVertical: 11, alignItems: 'center' },
  topUpButton: { backgroundColor: C.accent },
  withdrawButton: { backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  topUpText: { color: C.ink, fontSize: 11, fontWeight: '800' },
  withdrawText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  paymentSplitRow: { flexDirection: 'row', gap: 9, marginBottom: 4 },
  paymentSplitCard: { flex: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 12 },
  paymentSplitLabel: { color: C.muted, fontSize: 10, fontWeight: '700', marginBottom: 5 },
  paymentSplitAmount: { color: C.ink, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  paymentSplitSub: { color: C.muted, fontSize: 9, marginTop: 4 },
  transactionRow: { flexDirection: 'row', alignItems: 'center', gap: 11, minHeight: 58, borderBottomWidth: 1, borderBottomColor: C.line },
  transactionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  transactionInfo: { flex: 1 },
  transactionName: { color: C.ink, fontWeight: '700', fontSize: 11.5 },
  transactionDate: { color: C.muted, fontSize: 9.5, marginTop: 2 },
  transactionAmount: { color: C.ink, fontWeight: '800', fontSize: 11.5, fontVariant: ['tabular-nums'] },
  transactionPositive: { color: C.teal },
  messagesScroll: { paddingHorizontal: 19, paddingTop: 11, paddingBottom: 24 },
  messageRow: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  messageAvatar: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: C.line },
  messageUnread: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: C.orange, right: -1, top: -1, borderWidth: 1, borderColor: C.cream },
  messageContent: { flex: 1, minWidth: 0 },
  messageName: { color: C.ink, fontWeight: '800', fontSize: 12.5 },
  messagePreview: { color: C.muted, fontSize: 10.5, marginTop: 3 },
  messageTime: { color: C.muted, fontSize: 8.5, alignSelf: 'flex-start', marginTop: 13 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingBottom: 50 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginBottom: 14, borderWidth: 1, borderColor: C.line },
  emptyTitle: { color: C.ink, fontWeight: '800', fontSize: 18, marginBottom: 6 },
  emptyText: { color: C.muted, textAlign: 'center', fontSize: 12.5, lineHeight: 18 },
  workerScroll: { paddingHorizontal: 18, paddingTop: 0, paddingBottom: 22 },
  workerSectionTitle: { color: C.ink, fontWeight: '800', fontSize: 14, marginTop: 13, marginBottom: 9 },
  jobCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 13, marginBottom: 10 },
  jobTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  jobInfo: { flex: 1 },
  jobService: { color: C.ink, fontWeight: '800', fontSize: 13.5 },
  jobCustomer: { color: C.muted, fontSize: 10.5, marginTop: 2 },
  jobBadge: { borderRadius: 20, paddingVertical: 5, paddingHorizontal: 8, maxWidth: 80 },
  jobBadgeText: { fontSize: 8.5, fontWeight: '800', textTransform: 'uppercase', textAlign: 'center' },
  jobBadge_upcoming: { backgroundColor: '#E9EDFB' },
  jobBadgeText_upcoming: { color: '#3D57C4' },
  jobBadge_live: { backgroundColor: '#FFF0DA' },
  jobBadgeText_live: { color: C.orange },
  jobBadge_done: { backgroundColor: '#E7F3F0' },
  jobBadgeText_done: { color: C.teal },
  jobBadge_pending: { backgroundColor: '#FBEFEC' },
  jobBadgeText_pending: { color: C.brand },
  jobDivider: { height: 1, backgroundColor: C.line, marginTop: 10, marginBottom: 9 },
  jobFoot: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  jobFootLeft: { flex: 1, gap: 5 },
  jobMeta: { color: C.muted, fontSize: 10.5, flex: 1 },
  jobPayTypePill: { alignSelf: 'flex-start', backgroundColor: C.cream, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 7 },
  jobPayTypeText: { color: C.ink, fontSize: 9, fontWeight: '700' },
  jobPrice: { color: C.ink, fontSize: 11.5, fontWeight: '800', maxWidth: '45%', textAlign: 'right', fontVariant: ['tabular-nums'] },
  jobAction: { marginTop: 11, backgroundColor: C.brand, borderRadius: 11, paddingVertical: 11, alignItems: 'center' },
  jobActionText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  earningsScroll: { paddingHorizontal: 30, paddingTop: 15, paddingBottom: 28 },
  earningsWithdraw: { backgroundColor: C.accent, borderRadius: 11, paddingVertical: 11, alignItems: 'center' },
  remittanceAlert: { backgroundColor: '#FBEFEC', borderWidth: 1, borderColor: '#F1A89A', borderRadius: 16, padding: 14, marginTop: 16 },
  remittanceTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  remittanceTitle: { color: '#B70000', fontSize: 12, fontWeight: '800', flex: 1 },
  remittanceText: { color: '#8B3028', fontSize: 10.5, lineHeight: 15.5, marginBottom: 12 },
  remitButton: { backgroundColor: '#B70000', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  remitButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  remittanceSuccess: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E7F3F0', borderWidth: 1, borderColor: '#BEE0D6', borderRadius: 14, padding: 13, marginTop: 16 },
  remittanceSuccessTitle: { color: C.teal, fontWeight: '800', fontSize: 11.5 },
  remittanceSuccessText: { color: C.muted, fontSize: 9.5, marginTop: 2 },
  settlementCard: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 15, padding: 12, marginBottom: 9 },
  settlementTitle: { color: C.ink, fontSize: 11.5, fontWeight: '800' },
  settlementDescription: { color: C.muted, fontSize: 9.5, lineHeight: 13, marginTop: 2 },
  settlementFoot: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 9 },
  settlementHint: { color: C.muted, fontSize: 9, flex: 1 },
  settlementNote: { fontSize: 10, lineHeight: 12, fontWeight: '800', maxWidth: 92 },
  settlementPositive: { color: C.teal },
  settlementWarning: { color: '#B70000' },
  bottomNav: { backgroundColor: C.card, borderTopWidth: 1, borderTopColor: C.line, minHeight: 62, paddingTop: 9, paddingBottom: 5, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-around' },
  navItem: { flex: 1, alignItems: 'center', gap: 3 },
  navLabel: { color: C.muted, fontWeight: '600', fontSize: 9.5 },
  navLabelActive: { color: C.ink },
  navDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  navDotActive: { backgroundColor: C.orange },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(19,32,67,0.45)' },
  modalSheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 30, maxHeight: '86%' },
  modalHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 16 },
  modalProRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  modalProInfo: { flex: 1, gap: 3 },
  postJobTitle: { color: C.ink, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  modalLabel: { color: C.muted, fontSize: 11, fontWeight: '600' },
  modalInputLabel: { marginTop: 14, marginBottom: 7 },
  modalInput: { height: 46, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 13, fontSize: 13, color: C.ink, backgroundColor: C.cream, outlineWidth: 0 },
  categoryPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryPickerChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: C.cream },
  categoryPickerChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  categoryPickerText: { color: C.muted, fontWeight: '700', fontSize: 12 },
  categoryPickerTextActive: { color: '#FFFFFF' },
});
