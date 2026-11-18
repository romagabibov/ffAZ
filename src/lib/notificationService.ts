import { getTimestampMillis } from './dateUtils';
import { apiFetch } from "./apiClient";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  writeBatch,
  limit,
} from "./firestoreClient";
import { db } from "./firebase";
import { AppNotification, NotificationType } from "../types";

export const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;

export interface CreateNotificationParams {
  userId: string; // Recipient user ID
  type: NotificationType;
  fromUserId?: string;
  fromUserName?: string;
  fromUserAvatar?: string;
  senderId?: string;
  senderName?: string;
  senderAvatar?: string;
  title?: string;
  message?: string;
  link?: string;
  targetId?: string;
  metadata?: Record<string, any>;
}

/**
 * Creates a notification in Firestore.
 * Note: Direct chat messages are handled natively via device notification shade & conversations,
 * and are deliberately excluded from this collection.
 */
export async function createNotification(
  params: CreateNotificationParams,
): Promise<string | null> {
  const senderId = params.fromUserId || params.senderId;
  const senderName = params.fromUserName || params.senderName;
  const senderAvatar = params.fromUserAvatar || params.senderAvatar;

  // Do not send notification to oneself
  if (senderId && senderId === params.userId) {
    return null;
  }

  // Direct chat messages go to device notification shade only, not here
  if (params.type === "message") {
    return null;
  }

  try {
    const notifsRef = collection(db, "notifications");
    const newDoc = doc(notifsRef);
    const notificationData: Record<string, any> = {
      userId: params.userId,
      type: params.type,
      read: false,
      createdAt: Date.now(),
      fromUserId: senderId || "system",
      fromUserName: senderName || "System",
    };

    if (senderAvatar) notificationData.fromUserAvatar = senderAvatar;
    if (params.title) notificationData.title = params.title;
    if (params.message) notificationData.message = params.message;
    if (params.link) notificationData.link = params.link;
    if (params.targetId) notificationData.targetId = params.targetId;
    if (params.metadata) notificationData.metadata = params.metadata;

    await setDoc(newDoc, notificationData);
    return newDoc.id;
  } catch (error) {
    console.error("Failed to create notification:", error);
    return null;
  }
}

/**
 * Subscribes to real-time activity and system notifications for a given user within the last 15 days.
 * Message notifications are excluded so they appear exclusively in the device notification shade and chat.
 */
export function subscribeToUserNotifications(
  userId: string,
  callback: (items: AppNotification[]) => void,
  daysLimit = 15,
  onError?: () => void,
) {
  let items: AppNotification[] = [],
    readAt = 0,
    loaded = false;
  const emit = () =>
    loaded && callback(
      items.map((n) => ({
        ...n,
        read: n.read || getTimestampMillis(n.createdAt) <= readAt,
      })),
    );
  const a = onSnapshot(doc(db, "users", userId, "private", "account"), (s) => {
    readAt = Number(s.data()?.notificationsReadAt || 0);
    emit();
  });
  const b = onSnapshot(
    query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(50),
    ),
    (snapshot) => {
      loaded = true;
      const cutoff = Date.now() - daysLimit * 86400000;
      items = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as AppNotification)
        .filter((n) => getTimestampMillis(n.createdAt) >= cutoff && n.type !== "message");
      emit();
    },
    () => { onError?.(); },
  );
  return () => {
    a();
    b();
  };
}

/**
 * Marks a specific notification as read
 */
async function changeAnnouncement(notificationId: string, action: 'read' | 'dismiss') {
  const key = notificationId.slice('announcement:'.length);
  const response = await apiFetch('/api/notifications/announcements/' + encodeURIComponent(key) + '/' + action, {
    method: 'POST', body: '{}',
  });
  if (!response.ok) throw new Error('Не удалось обновить уведомление');
}

export async function markNotificationAsRead(notificationId: string): Promise<void> {
  if (notificationId.startsWith('announcement:')) return changeAnnouncement(notificationId, 'read');
  await updateDoc(doc(db, 'notifications', notificationId), { read: true });
}

/**
 * Marks all unread notifications for a user as read
 */
export async function markAllNotificationsAsRead(_userId: string) {
  const response = await apiFetch("/api/notifications/read-all", {
    method: "POST",
    body: "{}",
  });
  if (!response.ok) throw new Error("Не удалось отметить уведомления");
}

/**
 * Deletes a notification
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  if (notificationId.startsWith('announcement:')) return changeAnnouncement(notificationId, 'dismiss');
  await deleteDoc(doc(db, 'notifications', notificationId));
}

/**
 * Clears all read notifications for a user
 */
export async function clearReadNotifications(_userId: string) {
  for (let i = 0; i < 5; i++) {
    const response = await apiFetch("/api/notifications/clear-read", {
      method: "POST",
      body: "{}",
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || "Не удалось очистить уведомления");
    if (!result.mayHaveMore) return;
  }
}

/** Header badge reads only the newest unread records; opening the inbox owns the full page query. */
export function subscribeToUnreadNotifications(
  userId: string,
  readAt: number,
  callback: (items: AppNotification[]) => void,
) {
  const cutoff = Math.max(
    readAt,
    Math.floor(Date.now() / 86400000) * 86400000 - 15 * 86400000,
  );
  return onSnapshot(
    query(
      collection(db, "notifications"),
      where("userId", "==", userId),
      where("read", "==", false),
      where("createdAt", ">", cutoff),
      orderBy("createdAt", "desc"),
      limit(20),
    ),
    (snapshot) =>
      callback(
        snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as AppNotification,
        ),
      ),
    () => console.warn("Notification badge unavailable"),
  );
}
