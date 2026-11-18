import {isSubscriptionActive} from '../lib/communityLimits';
import { apiFetch,ensureAccount } from '../lib/apiClient';
import { clearReadCache } from '../lib/firestoreClient';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, onSnapshot, setDoc, serverTimestamp } from '../lib/firestoreClient';
import { auth, db } from '../lib/firebase';
import { User } from '../types';

interface AuthContextType {
  currentUser: FirebaseUser | null;
  dbUser: User | null;
  loading: boolean;
  isAdmin: boolean;
  userRole: string;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  dbUser: null,
  loading: true,
  isAdmin: false,
  userRole: 'user',
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [publicData, setPublicData] = useState<any | null>(null);
  const [privateData, setPrivateData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubPublic: (() => void) | undefined;
    let unsubPrivate: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      setPublicData(null);setPrivateData(null);clearReadCache();

      if (unsubPublic) {
        unsubPublic();
        unsubPublic = undefined;
      }
      if (unsubPrivate) {
        unsubPrivate();
        unsubPrivate = undefined;
      }

      if (user) {
        setLoading(true);
        try { await ensureAccount(); } catch(error) { console.error('[AuthContext] Account initialization failed');setLoading(false);return; }
        if(auth.currentUser?.uid!==user.uid)return;
        // 1. Subscribe to public profile document
        const publicDocRef = doc(db, 'users', user.uid);
        unsubPublic = onSnapshot(publicDocRef, (docSnap) => {
          if (docSnap.exists()) {
            setPublicData({ id: docSnap.id, ...docSnap.data() });
          } else {
            setPublicData(null);
          }
          setLoading(false);
        }, (error) => {
          console.warn("[AuthContext] Public doc subscription warning:", error);
          setLoading(false);
        });

        // 2. Subscribe to private account document
        const privateDocRef = doc(db, 'users', user.uid, 'private', 'account');
        unsubPrivate = onSnapshot(privateDocRef, (docSnap) => {
          if (docSnap.exists()) {
            setPrivateData(docSnap.data());
          } else { setPrivateData(null); }
        }, (error) => {
          console.warn("[AuthContext] Private doc subscription warning:", error);
        });
      } else {
        setPublicData(null);
        setPrivateData(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubPublic) unsubPublic();
      if (unsubPrivate) unsubPrivate();
    };
  }, []);

  // Merge public profile and private account state seamlessly
  const dbUser: User | null = publicData ? ({
    ...publicData,
    ...(privateData || {}),
    email: privateData?.email || currentUser?.email || '',
    subscriptionTier: isSubscriptionActive({...privateData,role:publicData.role})?(privateData?.subscriptionTier||'free'):'free',
    singleJobCredits: privateData?.singleJobCredits ?? 0,
    hasJobPostingAccess: privateData?.hasJobPostingAccess ?? false,
    warnings: privateData?.warnings ?? 0,
    blockedUsers: privateData?.blockedUsers || []
  } as User) : null;

  const role = dbUser?.role || 'user';
  const isAdmin = ['superadmin', 'admin'].includes(role);

  return (
    <AuthContext.Provider value={{ currentUser, dbUser, loading, isAdmin, userRole: role }}>
      {children}
    </AuthContext.Provider>
  );
};
