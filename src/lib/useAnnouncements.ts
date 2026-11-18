import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import type { AppNotification } from '../types';
import { readApiJson } from './apiClient';

type Snapshot = { uid: string; until: number; rows: AppNotification[] };
let cache: Snapshot | undefined;
let pending: { uid: string; request: Promise<Snapshot> } | undefined;

export function refreshAnnouncements() {
  cache = undefined;
  window.dispatchEvent(new Event('afw-announcements-refresh'));
}

function load(uid: string) {
  if (cache?.uid === uid && cache.until > Date.now()) return Promise.resolve(cache);
  if (pending?.uid === uid) return pending.request;
  const request = readApiJson<{ items: AppNotification[] }>('/api/notifications/announcements').then(result => {
    const snapshot = { uid, until: Date.now() + 120_000, rows: result.items };
    cache = snapshot;
    return snapshot;
  }).finally(() => { if (pending?.request === request) pending = undefined; });
  pending = { uid, request };
  return request;
}

export function useAnnouncements() {
  const { currentUser, dbUser } = useAuth();
  const uid = currentUser?.uid;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  useEffect(() => {
    if (!uid) { setSnapshot(undefined); return; }
    let active = true;
    function sync() {
      if (!uid || document.visibilityState === 'hidden') return;
      void load(uid).then(data => { if (active) setSnapshot(data); }).catch(() => {});
    }
    sync();
    const timer = window.setInterval(sync, 120_000);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('afw-announcements-refresh', sync);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('afw-announcements-refresh', sync);
    };
  }, [uid]);
  const settings = dbUser as (typeof dbUser & {
    announcementsReadAt?: number; announcementsHiddenAt?: number; announcementReadIds?: string[]; announcementDismissedIds?: string[];
  });
  return useMemo(() => {
    if (!uid || snapshot?.uid !== uid) return [];
    const dismissed = new Set(settings?.announcementDismissedIds || []);
    const read = new Set(settings?.announcementReadIds || []);
    return snapshot.rows.filter(row => !dismissed.has(row.id) && Number(row.createdAt) > (settings?.announcementsHiddenAt || 0))
      .map(row => ({ ...row, id: 'announcement:' + row.id, userId: uid,
        read: read.has(row.id) || Number(row.createdAt) <= (settings?.announcementsReadAt || 0) }));
  }, [uid, snapshot, settings]);
}
