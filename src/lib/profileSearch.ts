import { collection, getDocs, query, where, limit } from "./firestoreClient";
import { db } from "./firebase";
export async function searchPublicProfiles(value: string) {
  const term = value.trim().replace(/^@/, "").toLowerCase().slice(0, 100);
  if (term.length < 2) return [];
  const [names, handles] = await Promise.all(
    ["searchName", "searchHandle"].map((field) =>
      getDocs(
        query(
          collection(db, "users"),
          where(field, ">=", term),
          where(field, "<=", term + "\uf8ff"),
          limit(20),
        ),
      ),
    ),
  );
  return [
    ...new Map(
      [...names.docs, ...handles.docs].map((d) => [
        d.id,
        { id: d.id, ...d.data() },
      ]),
    ).values(),
  ];
}
