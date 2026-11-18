import { arrayRemove, arrayUnion, doc, writeBatch } from './firestoreClient';
import { db } from './firebase';

export async function followUser(userId: string, targetUserId: string, following: boolean) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', userId), {
    following: following ? arrayUnion(targetUserId) : arrayRemove(targetUserId),
  });
  batch.update(doc(db, 'users', targetUserId), {
    followers: following ? arrayUnion(userId) : arrayRemove(userId),
  });
  await batch.commit();
}
