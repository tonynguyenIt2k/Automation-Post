import { calculateSubscriptionExpiry } from '../src/utils/autopost';

export interface SubscriptionHistoryEntry {
  id: number;
  plan: string;
  months: number;
  date: string;
  status: string;
  amount: number;
  note?: string;
}

export interface UserSubscription {
  plan: 'free' | 'pro' | 'enterprise';
  expiresAt: string | null;
  status: 'active' | 'pending' | 'expired';
  pendingPlan?: string | null;
  pendingMonths?: number | null;
  history: SubscriptionHistoryEntry[];
}

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  picture: string;
  role: 'user' | 'admin';
  createdAt: string;
  subscription: UserSubscription;
  collections?: Array<{ id: string; name: string; groupIds: string[] }>;
}

export interface SystemSettings {
  appName: string;
  logoUrl: string;
  bankName: string;
  bankNo: string;
  bankUser: string;
  qrTemplate: string;
}

export const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCvxzc0u0lxvY5JxEIWKOp59pAGb78ocdA',
  authDomain: 'autopost-8f16e.firebaseapp.com',
  databaseURL: 'https://autopost-8f16e-default-rtdb.firebaseio.com',
  projectId: 'autopost-8f16e',
  storageBucket: 'autopost-8f16e.firebasestorage.app',
  messagingSenderId: '213973905650',
  appId: '1:213973905650:web:4875b21b380eda1a2de06b',
};

export const OWNER_ADMIN_EMAILS = ['hungboa5075@gmail.com', 'admin@autopost.local'];

export function getFirebaseEnvConfig() {
  if (process.env.DISABLE_FIREBASE === 'true') {
    return null;
  }
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim() || DEFAULT_FIREBASE_CONFIG.projectId;
  return {
    apiKey: process.env.FIREBASE_API_KEY?.trim() || DEFAULT_FIREBASE_CONFIG.apiKey,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN?.trim() || DEFAULT_FIREBASE_CONFIG.authDomain,
    databaseURL: process.env.FIREBASE_DATABASE_URL?.trim() || DEFAULT_FIREBASE_CONFIG.databaseURL,
    projectId,
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET?.trim() || DEFAULT_FIREBASE_CONFIG.storageBucket,
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID?.trim() || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
    appId: process.env.FIREBASE_APP_ID?.trim() || DEFAULT_FIREBASE_CONFIG.appId,
  };
}

let systemSettings: SystemSettings = {
  appName: 'AutoPost Pro',
  logoUrl: '',
  bankName: 'mbbank',
  bankNo: '0987654321',
  bankUser: 'AUTOPOST PRO',
  qrTemplate: 'https://img.vietqr.io/image/mbbank-0987654321-compact.png',
};

const usersStore = new Map<string, StoredUser>([
  [
    'demo-admin-01',
    {
      id: 'demo-admin-01',
      name: 'Quản trị viên AutoPost',
      email: 'admin@autopost.local',
      picture: 'https://ui-avatars.com/api/?name=Admin+Pro&background=2563eb&color=ffffff',
      role: 'admin',
      createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
      subscription: {
        plan: 'enterprise',
        expiresAt: new Date(Date.now() + 86400000 * 180).toISOString(),
        status: 'active',
        history: [
          {
            id: 1700000001,
            plan: 'enterprise',
            months: 6,
            date: new Date(Date.now() - 86400000 * 10).toISOString(),
            status: 'approved',
            amount: 2994000,
          },
        ],
      },
    },
  ],
  [
    'demo-user-pending-02',
    {
      id: 'demo-user-pending-02',
      name: 'Nguyễn Minh Quân',
      email: 'minhquan.mkt@gmail.com',
      picture: 'https://ui-avatars.com/api/?name=Minh+Quan&background=0f766e&color=ffffff',
      role: 'user',
      createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      subscription: {
        plan: 'free',
        expiresAt: null,
        status: 'pending',
        pendingPlan: 'pro',
        pendingMonths: 3,
        history: [
          {
            id: 1700000002,
            plan: 'pro',
            months: 3,
            date: new Date(Date.now() - 3600000 * 2).toISOString(),
            status: 'pending',
            amount: 597000,
          },
        ],
      },
    },
  ],
  [
    'demo-user-pro-03',
    {
      id: 'demo-user-pro-03',
      name: 'Trần Thu Hà',
      email: 'thuha.shop@gmail.com',
      picture: 'https://ui-avatars.com/api/?name=Thu+Ha&background=7c3aed&color=ffffff',
      role: 'user',
      createdAt: new Date(Date.now() - 86400000 * 18).toISOString(),
      subscription: {
        plan: 'pro',
        expiresAt: new Date(Date.now() + 86400000 * 24).toISOString(),
        status: 'active',
        history: [
          {
            id: 1700000003,
            plan: 'pro',
            months: 1,
            date: new Date(Date.now() - 86400000 * 6).toISOString(),
            status: 'approved',
            amount: 199000,
          },
        ],
      },
    },
  ],
]);

export function getSettings(): SystemSettings {
  return systemSettings;
}

