import { supabase } from '@/lib/supabase';

export type NotificationKind = 'new_job' | 'price_changed' | 'job_accepted' | 'job_completed';

export type AppNotification = {
  id: string;
  jobId?: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  job_id: string | null;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
};

function fromRow(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    jobId: row.job_id ?? undefined,
    kind: row.kind,
    title: row.title,
    body: row.body,
    read: row.read,
    createdAt: row.created_at,
  };
}

export async function fetchNotifications(userId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as NotificationRow[]).map(fromRow);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
  if (error) throw error;
}
