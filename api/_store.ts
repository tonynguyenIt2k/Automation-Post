function calculateSubscriptionExpiry(
  currentExpiresAt: string | null | undefined,
  rawMonths: number | string,
  now: Date = new Date(),
): string {
  const parsed = parseInt(String(rawMonths), 10);
  const months = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 36) : 1;
  let baseDate = new Date(now.getTime());
  if (currentExpiresAt) {
    const existing = new Date(currentExpiresAt);
    if (!Number.isNaN(existing.getTime()) && existing.getTime() > now.getTime()) {
      baseDate = existing;
    }
  }
  const next = new Date(baseDate.getTime());
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
}

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
  isLifetime?: boolean;
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
export const OWNER_ADMIN_UIDS = ['112937746933560753066', '113264177727144211176', 'demo-admin-01'];

function isAdminIdentity(role: string | undefined, email?: string, id?: string): boolean {
  if (role === 'admin') return true;
  if (email && OWNER_ADMIN_EMAILS.includes(email.toLowerCase())) return true;
  if (id && OWNER_ADMIN_UIDS.includes(id)) return true;
  return false;
}

function enforceAdminProSubscription(
  role: 'user' | 'admin',
  sub?: UserSubscription,
): UserSubscription {
  const base: UserSubscription = sub || {
    plan: 'free',
    expiresAt: null,
    status: 'active',
    history: [],
  };
  if (role === 'admin') {
    return {
      ...base,
      plan: 'pro',
      status: 'active',
      expiresAt: null,
      isLifetime: true,
      pendingPlan: null,
      pendingMonths: null,
      history: Array.isArray(base.history) ? base.history : [],
    };
  }
  return {
    ...base,
    isLifetime: false,
    history: Array.isArray(base.history) ? base.history : [],
  };
}

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
      picture: '',
      role: 'admin',
      createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
      subscription: {
        plan: 'pro',
        expiresAt: null,
        status: 'active',
        isLifetime: true,
        history: [],
      },
    },
  ],
  [
    'demo-user-pending-02',
    {
      id: 'demo-user-pending-02',
      name: 'Nguyễn Minh Quân',
      email: 'minhquan.mkt@gmail.com',
      picture: '',
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
      picture: '',
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

function normalizeStoredUser(user: StoredUser): StoredUser {
  const role: 'user' | 'admin' = isAdminIdentity(user.role, user.email, user.id) ? 'admin' : 'user';
  return {
    ...user,
    role,
    subscription: enforceAdminProSubscription(role, user.subscription),
  };
}

export function getUserById(id: string): StoredUser | undefined {
  const found = usersStore.get(id);
  return found ? normalizeStoredUser(found) : undefined;
}

export function listUsers(): StoredUser[] {
  return Array.from(usersStore.values()).map(normalizeStoredUser);
}

export function syncUser(body: Record<string, unknown>): StoredUser | null {
  const id = String(body.id || body.sub || '').trim();
  if (!id) return null;

  const existing = usersStore.get(id);
  const resolvedEmail = String(body.email || existing?.email || 'user@autopost.local');
  const resolvedRole: 'user' | 'admin' = isAdminIdentity(
    existing?.role || (body.role === 'admin' ? 'admin' : 'user'),
    resolvedEmail,
    id,
  )
    ? 'admin'
    : 'user';
  const rawName = String(body.name || existing?.name || 'Người dùng AutoPost');

  const rawSubscription =
    (body.subscription as UserSubscription | undefined) ||
    existing?.subscription || {
      plan: 'free',
      expiresAt: null,
      status: 'active',
      history: [],
    };

  const merged: StoredUser = {
    id,
    name: rawName,
    email: resolvedEmail,
    picture: String(body.picture || existing?.picture || ''),
    role: resolvedRole,
    createdAt: existing?.createdAt || new Date().toISOString(),
    subscription: enforceAdminProSubscription(resolvedRole, rawSubscription),
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

  user.subscription = enforceAdminProSubscription(user.role, {
    ...sub,
    plan: requestedPlan,
    status: 'active',
    expiresAt,
    pendingPlan: null,
    pendingMonths: null,
    history: updatedHistory,
  });
  usersStore.set(user.id, user);
  return normalizeStoredUser(user);
}

export function rejectUserSubscription(id: string): StoredUser | null {
  const user = usersStore.get(id);
  if (!user) return null;

  const sub = user.subscription;
  const now = new Date();
  const updatedHistory = (sub.history || []).map((h) =>
    h.status === 'pending' ? { ...h, status: 'rejected', date: now.toISOString() } : h,
  );

  user.subscription = enforceAdminProSubscription(user.role, {
    ...sub,
    status:
      sub.plan !== 'free' && sub.expiresAt && new Date(sub.expiresAt) <= now
        ? 'expired'
        : 'active',
    pendingPlan: null,
    pendingMonths: null,
    history: updatedHistory,
  });
  usersStore.set(user.id, user);
  return normalizeStoredUser(user);
}

export function updateAdminUser(id: string, body: Record<string, unknown>): StoredUser | null {
  const user = usersStore.get(id);
  if (!user) return null;

  const isOwner = isAdminIdentity(undefined, user.email, user.id);
  const role: 'user' | 'admin' = isOwner || body.role === 'admin' ? 'admin' : 'user';
  const now = new Date();

  if (role === 'admin') {
    user.role = 'admin';
    user.subscription = enforceAdminProSubscription('admin', user.subscription);
    usersStore.set(user.id, user);
    return normalizeStoredUser(user);
  }

  const rawPlan = String(body.plan || 'free');
  const plan: 'free' | 'pro' | 'enterprise' =
    rawPlan === 'pro' || rawPlan === 'enterprise' ? rawPlan : 'free';
  const rawStatus = String(body.status || 'active');
  const status: 'active' | 'pending' | 'expired' =
    rawStatus === 'pending' || rawStatus === 'expired' ? rawStatus : 'active';
  const safeMonths = Math.max(1, Math.min(36, parseInt(String(body.months ?? 1), 10) || 1));
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
    isLifetime: false,
    pendingPlan: null,
    pendingMonths: null,
    history: [historyEntry, ...(user.subscription.history || [])],
  };

  usersStore.set(user.id, user);
  return normalizeStoredUser(user);
}