export function updateSettings(body: Record<string, unknown>): SystemSettings {
  const bankName = String(body.bankName || systemSettings.bankName || 'mbbank').trim();
  const bankNo = String(body.bankNo ?? systemSettings.bankNo ?? '').trim();
  systemSettings = {
    appName: String(body.appName || 'AutoPost Pro').trim() || 'AutoPost Pro',
    logoUrl: String(body.logoUrl || '').trim(),
    bankName,
    bankNo,
    bankUser: String(body.bankUser || '').trim(),
    qrTemplate:
      String(body.qrTemplate || '').trim() ||
      `https://img.vietqr.io/image/${bankName}-${bankNo}-compact.png`,
  };
  return systemSettings;
}

export function getUserById(id: string): StoredUser | undefined {
  return usersStore.get(id);
}

export function listUsers(): StoredUser[] {
  return Array.from(usersStore.values());
}

export function syncUser(body: Record<string, unknown>): StoredUser | null {
  const id = String(body.id || body.sub || '').trim();
  if (!id) return null;

  const existing = usersStore.get(id);
  const resolvedEmail = String(body.email || existing?.email || 'user@autopost.local');
  const isOwnerAdmin = OWNER_ADMIN_EMAILS.includes(resolvedEmail.toLowerCase());
  const rawName = String(body.name || existing?.name || 'Người dùng AutoPost');

  const merged: StoredUser = {
    id,
    name: rawName,
    email: resolvedEmail,
    picture:
      String(body.picture || existing?.picture || '') ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(rawName || 'U')}&background=2563eb&color=fff`,
    role: isOwnerAdmin ? 'admin' : existing?.role || (body.role === 'admin' ? 'admin' : 'user'),
    createdAt: existing?.createdAt || new Date().toISOString(),
    subscription:
      (body.subscription as UserSubscription | undefined) ||
      existing?.subscription || {
        plan: 'free',
        expiresAt: null,
        status: 'active',
        history: [],
      },
    collections: Array.isArray(body.collections)
      ? (body.collections as Array<{ id: string; name: string; groupIds: string[] }>)
      : existing?.collections || [],
  };

  usersStore.set(id, merged);
  return merged;
}

export function approveUserSubscription(id: string): StoredUser | null {
  const user = usersStore.get(id);
  if (!user) return null;

  const sub = user.subscription;
  const now = new Date();
  const requestedPlan = (sub.pendingPlan as 'pro' | 'enterprise') || 'pro';
  const requestedMonths = Math.max(1, parseInt(String(sub.pendingMonths || 1), 10) || 1);
  const expiresAt = calculateSubscriptionExpiry(sub.expiresAt, requestedMonths, now);

  const updatedHistory = (sub.history || []).map((h) =>
    h.status === 'pending' ? { ...h, status: 'approved', date: now.toISOString() } : h,
  );

  user.subscription = {
    ...sub,
    plan: requestedPlan,
    status: 'active',
    expiresAt,
    pendingPlan: null,
    pendingMonths: null,
    history: updatedHistory,
  };
  usersStore.set(user.id, user);
  return user;
}

export function rejectUserSubscription(id: string): StoredUser | null {
  const user = usersStore.get(id);
  if (!user) return null;

  const sub = user.subscription;
  const now = new Date();
  const updatedHistory = (sub.history || []).map((h) =>
    h.status === 'pending' ? { ...h, status: 'rejected', date: now.toISOString() } : h,
  );

  user.subscription = {
    ...sub,
    status:
      sub.plan !== 'free' && sub.expiresAt && new Date(sub.expiresAt) <= now
        ? 'expired'
        : 'active',
    pendingPlan: null,
    pendingMonths: null,
    history: updatedHistory,
  };
  usersStore.set(user.id, user);
  return user;
}

export function updateAdminUser(id: string, body: Record<string, unknown>): StoredUser | null {
  const user = usersStore.get(id);
  if (!user) return null;

  const rawPlan = String(body.plan || 'free');
  const plan: 'free' | 'pro' | 'enterprise' =
    rawPlan === 'pro' || rawPlan === 'enterprise' ? rawPlan : 'free';
  const rawStatus = String(body.status || 'active');
  const status: 'active' | 'pending' | 'expired' =
    rawStatus === 'pending' || rawStatus === 'expired' ? rawStatus : 'active';
  const role = body.role === 'admin' ? 'admin' : 'user';
  const safeMonths = Math.max(1, Math.min(36, parseInt(String(body.months ?? 1), 10) || 1));
  const now = new Date();
  const expiresAt = plan !== 'free' ? calculateSubscriptionExpiry(null, safeMonths, now) : null;

  const historyEntry: SubscriptionHistoryEntry = {
    id: Date.now(),
    plan,
    months: safeMonths,
    date: now.toISOString(),
    status: status === 'active' ? 'approved' : status,
    amount: plan === 'pro' ? safeMonths * 199000 : plan === 'enterprise' ? safeMonths * 499000 : 0,
    note: 'Admin edited',
  };

  user.role = role;
  user.subscription = {
    ...user.subscription,
    plan,
    status,
    expiresAt,
    pendingPlan: null,
    pendingMonths: null,
    history: [historyEntry, ...(user.subscription.history || [])],
  };

  usersStore.set(user.id, user);
  return user;
}
