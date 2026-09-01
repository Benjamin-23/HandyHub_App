import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { C } from '@/constants/handyhub-theme';
import { useAuth } from '@/hooks/use-auth';
import { fetchNotifications, markAllNotificationsRead, type AppNotification } from '@/lib/notifications';

const POLL_INTERVAL_MS = 20000;

function timeAgo(iso: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [visible, setVisible] = useState(false);

  const load = useCallback(() => (user ? fetchNotifications(user.id) : Promise.resolve([])), [user]);

  useEffect(() => {
    let cancelled = false;
    function poll() {
      // Notifications are best-effort — a failed poll shouldn't surface an error.
      load().then((data) => { if (!cancelled) setItems(data); }).catch(() => {});
    }
    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [load]);

  const unreadCount = items.filter((item) => !item.read).length;

  async function open() {
    Haptics.selectionAsync();
    setVisible(true);
    try {
      setItems(await load());
      if (!user) return;
      await markAllNotificationsRead(user.id);
      setItems((current) => current.map((item) => ({ ...item, read: true })));
    } catch {
      // Best-effort — worst case the badge stays until the next successful mark-read.
    }
  }

  return (
    <>
      <Pressable onPress={open} style={styles.button}>
        <Ionicons color="#FFFFFF" name="notifications" size={14} />
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </Pressable>

      <Modal animationType="slide" onRequestClose={() => setVisible(false)} transparent visible={visible}>
        <Pressable onPress={() => setVisible(false)} style={styles.backdrop} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Notifications</Text>
          {items.length === 0 ? (
            <Text style={styles.empty}>Nothing yet — updates on your jobs will show up here.</Text>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <View style={styles.row}>
                  <View style={[styles.dot, item.read && styles.dotRead]} />
                  <View style={styles.rowContent}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    <Text style={styles.rowBody}>{item.body}</Text>
                    <Text style={styles.rowTime}>{timeAgo(item.createdAt)}</Text>
                  </View>
                </View>
              )}
              style={styles.list}
            />
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { width: 34, height: 34, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: -3, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3, borderWidth: 1.5, borderColor: C.ink },
  badgeText: { color: '#FFFFFF', fontSize: 8.5, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(19,32,67,0.5)' },
  sheet: { backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, maxHeight: '75%' },
  handle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: C.line, marginBottom: 14 },
  title: { color: C.ink, fontWeight: '800', fontSize: 16, marginBottom: 12 },
  empty: { color: C.muted, fontSize: 12.5, lineHeight: 18, paddingVertical: 20, textAlign: 'center' },
  list: { maxHeight: 420 },
  row: { flexDirection: 'row', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.brand, marginTop: 5 },
  dotRead: { backgroundColor: C.line },
  rowContent: { flex: 1 },
  rowTitle: { color: C.ink, fontWeight: '700', fontSize: 12.5 },
  rowBody: { color: C.muted, fontSize: 11.5, marginTop: 2, lineHeight: 16 },
  rowTime: { color: C.muted, fontSize: 10, marginTop: 4 },
});
