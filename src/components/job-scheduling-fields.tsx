import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/app-text';
import { C } from '@/constants/handyhub-theme';
import { KENYA_COUNTIES } from '@/constants/kenya-counties';
import { formatTimeLabel } from '@/lib/format';

// Cap the longer edge so an upload stays in the tens-to-low-hundreds of KB —
// expo-image-picker's own `quality` only controls JPEG compression, not
// resolution, so a full-res phone photo needs this resize to reliably land
// "in kbs" rather than several MB.
const JOB_PHOTO_MAX_DIMENSION = 1024;

export type JobPhoto = { uri: string; base64: string; extension: 'jpg' };

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

type DropdownOption = { value: string; label: string; disabled?: boolean };

// A tap-to-open, single-select dropdown — the trigger looks like a normal
// field; picking an option happens in a scrollable modal sheet rather than a
// horizontal-scrolling or wrapped row of chips. Shared by the time-slot and
// county pickers below.
function Dropdown({ options, value, placeholder, onSelect }: {
  options: DropdownOption[];
  value: string | null;
  placeholder: string;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = options.find((option) => option.value === value)?.label;

  return (
    <>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); setOpen(true); }}
        style={styles.dropdownTrigger}>
        <Text numberOfLines={1} style={[styles.dropdownTriggerText, !selectedLabel && styles.dropdownPlaceholder]}>
          {selectedLabel ?? placeholder}
        </Text>
        <Ionicons color={C.muted} name="chevron-down" size={14} />
      </Pressable>

      <Modal animationType="fade" onRequestClose={() => setOpen(false)} transparent visible={open}>
        <Pressable onPress={() => setOpen(false)} style={styles.dropdownBackdrop}>
          <Pressable onPress={(e) => e.stopPropagation()} style={styles.dropdownSheet}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {options.map((option) => {
                const selected = option.value === value;
                return (
                  <Pressable
                    disabled={option.disabled}
                    key={option.value}
                    onPress={() => { Haptics.selectionAsync(); onSelect(option.value); setOpen(false); }}
                    style={[styles.dropdownOption, selected && styles.dropdownOptionActive]}>
                    <Text
                      style={[
                        styles.dropdownOptionText,
                        selected && styles.dropdownOptionTextActive,
                        option.disabled && styles.dropdownOptionTextDisabled,
                      ]}>
                      {option.label}
                    </Text>
                    {selected && <Ionicons color={C.brand} name="checkmark" size={15} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// A real calendar-grid date picker + time-slot picker, entirely custom (no
// native module) so it behaves identically on iOS, Android, and web. Shared
// by both the customer/worker job forms and the agent's on-behalf-of form.
export function DateTimePickerField({ valueIso, onChange }: {
  valueIso?: string;
  onChange: (iso: string | undefined) => void;
}) {
  const initial = valueIso ? new Date(valueIso) : null;
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }, [now]);

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

  // Once the selected day is today, a slot needs at least an hour of lead
  // time to be real — enough for a pro to actually get moving — so it's not
  // just "must be after now", it's "must be at least an hour from now".
  const isViewingToday =
    selectedDay !== null && viewYear === now.getFullYear() && viewMonth === now.getMonth() && selectedDay === now.getDate();
  const earliestAllowed = useMemo(() => new Date(now.getTime() + 60 * 60 * 1000), [now]);
  function isPastTime(slot: string) {
    if (!isViewingToday || selectedDay === null) return false;
    const [h, m] = slot.split(':').map(Number);
    return new Date(viewYear, viewMonth, selectedDay, h, m, 0) <= earliestAllowed;
  }

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
    if (isPastTime(time)) return;
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
          {isViewingToday && <Text style={styles.dateTimePastNote}>Times within the next hour aren&apos;t available today.</Text>}
          <Dropdown
            onSelect={selectTime}
            options={TIME_SLOTS.map((slot) => ({ value: slot, label: formatTimeLabel(slot), disabled: isPastTime(slot) }))}
            placeholder="Pick a time"
            value={selectedTime}
          />
        </View>
      )}
    </View>
  );
}

