import { Timestamp, type Firestore, type QueryDocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import type { DecodedIdToken } from "firebase-admin/auth";
import { DEFAULT_DESIGNERS } from "../data/defaultDesigners.js";
import { designerPageSize, designerSearchText, readDesignerPages } from "../lib/designerCatalogue.js";
import { actorFor, editor, fail, hash } from "./security.js";

export function readDesignerDocuments(db: Firestore, transaction?: Transaction) {
  const base = db.collection("designers").orderBy("__name__").limit(designerPageSize);
  return readDesignerPages<QueryDocumentSnapshot>(async (after) => {
    const query = after ? base.startAfter(after) : base;
    return (await (transaction ? transaction.get(query) : query.get())).docs;
  });
}

export async function restoreDefaultDesigners(db: Firestore, user: DecodedIdToken) {
  return db.runTransaction(async (transaction) => {
    if (!editor(await actorFor(db, user, transaction), "content")) fail(403, "Нет прав редактора");
    const documents = await readDesignerDocuments(db, transaction);
    const existingNames = new Set(documents.flatMap((document) => {
      const { name, brand } = document.data();
      return [designerSearchText(name), designerSearchText(brand)].filter(Boolean);
    }));

    let added = 0;
    for (const designer of DEFAULT_DESIGNERS) {
      const key = designerSearchText(designer.name);
      if (existingNames.has(key)) continue;
      transaction.create(db.doc(`designers/default_${hash(key)}`), {
        ...designer,
        createdAt: Timestamp.now(),
      });
      added++;
    }
    return { added };
  });
}
