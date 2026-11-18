import {
  collection,
  doc,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "./firestoreClient";
import { db } from "./firebase";
import { apiFetch } from "./apiClient";
export function getConversationId(a: string, b: string) {
  return [a, b].sort().join("_");
}
export async function getOrCreateConversation(
  currentUser: any,
  targetUser: any,
  initialStatus: "pending" | "accepted" = "pending",
  isDesignerTarget = false,
) {
  const response = await apiFetch("/api/conversations/open", {
    method: "POST",
    body: JSON.stringify({ targetUserId: targetUser.id }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body.id as string;
}
export async function acceptConversationRequest(id: string) {
  await updateDoc(doc(db, "conversations", id), {
    status: "accepted",
    updatedAt: Date.now(),
  });
}
export async function declineConversationRequest(id: string) {
  await updateDoc(doc(db, "conversations", id), {
    status: "declined",
    updatedAt: Date.now(),
  });
}
export async function sendChatMessage(
  conversationId: string,
  sender: { uid: string; name: string; avatarUrl?: string },
  text: string,
  recipientId: string,
  imageUrl?: string,
  audioData?: { audioUrl: string; audioDuration: number; waveform?: number[] },
) {
  if (!text.trim() && !imageUrl && !audioData?.audioUrl) return;
  await addDoc(collection(db, "conversations", conversationId, "messages"), {
    conversationId,
    senderId: sender.uid,
    text: text.trim(),
    imageUrl: imageUrl || "",
    ...(audioData || {}),
  });
}
const lastMarked = new Map<string, number>();
export async function markConversationAsRead(
  conversationId: string,
  userId: string,
) {
  const key = userId + "|" + conversationId;
  if (Date.now() - (lastMarked.get(key) || 0) < 1500) return;
  lastMarked.set(key, Date.now());
  try {
    await updateDoc(doc(db, "conversations", conversationId), {
      unreadCounts: { [userId]: 0 },
    });
  } catch {
    lastMarked.delete(key);
  }
}
export async function toggleMessageReaction(
  conversationId: string,
  messageId: string,
  userId: string,
  emoji: string,
) {
  const response = await apiFetch("/api/conversations/reaction", {
    method: "POST",
    body: JSON.stringify({ conversationId, messageId, emoji }),
  });
  if (!response.ok) throw new Error((await response.json()).error);
}
export async function deleteChatMessage(
  conversationId: string,
  messageId: string,
  mode: "for_me" | "for_everyone",
  userId: string,
) {
  await updateDoc(
    doc(db, "conversations", conversationId, "messages", messageId),
    mode === "for_everyone"
      ? { deletedForEveryone: true, text: "" }
      : { deletedFor: arrayUnion(userId) },
  );
}
export async function deleteConversation(
  conversationId: string,
  userId: string,
) {
  await updateDoc(doc(db, "conversations", conversationId), {
    deletedBy: arrayUnion(userId),
    clearedAt: { [userId]: Date.now() },
    unreadCounts: { [userId]: 0 },
  });
}
export async function blockUserInConversation(
  conversationId: string,
  currentUserId: string,
  targetUserId: string,
) {
  await updateDoc(doc(db, "conversations", conversationId), {
    blockedBy: arrayUnion(currentUserId),
  });
  await updateDoc(doc(db, "users", currentUserId, "private", "account"), {
    blockedUsers: arrayUnion(targetUserId),
  });
}
export async function unblockUserInConversation(
  conversationId: string,
  currentUserId: string,
  targetUserId: string,
) {
  await updateDoc(doc(db, "conversations", conversationId), {
    blockedBy: arrayRemove(currentUserId),
  });
  await updateDoc(doc(db, "users", currentUserId, "private", "account"), {
    blockedUsers: arrayRemove(targetUserId),
  });
}