// Lets the customer (or an agent posting on their behalf) fill in a job's
// location either from the device's current position (reverse-geocoded to a
// readable address) or by picking one of Kenya's 47 counties — with a
// free-text fallback for anything more specific than either gives.
export function LocationPicker({ value, onChange }: {
  value: string;
  onChange: (location: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function useCurrentLocation() {
    Haptics.selectionAsync();
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission was denied.');
        setLocating(false);
        return;
      }
      const position = await Location.getCurrentPositionAsync({});
      const [place] = await Location.reverseGeocodeAsync({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
      const label = [place?.district ?? place?.subregion ?? place?.city, place?.region ?? place?.country]
        .filter(Boolean)
        .join(', ');
      onChange(label || 'Current location');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get your location.');
    }
    setLocating(false);
  }

  function selectCounty(county: string) {
    Haptics.selectionAsync();
    onChange(`${county} County`);
    setOpen(false);
  }

  return (
    <View>
      <Pressable
        onPress={() => { Haptics.selectionAsync(); setOpen((value_) => !value_); }}
        style={styles.dateTimeTrigger}>
        <Ionicons color={C.brand} name="location-outline" size={14} />
        <Text style={styles.dateTimeTriggerText}>{value || 'Pick a location'}</Text>
      </Pressable>

      {open && (
        <View style={styles.calendarWrap}>
          <Pressable disabled={locating} onPress={useCurrentLocation} style={styles.locationCurrentButton}>
            {locating ? (
              <ActivityIndicator color={C.brand} size="small" />
            ) : (
              <>
                <Ionicons color={C.brand} name="navigate-outline" size={14} />
                <Text style={styles.locationCurrentText}>Use my current location</Text>
              </>
            )}
          </Pressable>

          {error && (
            <View style={styles.errorRow}>
              <Ionicons color={C.brand} name="alert-circle" size={13} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={styles.calendarTimeLabel}>Or pick a county</Text>
          <Dropdown
            onSelect={selectCounty}
            options={KENYA_COUNTIES.map((county) => ({ value: county, label: `${county} County` }))}
            placeholder="Choose a county"
            value={KENYA_COUNTIES.find((county) => value === `${county} County`) ?? null}
          />

          <TextInput
            onChangeText={onChange}
            placeholder="Or type a specific address"
            placeholderTextColor={C.muted}
            style={[styles.counterInput, styles.locationManualInput]}
            value={value}
          />
        </View>
      )}
    </View>
  );
}

// Lets a customer attach a photo of the issue when posting a job — camera
// first (matches "take a photo"), with a library fallback. Resized/compressed
// client-side before the caller uploads it, and optional throughout.
export function PhotoPicker({ photo, onChange }: {
  photo: JobPhoto | null;
  onChange: (photo: JobPhoto | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function process(sourceUri: string) {
    setBusy(true);
    setError(null);
    try {
      const context = ImageManipulator.manipulate(sourceUri);
      context.resize({ width: JOB_PHOTO_MAX_DIMENSION });
      const rendered = await context.renderAsync();
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.5, base64: true });
      if (!result.base64) {
        setError('Could not process that photo — try another one.');
      } else {
        onChange({ uri: result.uri, base64: result.base64, extension: 'jpg' });
      }
    } catch {
      setError('Could not process that photo — try another one.');
    }
    setBusy(false);
  }

  async function takePhoto() {
    Haptics.selectionAsync();
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError('Allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    await process(result.assets[0].uri);
  }

  async function pickFromLibrary() {
    Haptics.selectionAsync();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Allow photo access to attach a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    await process(result.assets[0].uri);
  }

  function clear() {
    Haptics.selectionAsync();
    setError(null);
    onChange(null);
  }

  return (
    <View>
      {photo ? (
        <View style={styles.photoPreviewWrap}>
          <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
          <Pressable disabled={busy} hitSlop={8} onPress={clear} style={styles.photoClearButton}>
            <Ionicons color="#FFFFFF" name="close" size={14} />
          </Pressable>
        </View>
      ) : (
        <View style={styles.photoActionsRow}>
          <Pressable disabled={busy} onPress={takePhoto} style={styles.photoActionButton}>
            {busy ? (
              <ActivityIndicator color={C.brand} size="small" />
            ) : (
              <>
                <Ionicons color={C.brand} name="camera-outline" size={16} />
                <Text style={styles.photoActionText}>Take photo</Text>
              </>
            )}
          </Pressable>
          <Pressable disabled={busy} onPress={pickFromLibrary} style={styles.photoActionButton}>
            <Ionicons color={C.brand} name="image-outline" size={16} />
            <Text style={styles.photoActionText}>Choose photo</Text>
          </Pressable>
        </View>
      )}
      {error && (
        <View style={styles.errorRow}>
          <Ionicons color={C.brand} name="alert-circle" size={13} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  errorText: { color: C.brand, fontSize: 11.5, fontWeight: '600', flex: 1 },
  counterInput: { flex: 1, height: 39, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12, backgroundColor: C.cream, color: C.ink, fontSize: 12, outlineWidth: 1.5, outlineColor: '#D1D5DB', outlineStyle: 'solid' },
  dateTimeTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12, backgroundColor: C.cream, marginTop: 7 },
  dateTimeTriggerText: { flex: 1, color: C.ink, fontWeight: '600', fontSize: 12 },
  calendarWrap: { alignSelf: 'stretch', marginTop: 8, padding: 10, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.cream },
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
  dateTimePastNote: { color: C.brand, fontSize: 10, marginBottom: 6, marginTop: -4 },
  locationCurrentButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 39, borderRadius: 11, backgroundColor: C.brand, marginBottom: 10 },
  locationCurrentText: { color: '#FFFFFF', fontWeight: '700', fontSize: 12 },
  // Overrides counterInput's `flex: 1` — that's meant for a TextInput sitting
  // beside a button in a row, and left unset here it stretches this one to
  // fill all remaining vertical space in its column parent (a giant empty
  // box, since ScrollView content otherwise sizes to its children).
  locationManualInput: { flex: 0, alignSelf: 'stretch', marginTop: 10 },
  dropdownTrigger: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12, backgroundColor: C.card },
  dropdownTriggerText: { flex: 1, color: C.ink, fontWeight: '600', fontSize: 12.5 },
  dropdownPlaceholder: { color: C.muted, fontWeight: '500' },
  dropdownBackdrop: { flex: 1, backgroundColor: 'rgba(19,32,67,0.45)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  dropdownSheet: { alignSelf: 'stretch', maxHeight: 320, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, paddingVertical: 6 },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 16 },
  dropdownOptionActive: { backgroundColor: C.cream },
  dropdownOptionText: { color: C.ink, fontWeight: '600', fontSize: 13 },
  dropdownOptionTextActive: { color: C.brand, fontWeight: '800' },
  dropdownOptionTextDisabled: { color: C.line },
  photoActionsRow: { flexDirection: 'row', gap: 8, marginTop: 7 },
  photoActionButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: 11, borderWidth: 1, borderColor: C.line, borderStyle: 'dashed', backgroundColor: C.cream },
  photoActionText: { color: C.brand, fontWeight: '700', fontSize: 12 },
  photoPreviewWrap: { marginTop: 7, borderRadius: 13, overflow: 'hidden' },
  photoPreview: { width: '100%', height: 160, backgroundColor: C.cream },
  photoClearButton: { position: 'absolute', top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(19,32,67,0.6)', alignItems: 'center', justifyContent: 'center' },
});
