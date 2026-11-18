import {SecureImage} from '../components/SecureMedia';
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  doc, 
  getDoc, 
  updateDoc, 
  arrayUnion, 
  arrayRemove, 
  limit,
  addDoc,
  serverTimestamp 
} from '../lib/firestoreClient';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useUI } from '../context/UIContext';
import { User } from '../types';
import { getOrCreateConversation, getConversationId } from '../lib/chatService';
import { followUser } from '../lib/followUser';
import ImageZoomModal from '../components/ImageZoomModal';
import GoldenNeedleBadge from '../components/GoldenNeedleBadge';
import ProfileHeader from '../components/ProfileHeader';
import AgencyModelVerificationCard from '../components/AgencyModelVerificationCard';
import { 
  User as UserIcon, 
  Share2, 
  Check, 
  Copy, 
  ExternalLink, 
  MapPin, 
  Globe, 
  Briefcase, 
  GraduationCap, 
  Sparkles, 
  ShieldCheck, 
  Heart, 
  ArrowLeft,
  Layers,
  Send,
  Building2,
  MessageSquare,
  Scissors,
  UserCheck,
  Calendar,
  Crown,
  Lock
} from 'lucide-react';

export default function UserProfilePublic() {
  const { username, handle: handleParam } = useParams<{ username?: string; handle?: string }>();
  const rawTarget = (username || handleParam || '').trim();
  // Clean rawTarget: remove leading '@' if present
  const rawTargetNoAt = rawTarget.replace(/^@+/, '').trim();
  const cleanUsername = rawTargetNoAt.toLowerCase();

  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const ui = useUI();
  const { currentUser, dbUser, isAdmin } = useAuth();

  const isPremiumUser = Boolean(
    currentUser && (
      isAdmin ||
      dbUser?.role === 'admin' ||
      dbUser?.role === 'superadmin' ||
      (dbUser?.subscriptionTier && dbUser?.subscriptionTier !== 'free') ||
      dbUser?.hasGoldenNeedle ||
      dbUser?.hasDirectChat
    )
  );

  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [copied, setCopied] = useState(false);
  const [userPosts, setUserPosts] = useState<any[]>([]);
  const [zoomImage, setZoomImage] = useState<{ url: string; caption?: string } | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'about' | 'experience' | 'portfolio' | 'direct-chat'>('about');

  useEffect(() => {
    if (cleanUsername === 'subscription-plans' || cleanUsername === 'plans' || cleanUsername === 'subscriptions') {
      navigate('/plans', { replace: true });
      return;
    }

    if (!cleanUsername && !rawTargetNoAt) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const fetchUserProfile = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        let foundUser: User | null = null;

        // 1. Direct document lookup by ID with original case (preserves Firestore doc ID casing)
        if (rawTargetNoAt) {
          try {
            const directDoc = await getDoc(doc(db, 'users', rawTargetNoAt));
            if (directDoc.exists()) {
              foundUser = { id: directDoc.id, ...directDoc.data() } as User;
            }
          } catch (e) {
            // Document ID lookup error fallback
          }
        }

        // 2. Direct document lookup by cleanUsername (lowercase)
        if (!foundUser && cleanUsername && cleanUsername !== rawTargetNoAt) {
          try {
            const directDocLower = await getDoc(doc(db, 'users', cleanUsername));
            if (directDocLower.exists()) {
              foundUser = { id: directDocLower.id, ...directDocLower.data() } as User;
            }
          } catch (e) {
            // Ignore
          }
        }

        // 3. Query by exact username (lowercase)
        if (!foundUser && cleanUsername) {
          const qUsername = query(
            collection(db, 'users'),
            where('username', '==', cleanUsername),
            limit(1)
          );
          const snapUsername = await getDocs(qUsername);
          if (!snapUsername.empty) {
            const docData = snapUsername.docs[0];
            foundUser = { id: docData.id, ...docData.data() } as User;
          }
        }

        // 4. Query by exact username (original casing)
        if (!foundUser && rawTargetNoAt && rawTargetNoAt !== cleanUsername) {
          const qUsernameOrig = query(
            collection(db, 'users'),
            where('username', '==', rawTargetNoAt),
            limit(1)
          );
          const snapUsernameOrig = await getDocs(qUsernameOrig);
          if (!snapUsernameOrig.empty) {
            const docData = snapUsernameOrig.docs[0];
            foundUser = { id: docData.id, ...docData.data() } as User;
          }
        }

        // 5. Query by handle with '@'
        if (!foundUser && cleanUsername) {
          const qHandle = query(
            collection(db, 'users'),
            where('handle', '==', `@${cleanUsername}`),
            limit(1)
          );
          const snapHandle = await getDocs(qHandle);
          if (!snapHandle.empty) {
            const docData = snapHandle.docs[0];
            foundUser = { id: docData.id, ...docData.data() } as User;
          }
        }

        // 6. Query by handle without '@'
        if (!foundUser && cleanUsername) {
          const qHandleNoAt = query(
            collection(db, 'users'),
            where('handle', '==', cleanUsername),
            limit(1)
          );
          const snapHandleNoAt = await getDocs(qHandleNoAt);
          if (!snapHandleNoAt.empty) {
            const docData = snapHandleNoAt.docs[0];
            foundUser = { id: docData.id, ...docData.data() } as User;
          }
        }

        // Indexed aliases replace the former full users scan.
        if(!foundUser&&cleanUsername){for(const field of ['searchHandle','searchId']){const result=await getDocs(query(collection(db,'users'),where(field,'==',cleanUsername),limit(1)));if(!result.empty){const d=result.docs[0];foundUser={id:d.id,...d.data()}as User;break;}}}

        if (foundUser) {
          setProfileUser(foundUser);
          if (currentUser && foundUser.followers?.includes(currentUser.uid)) {
            setIsFollowing(true);
          } else {
            setIsFollowing(false);
          }

          // Fetch user posts
          try {
            if(!currentUser){setUserPosts([]);return;}
            const qPosts = query(
              collection(db, 'posts'),
              where('userId', '==', foundUser.id)
            );
            const postsSnap = await getDocs(qPosts);
            const postsData = postsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setUserPosts(postsData);
          } catch (postErr) {
            console.error('Error fetching posts for user:', postErr);
          }
        } else {
          setNotFound(true);
        }
      } catch (err) {
        console.error('Failed to load user profile:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    fetchUserProfile();
  }, [cleanUsername, rawTargetNoAt, currentUser]);

  const handleCopyLink = async () => {
    const handle = profileUser?.handle?.replace(/^@+/, '') || profileUser?.username || profileUser?.id || cleanUsername;
    try {
      await navigator.clipboard.writeText(window.location.origin + '/@' + handle);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      void ui.alert(t('profile_copy_failed'));
    }
  };

  const handleFollowToggle = async () => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (!profileUser || profileUser.id === currentUser.uid) return;

    setFollowLoading(true);
    try {
      const next = !isFollowing;
      await followUser(currentUser.uid, profileUser.id, next);
      setIsFollowing(next);
      setProfileUser(previous => previous ? {
        ...previous,
        followers: next ? [...new Set([...(previous.followers || []), currentUser.uid])]
          : (previous.followers || []).filter(id => id !== currentUser.uid),
      } : null);
    } catch (err) {
      console.error('Follow error:', err);
      ui.alert('Failed to update follow status');
    } finally {
      setFollowLoading(false);
    }
  };

  const isDesignerTarget = Boolean(
    profileUser?.isDesigner ||
    profileUser?.designerId ||
    profileUser?.hasGoldenNeedle ||
    profileUser?.designerVerificationStatus === 'approved' ||
    profileUser?.industry === 'fashion_design' ||
    profileUser?.industry === 'designer' ||
    profileUser?.designerBrandName
  );

  const handleStartMessage = async () => {
    if (!currentUser) {
      navigate('/login');
      return;
    }
    if (!profileUser) return;
    if (currentUser.uid === profileUser.id) {
      navigate('/dashboard');
      return;
    }

    try {
      const activeConvId = await getOrCreateConversation(
        {
          uid: currentUser.uid,
          displayName: dbUser?.name || currentUser.displayName || 'Fashionista',
          email: currentUser.email,
          photoURL: dbUser?.avatarUrl || currentUser.photoURL,
          role: dbUser?.role || 'user',
          username: dbUser?.username,
          handle: dbUser?.handle,
          subscriptionTier: dbUser?.subscriptionTier || 'free',
          isDesigner: Boolean(dbUser?.isDesigner),
          hasGoldenNeedle: Boolean(dbUser?.hasGoldenNeedle)
        },
        {
          id: profileUser.id,
          name: profileUser.designerBrandName || profileUser.brandName || profileUser.name || 'Member',
          email: profileUser.email || '',
          avatarUrl: profileUser.avatarUrl || '',
          role: profileUser.role || 'user',
          headline: profileUser.profileData?.generalInfo?.headline || profileUser.bio || 'Fashion Member',
          username: profileUser.username,
          handle: profileUser.handle,
          subscriptionTier: profileUser.subscriptionTier || 'free',
          isDesigner: Boolean(profileUser.isDesigner),
          hasGoldenNeedle: Boolean(profileUser.hasGoldenNeedle)
        },
        'pending',
        isDesignerTarget
      );

      navigate(`/messages?conversationId=${activeConvId}`);
    } catch (err) {
      console.error('Error starting conversation:', err);
      navigate(`/messages?name=${encodeURIComponent(profileUser.designerBrandName || profileUser.brandName || profileUser.name || 'Member')}&userId=${profileUser.id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] bg-brand-light flex items-center justify-center p-6">
        <div className="text-center space-y-4">
          <div className="w-10 h-10 border-2 border-brand-dark/20 border-t-brand-accent rounded-full animate-spin mx-auto" />
          <p className="font-mono text-xs uppercase tracking-widest text-brand-dark/60 font-bold">
            [{t('public_loading_profile', 'Загрузка профиля...')}]
          </p>
        </div>
      </div>
    );
  }

  if (notFound || !profileUser) {
    return (
      <div className="min-h-[70vh] bg-brand-light flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-brand-card rounded-3xl border border-brand-dark/[0.08] p-8 sm:p-10 text-center space-y-6 shadow-xs">
          <div className="w-16 h-16 rounded-full border border-brand-dark/10 mx-auto flex items-center justify-center bg-brand-muted/60 text-brand-dark">
            <UserIcon size={30} />
          </div>
          <div>
            <h1 className="text-2xl font-serif font-normal tracking-tight text-brand-dark">
              {t('public_profile_not_found', 'Профиль не найден')}
            </h1>
            <p className="text-xs text-brand-dark/70 mt-2 font-normal">
              {t('public_no_user_with_handle', 'Участника с таким именем пользователя не найдено')}: <span className="font-mono font-bold text-brand-dark">@{cleanUsername}</span>
            </p>
          </div>
          <div className="pt-2 flex flex-col sm:flex-row gap-3 justify-center">
            <button 
              onClick={() => navigate(-1)} 
              className="rounded-full bg-brand-dark text-white px-6 py-2.5 font-semibold uppercase tracking-wider text-xs hover:bg-brand-accent transition-colors flex items-center justify-center gap-2 shadow-2xs"
            >
              <ArrowLeft size={14} /> {t('go_back', 'Назад')}
            </button>
            <Link 
              to="/designers" 
              className="rounded-full border border-brand-dark/15 bg-brand-card px-6 py-2.5 font-semibold uppercase tracking-wider text-xs hover:border-brand-accent hover:text-brand-accent transition-colors text-brand-dark block shadow-2xs"
            >
              {t('explore_community', 'Сообщество')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pData = profileUser.profileData;
  const userHandle = profileUser.handle || (profileUser.username ? `@${profileUser.username}` : (profileUser.name ? `@${profileUser.name.toLowerCase().replace(/\s+/g, '_')}` : `@${cleanUsername}`));
  const userAvatar = profileUser.avatarUrl || `https://api.dicebear.com/7.x/avataaars/svg?seed=${profileUser.id}`;
  const isOwnProfile = currentUser?.uid === profileUser.id;

  return (
    <div className="min-h-screen bg-brand-light pb-24 animate-in fade-in duration-500">
      {/* 1. TOP BREADCRUMB & BACK NAVIGATION */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 pt-6 pb-2 flex items-center justify-between">
        <button 
          onClick={() => navigate(-1)} 
          className="text-xs font-mono font-bold uppercase tracking-wider text-brand-dark/60 hover:text-brand-accent flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft size={14} /> {t('go_back', 'Назад')}
        </button>
        <span className="font-mono text-[11px] font-bold uppercase tracking-widest text-brand-dark/40">
          [PUBLIC PROFILE • {userHandle}]
        </span>
      </div>

      {/* 2. MAIN DOSSIER CONTAINER */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-4 sm:py-6 space-y-8">
        <ProfileHeader user={profileUser} posts={userPosts.length}
          onAvatarClick={() => setZoomImage({ url: userAvatar, caption: profileUser.name })}
          avatarLabel={t('profile_open_photo')}
          actions={<>
              {isOwnProfile ? (
                <>
                  <Link 
                    to="/dashboard?tab=edit-profile"
                    className="min-w-0 min-h-[44px] px-4 py-2.5 bg-brand-dark text-brand-light hover:bg-brand-accent transition-colors flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider shadow-xs"
                  >
                    <UserIcon size={14} />
                    <span>{t('edit_my_profile', 'Мой кабинет')}</span>
                  </Link>
                  <button 
                    onClick={handleCopyLink}
                    className="min-w-0 min-h-[44px] px-4 py-2.5 bg-brand-muted/70 hover:bg-brand-dark hover:text-brand-light border border-brand-dark/15 text-brand-dark transition-all flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider shadow-xs cursor-pointer"
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Share2 size={14} />}
                    <span>{copied ? t('copied', 'Скопировано') : t('share_profile_btn', 'Поделиться профилем')}</span>
                  </button>
                </>
              ) : (
                <>
                  {/* Подписаться */}
                  <button 
                    onClick={handleFollowToggle}
                    disabled={followLoading}
                    className={`min-w-0 min-h-[44px] px-4 py-2.5 font-semibold uppercase tracking-wider text-xs border flex items-center justify-center gap-2 transition-all shadow-xs cursor-pointer ${
                      isFollowing 
                        ? 'bg-brand-muted/80 text-brand-dark border-brand-dark/20 hover:bg-brand-dark hover:text-brand-light' 
                        : 'bg-brand-dark text-brand-light border-brand-dark hover:bg-brand-accent hover:border-brand-accent'
                    }`}
                  >
                    <Heart size={14} className={isFollowing ? 'fill-brand-accent text-brand-accent' : ''} />
                    <span>{isFollowing ? t('following_btn', 'Вы подписаны') : t('follow_btn', 'Подписаться')}</span>
                  </button>

                  {/* Единственная кнопка связи: Direct Chat с дизайнером или Сообщение автору */}
                  <button 
                    onClick={handleStartMessage}
                    className={`min-w-0 min-h-[44px] px-4 py-2.5 transition-all flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider shadow-xs cursor-pointer ${
                      isDesignerTarget
                        ? isPremiumUser
                          ? 'bg-brand-action text-white hover:bg-black'
                          : 'bg-brand-dark text-brand-light hover:bg-brand-accent'
                        : 'bg-brand-accent text-white hover:bg-brand-dark'
                    }`}
                    title={
                      isDesignerTarget
                        ? isPremiumUser
                          ? 'Написать в Direct Chat с дизайнером (Pro приоритет)'
                          : 'Отправить запрос на диалог дизайнеру (до 5 запросов в день)'
                        : 'Написать личное сообщение / отправить запрос'
                    }
                  >
                    <MessageSquare size={14} className={isDesignerTarget && isPremiumUser ? 'text-amber-300' : 'text-white'} />
                    <span>
                      {isDesignerTarget ? 'Написать дизайнеру' : t('send_message_btn', 'Написать сообщение')}
                    </span>
                    {isDesignerTarget && isPremiumUser && (profileUser.hasGoldenNeedle || profileUser.designerVerificationStatus === 'approved') && (
                      <GoldenNeedleBadge size="xs" showLabel={false} />
                    )}
                  </button>

                  {/* Поделиться ссылкой на профиль */}
                  <button 
                    onClick={handleCopyLink}
                    className="min-w-0 min-h-[44px] px-4 py-2.5 bg-brand-muted/70 hover:bg-brand-dark hover:text-brand-light border border-brand-dark/15 text-brand-dark transition-all flex items-center justify-center gap-2 font-semibold text-xs uppercase tracking-wider shadow-xs cursor-pointer"
                  >
                    {copied ? <Check size={14} className="text-emerald-600" /> : <Share2 size={14} />}
                    <span>{copied ? t('copied', 'Скопировано') : t('share_profile_btn', 'Поделиться профилем')}</span>
                  </button>
                </>
              )}
          </>}
        />

        {/* 3. NAVIGATION TABS (Editorial Luxury Pill Tabs) */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar border-b border-brand-dark/[0.08] pb-4">
          <button 
            onClick={() => setActiveTab('about')}
            className={`px-5 py-2.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all shadow-2xs shrink-0 whitespace-nowrap ${
              activeTab === 'about'
                ? 'bg-brand-dark text-white'
                : 'bg-brand-card text-brand-dark/70 border border-brand-dark/10 hover:border-brand-dark/30 hover:text-brand-dark'
            }`}
          >
            {t('public_tab_about', 'О себе и навыки')}
          </button>
          <button 
            onClick={() => setActiveTab('experience')}
            className={`px-5 py-2.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all shadow-2xs shrink-0 whitespace-nowrap ${
              activeTab === 'experience'
                ? 'bg-brand-dark text-white'
                : 'bg-brand-card text-brand-dark/70 border border-brand-dark/10 hover:border-brand-dark/30 hover:text-brand-dark'
            }`}
          >
            {t('public_tab_experience', 'Опыт и образование')}
          </button>
          {(profileUser.hasDirectChat || profileUser.hasGoldenNeedle || profileUser.designerVerificationStatus === 'approved') && (
            <button 
              onClick={() => setActiveTab('direct-chat')}
              className={`px-5 py-2.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all shadow-2xs flex items-center gap-1.5 shrink-0 whitespace-nowrap ${
                activeTab === 'direct-chat'
                  ? 'bg-brand-action text-white'
                  : 'bg-brand-card text-brand-dark/70 border border-brand-dark/10 hover:border-brand-dark/30 hover:text-brand-dark'
              }`}
            >
              <MessageSquare size={13} className={activeTab === 'direct-chat' ? 'text-amber-300' : 'text-brand-accent'} />
              <span>Direct Chat</span>
            </button>
          )}

          <button 
            onClick={() => setActiveTab('portfolio')}
            className={`px-5 py-2.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all shadow-2xs flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'portfolio'
                ? 'bg-brand-dark text-white'
                : 'bg-brand-card text-brand-dark/70 border border-brand-dark/10 hover:border-brand-dark/30 hover:text-brand-dark'
            }`}
          >
            <span>{t('public_tab_portfolio', 'Галерея работ')}</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
              activeTab === 'portfolio' ? 'bg-white/20 text-white' : 'bg-brand-muted text-brand-dark/70 border border-brand-dark/[0.08]'
            }`}>
              {userPosts.length}
            </span>
          </button>
        </div>

        {/* 4. TAB CONTENT PANELS */}

        {/* Tab 1: About & Skills (Clean & Editorial) */}
        {activeTab === 'about' && (
          <div className="space-y-8 max-w-4xl">
            {/* Bio & Statement Card */}
            <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-6 sm:p-8 shadow-xs">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand-accent block mb-1">
                [CREATIVE STATEMENT]
              </span>
              <h2 className="text-xl sm:text-2xl font-serif font-normal text-brand-dark mb-4 border-b border-brand-dark/[0.08] pb-3">
                Биография и творческое видение
              </h2>
              <div className="text-brand-dark/90 text-sm leading-relaxed whitespace-pre-line font-normal">
                {pData?.generalInfo?.bio || profileUser.bio || (i18n.language === 'az' ? 'Hələ ki tərcümeyi-hal əlavə olunmayıb.' : 'Биография пока не заполнена.')}
              </div>
            </div>

            {/* Skills */}
            {pData?.skills && pData.skills.length > 0 && (
              <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-6 sm:p-8 shadow-xs">
                <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand-accent block mb-1">
                  [EXPERTISE & SKILLS]
                </span>
                <h2 className="text-xl sm:text-2xl font-serif font-normal text-brand-dark mb-4 border-b border-brand-dark/[0.08] pb-3">
                  Подтвержденные компетенции и навыки
                </h2>
                <div className="flex flex-wrap gap-2 pt-1">
                  {pData.skills.map((skill, i) => (
                    <span 
                      key={i} 
                      className="rounded-full bg-brand-muted/70 border border-brand-dark/10 px-4 py-1.5 font-semibold uppercase text-xs tracking-wider text-brand-dark hover:border-brand-accent/40 transition-colors"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Experience & Education */}
        {activeTab === 'experience' && (
          <div className="space-y-8">
            {/* Work Experience */}
            <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-6 sm:p-8 shadow-xs">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand-accent block mb-1">
                [CAREER RECORD]
              </span>
              <h2 className="text-xl sm:text-2xl font-serif font-normal text-brand-dark mb-6 border-b border-brand-dark/[0.08] pb-3 flex items-center gap-2">
                <Briefcase size={20} className="text-brand-accent" /> Опыт работы и проекты
              </h2>
              {pData?.experience && pData.experience.length > 0 ? (
                <div className="space-y-6">
                  {pData.experience.map((exp) => (
                    <div key={exp.id} className="border-l-2 border-brand-dark/15 pl-4 sm:pl-5 space-y-1 hover:border-brand-accent transition-colors">
                      <h3 className="text-base font-bold text-brand-dark uppercase tracking-tight">{exp.title}</h3>
                      <p className="text-xs font-semibold text-brand-accent uppercase tracking-wider">{exp.company}</p>
                      <p className="text-xs font-mono text-brand-dark/60">
                        {exp.startDate} – {exp.current ? 'По настоящее время' : exp.endDate || 'N/A'}
                      </p>
                      {exp.description && (
                        <p className="text-xs text-brand-dark/80 pt-1 leading-relaxed font-normal">{exp.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-mono font-semibold text-brand-dark/60 uppercase tracking-widest">
                  Опыт работы пока не указан
                </p>
              )}
            </div>

            {/* Education */}
            <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-6 sm:p-8 shadow-xs">
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-brand-accent block mb-1">
                [ACADEMIC BACKGROUND]
              </span>
              <h2 className="text-xl sm:text-2xl font-serif font-normal text-brand-dark mb-6 border-b border-brand-dark/[0.08] pb-3 flex items-center gap-2">
                <GraduationCap size={20} className="text-brand-accent" /> Образование и институты
              </h2>
              {pData?.education && pData.education.length > 0 ? (
                <div className="space-y-6">
                  {pData.education.map((edu) => (
                    <div key={edu.id} className="border-l-2 border-brand-dark/15 pl-4 sm:pl-5 space-y-1 hover:border-brand-accent transition-colors">
                      <h3 className="text-base font-bold text-brand-dark uppercase tracking-tight">{edu.school}</h3>
                      <p className="text-xs font-semibold text-brand-dark/80">
                        {edu.degree} {edu.fieldOfStudy ? `• ${edu.fieldOfStudy}` : ''}
                      </p>
                      <p className="text-xs font-mono text-brand-dark/60">{edu.startDate} {edu.endDate ? `– ${edu.endDate}` : ''}</p>
                      {edu.description && (
                        <p className="text-xs text-brand-dark/80 pt-1 leading-relaxed font-normal">{edu.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs font-mono font-semibold text-brand-dark/60 uppercase tracking-widest">
                  Сведения об образовании пока не указаны
                </p>
              )}
            </div>
          </div>
        )}

        {/* Tab 3: Portfolio */}
        {/* Tab: Direct Chat with Designer */}
        {activeTab === 'direct-chat' && (
          <div className="space-y-6 max-w-4xl animate-in fade-in duration-300">
            <div className="rounded-3xl border-2 border-brand-dark bg-brand-card p-6 sm:p-10 shadow-md space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-brand-dark/[0.08]">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 rounded-2xl bg-brand-action text-white flex items-center justify-center shrink-0 shadow-md">
                    <MessageSquare size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-brand-action text-white px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest rounded-full">
                        Official Direct Chat
                      </span>
                      <GoldenNeedleBadge size="xs" showLabel />
                    </div>
                    <h3 className="text-2xl sm:text-3xl font-serif font-bold text-brand-dark">
                      Direct Chat с дизайнером {profileUser.designerBrandName || profileUser.name}
                    </h3>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => navigate(`/messages?name=${encodeURIComponent(profileUser.designerBrandName || profileUser.brandName || profileUser.name || 'Designer')}&userId=${profileUser.id}`)}
                  className="px-6 py-3 rounded-full bg-brand-action text-white font-mono font-bold text-xs uppercase tracking-wider hover:bg-black transition-colors shadow-md flex items-center gap-2 shrink-0 cursor-pointer"
                >
                  <Send size={14} />
                  <span>Начать диалог в Direct Chat</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-brand-light rounded-2xl border border-brand-dark/10 space-y-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-dark/60 block">
                    Статус аккредитации:
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                    <strong className="text-brand-dark text-sm">Верифицированный модный дом</strong>
                  </div>
                  <p className="text-brand-dark/70 text-[11px] leading-relaxed">
                    Дизайнер прошел официальную проверку администрацией платформы и получил знак «Золотая Игла».
                  </p>
                </div>

                <div className="p-4 bg-brand-light rounded-2xl border border-brand-dark/10 space-y-2">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-brand-dark/60 block">
                    Сотрудничество & Заказы:
                  </span>
                  <p className="text-brand-dark text-[11px] leading-relaxed font-medium">
                    Канал открыт для индивидуального пошива, покупки коллекций, участия в показах и байерских предложений.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'portfolio' && (
          <div>
            {userPosts.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                {userPosts.map((post) => (
                  <div 
                    key={post.id} 
                    className="rounded-2xl border border-brand-dark/[0.08] bg-brand-card overflow-hidden group shadow-xs hover:border-brand-accent/30 hover:shadow-md transition-all"
                  >
                    <div 
                      className="aspect-square bg-brand-muted/40 relative cursor-pointer overflow-hidden"
                      onClick={() => setZoomImage({ url: post.imageUrl, caption: post.description })}
                    >
                      <SecureImage 
                        src={post.imageUrl} 
                        alt="Portfolio visual" 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                        crossOrigin="anonymous" 
                      />
                    </div>
                    {post.description && (
                      <div className="p-4 border-t border-brand-dark/[0.06]">
                        <p className="text-xs text-brand-dark/90 line-clamp-3 leading-relaxed font-normal">
                          {post.description}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-3xl border border-brand-dark/[0.08] bg-brand-card p-12 text-center shadow-xs">
                <Layers size={36} className="mx-auto text-brand-dark/30 mb-3" />
                <h3 className="text-lg font-serif font-normal text-brand-dark">Работы пока не опубликованы</h3>
                <p className="text-xs font-mono font-semibold text-brand-dark/60 uppercase tracking-widest mt-1">
                  Участник пока не добавил фотоработы в галерею
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {zoomImage && (
        <ImageZoomModal
          isOpen={true}
          imageUrl={zoomImage.url}
          caption={zoomImage.caption}
          onClose={() => setZoomImage(null)}
        />
      )}
    </div>
  );
}
