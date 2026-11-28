const { useState, useEffect, useMemo, useRef, useCallback } = React;

const ADMIN_UIDS = ['112937746933560753066', '113264177727144211176', 'demo-admin-01'];
const ADMIN_EMAILS = ['hungboa5075@gmail.com', 'admin@autopost.local'];

const BANK_OPTIONS = [
    { code: 'mbbank', label: 'MB Bank (Quân Đội)' },
    { code: 'vietcombank', label: 'Vietcombank (VCB)' },
    { code: 'techcombank', label: 'Techcombank' },
    { code: 'vietinbank', label: 'VietinBank' },
    { code: 'bidv', label: 'BIDV' },
    { code: 'acb', label: 'ACB' },
    { code: 'agribank', label: 'Agribank' },
    { code: 'vpbank', label: 'VPBank' },
    { code: 'tpbank', label: 'TPBank' },
    { code: 'sacombank', label: 'Sacombank' },
    { code: 'vib', label: 'VIB' },
    { code: 'shb', label: 'SHB' },
    { code: 'hdbank', label: 'HDBank' },
    { code: 'msb', label: 'MSB' },
    { code: 'ocb', label: 'OCB' },
];

let rtdb = null;
let auth = null;

function isOwnerAdminRecord(u) {
    if (!u) return false;
    const id = u.id || u.uid || '';
    const email = (u.email || '').toLowerCase();
    return ADMIN_UIDS.indexOf(id) !== -1 || (email && ADMIN_EMAILS.indexOf(email) !== -1);
}

function isAdminAccount(u) {
    if (!u) return false;
    return u.role === 'admin' || isOwnerAdminRecord(u);
}

function getEffectiveSubscription(u) {
    const raw = (u && u.subscription) || {};
    const history = Array.isArray(raw.history) ? raw.history : [];
    if (isAdminAccount(u)) {
        return {
            ...raw,
            plan: 'pro',
            status: 'active',
            expiresAt: null,
            isLifetime: true,
            pendingPlan: null,
            pendingMonths: null,
            history,
        };
    }
    const expDate = raw.expiresAt ? new Date(raw.expiresAt) : null;
    const computedExpired =
        raw.status !== 'pending' &&
        raw.plan &&
        raw.plan !== 'free' &&
        expDate &&
        !isNaN(expDate.getTime()) &&
        expDate.getTime() <= Date.now();
    return {
        plan: raw.plan || 'free',
        status: computedExpired ? 'expired' : (raw.status || 'active'),
        expiresAt: raw.expiresAt || null,
        isLifetime: false,
        pendingPlan: raw.pendingPlan || null,
        pendingMonths: raw.pendingMonths || null,
        history,
    };
}

function getInitials(name, email) {
    const source = (name || email || 'U').trim();
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
}

function formatCurrency(amount) {
    const num = Number(amount) || 0;
    try {
        return num.toLocaleString('vi-VN') + '₫';
    } catch (e) {
        return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '₫';
    }
}

function formatShortDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    try {
        return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
        return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
    }
}

function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    try {
        return d.toLocaleString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (e) {
        return formatShortDate(iso);
    }
}

function UserAvatar({ name, email, src, isAdmin = false, size = 'md' }) {
    const [imgFailed, setImgFailed] = useState(false);
    const sizeCls = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-9 h-9 text-xs';
    const hasValidSrc = Boolean(src) && src.indexOf('ui-avatars.com') === -1 && !imgFailed;

    if (hasValidSrc) {
        return (
            <img
                src={src}
                alt={name || 'Avatar'}
                onError={() => setImgFailed(true)}
                className={`${sizeCls} rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100`}
            />
        );
    }

    return (
        <div
            className={`${sizeCls} rounded-lg flex items-center justify-center font-bold shrink-0 border ${
                isAdmin
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}
        >
            {getInitials(name, email)}
        </div>
    );
}

function StatusText({ status, isAdmin }) {
    if (isAdmin) {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0"></span>
                Hoạt động
            </span>
        );
    }
    if (status === 'pending') {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
                Chờ duyệt
            </span>
        );
    }
    if (status === 'expired') {
        return (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-600 shrink-0"></span>
                Hết hạn
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 shrink-0"></span>
            Hoạt động
        </span>
    );
}

function App() {
    const [adminUser, setAdminUser] = useState(null);
    const [firebaseReady, setFirebaseReady] = useState(false);
    const [useFirebaseMode, setUseFirebaseMode] = useState(false);
    const [showDomainHelper, setShowDomainHelper] = useState(false);
    const [copiedDomain, setCopiedDomain] = useState(false);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [tab, setTab] = useState('overview');
    const [search, setSearch] = useState('');
    const [filterPlan, setFilterPlan] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterRole, setFilterRole] = useState('all');
    const [editModal, setEditModal] = useState(null);
    const [savingSettings, setSavingSettings] = useState(false);
    const [savingUser, setSavingUser] = useState(false);
    const [toast, setToast] = useState(null);
    const toastTimerRef = useRef(null);

    const [settings, setSettings] = useState({
        appName: 'AutoPost Pro',
        logoUrl: '',
        bankName: 'mbbank',
        bankNo: '',
        bankUser: '',
        qrTemplate: '',
    });

    const [showAdminDropdown, setShowAdminDropdown] = useState(false);
    const [showMobileSidebar, setShowMobileSidebar] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        function handleClickOutside(event) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowAdminDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('touchstart', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, []);

    const showToast = useCallback((msg, type = 'success') => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ msg, type });
        toastTimerRef.current = setTimeout(() => setToast(null), 3500);
    }, []);

    useEffect(() => {
        if (settings.appName) {
            document.title = `Quản trị — ${settings.appName}`;
        }
    }, [settings.appName]);

    // Bootstrap Firebase config & restore local admin session
    useEffect(() => {
        let unsub = null;
        let cancelled = false;

        const init = async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const savedLocalAdmin = localStorage.getItem('autopost_local_admin');
                if (params.get('autostart') === '1' || savedLocalAdmin === 'true') {
                    setAdminUser({
                        uid: 'demo-admin-01',
                        displayName: 'Quản trị viên AutoPost',
                        email: 'admin@autopost.local',
                        photoURL: '',
                        isLocal: true,
                    });
                }
            } catch (e) {}

            const DEFAULT_FIREBASE_CONFIG = {
                apiKey: 'AIzaSyCvxzc0u0lxvY5JxEIWKOp59pAGb78ocdA',
                authDomain: 'autopost-8f16e.firebaseapp.com',
                databaseURL: 'https://autopost-8f16e-default-rtdb.firebaseio.com',
                projectId: 'autopost-8f16e',
                storageBucket: 'autopost-8f16e.firebasestorage.app',
                messagingSenderId: '213973905650',
                appId: '1:213973905650:web:4875b21b380eda1a2de06b',
            };

            try {
                let activeConfig = DEFAULT_FIREBASE_CONFIG;
                const res = await fetch('/api/firebase-config').catch(() => null);
                if (res && res.ok) {
                    const data = await res.json();
                    if (data.configured && data.config) {
                        activeConfig = data.config;
                    } else if (data.configured === false) {
                        activeConfig = null;
                    }
                }

                if (!cancelled && activeConfig && typeof firebase !== 'undefined') {
                    if (!firebase.apps.length) firebase.initializeApp(activeConfig);
                    rtdb = firebase.database();
                    auth = firebase.auth();
                    setUseFirebaseMode(true);

                    // Handle redirect result for legacy iOS Safari / WKWebView
                    if (typeof auth.getRedirectResult === 'function') {
                        auth.getRedirectResult().catch((err) => {
                            if (err && err.code === 'auth/unauthorized-domain') {
                                setShowDomainHelper(true);
                                showToast('Tên miền chưa được cấp quyền trong Firebase autopost-8f16e.', 'error');
                            }
                        });
                    }

                    unsub = auth.onAuthStateChanged((user) => {
                        if (user) {
                            setLoading(true);
                            rtdb.ref('users/' + user.uid).once('value').then((snapshot) => {
                                const val = snapshot.val();
                                const providerData = Array.isArray(user.providerData) ? user.providerData : [];
                                const isHardcodedAdmin =
                                    ADMIN_UIDS.indexOf(user.uid) !== -1 ||
                                    providerData.some((p) => p && ADMIN_UIDS.indexOf(p.uid) !== -1) ||
                                    (user.email && ADMIN_EMAILS.indexOf(user.email.toLowerCase()) !== -1);

                                if ((val && val.role === 'admin') || isHardcodedAdmin) {
                                    if (isHardcodedAdmin && (!val || val.role !== 'admin')) {
                                        rtdb.ref('users/' + user.uid + '/role').set('admin').catch(() => {});
                                    }
                                    const existingSub = (val && val.subscription) || {};
                                    if (
                                        existingSub.plan !== 'pro' ||
                                        existingSub.status !== 'active' ||
                                        existingSub.expiresAt !== null ||
                                        !existingSub.isLifetime
                                    ) {
                                        rtdb.ref('users/' + user.uid + '/subscription').set({
                                            ...existingSub,
                                            plan: 'pro',
                                            status: 'active',
                                            expiresAt: null,
                                            isLifetime: true,
                                            pendingPlan: null,
                                            pendingMonths: null,
                                            history: Array.isArray(existingSub.history) ? existingSub.history : [],
                                        }).catch(() => {});
                                    }
                                    setAdminUser(user);
                                } else {
                                    showToast('Tài khoản của bạn không có quyền truy cập trang quản trị.', 'error');
                                    auth.signOut();
                                    setAdminUser(null);
                                }
                                setLoading(false);
                            }).catch((err) => {
                                console.error(err);
                                showToast('Lỗi kiểm tra quyền hạn cơ sở dữ liệu.', 'error');
                                setLoading(false);
                            });
                        }
                    });
                }
            } catch (err) {
                console.warn('Firebase config check skipped:', err);
            } finally {
                if (!cancelled) setFirebaseReady(true);
            }
        };

        init();
        return () => {
            cancelled = true;
            if (typeof unsub === 'function') unsub();
        };
    }, [showToast]);

    const handleCopyCurrentDomain = () => {
        const host = window.location.hostname || window.location.host;
        const done = () => {
            setCopiedDomain(true);
            showToast('Đã sao chép tên miền: ' + host, 'success');
            setTimeout(() => setCopiedDomain(false), 2000);
        };
        const fallbackCopy = () => {
            const ta = document.createElement('textarea');
            ta.value = host;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '0';
            ta.style.left = '0';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { ta.setSelectionRange(0, host.length); } catch (e) {}
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            done();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(host).then(done).catch(fallbackCopy);
        } else {
            fallbackCopy();
        }
    };

    const handleLogin = async () => {
        if (!auth) {
            showToast('Firebase Google Auth chưa sẵn sàng — hãy dùng đăng nhập Local / Demo bên dưới.', 'error');
            return;
        }
        const provider = new firebase.auth.GoogleAuthProvider();
        try {
            await auth.signInWithPopup(provider);
        } catch (e) {
            const code = (e && e.code) || '';
            if (code === 'auth/unauthorized-domain') {
                setShowDomainHelper(true);
                showToast('Tên miền chưa được cấp quyền trong Firebase autopost-8f16e.', 'error');
            } else if (
                window.__IS_IOS_BROWSER__ &&
                (code === 'auth/popup-blocked' ||
                    code === 'auth/operation-not-supported-in-this-environment' ||
                    code === 'auth/popup-closed-by-user')
            ) {
                try {
                    showToast('Đang chuyển hướng đăng nhập Google tương thích iOS...', 'info');
                    await auth.signInWithRedirect(provider);
                } catch (redirErr) {
                    showToast('Lỗi đăng nhập Google: ' + ((redirErr && redirErr.message) || code), 'error');
                }
            } else {
                showToast('Lỗi đăng nhập Google: ' + ((e && e.message) || code), 'error');
            }
        }
    };

    const handleLocalAdminLogin = () => {
        try { localStorage.setItem('autopost_local_admin', 'true'); } catch (e) {}
        setAdminUser({
            uid: 'demo-admin-01',
            displayName: 'Quản trị viên AutoPost',
            email: 'admin@autopost.local',
            photoURL: '',
            isLocal: true,
        });
        showToast('Đã đăng nhập quản trị chế độ cục bộ.', 'success');
    };

    const handleSignOut = () => {
        try { localStorage.removeItem('autopost_local_admin'); } catch (e) {}
        if (auth && !(adminUser && adminUser.isLocal)) {
            auth.signOut().catch(() => {});
        }
        setAdminUser(null);
        setShowAdminDropdown(false);
    };

    const refreshLocalData = useCallback(async () => {
        try {
            setLoading(true);
            const [uRes, sRes] = await Promise.all([
                fetch('/api/admin/users'),
                fetch('/api/settings'),
            ]);
            if (uRes.ok) {
                const list = await uRes.json();
                setUsers(Array.isArray(list) ? list : []);
            }
            if (sRes.ok) {
                const val = await sRes.json();
                if (val) {
                    setSettings({
                        appName: val.appName || 'AutoPost Pro',
                        logoUrl: val.logoUrl || '',
                        bankName: val.bankName || 'mbbank',
                        bankNo: val.bankNo || '',
                        bankUser: val.bankUser || '',
                        qrTemplate: val.qrTemplate || '',
                    });
                }
            }
        } catch (err) {
            console.error(err);
            showToast('Lỗi tải dữ liệu từ máy chủ.', 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        if (!adminUser) return;

        if (useFirebaseMode && rtdb && !adminUser.isLocal) {
            const settingsRef = rtdb.ref('settings');
            const onSettingsVal = settingsRef.on('value', (snapshot) => {
                const val = snapshot.val();
                if (val) {
                    setSettings({
                        appName: val.appName || 'AutoPost Pro',
                        logoUrl: val.logoUrl || '',
                        bankName: val.bankName || 'mbbank',
                        bankNo: val.bankNo || '',
                        bankUser: val.bankUser || '',
                        qrTemplate: val.qrTemplate || '',
                    });
                }
            });

            setLoading(true);
            const usersRef = rtdb.ref('users');
            const onValue = usersRef.on('value', (snapshot) => {
                const data = snapshot.val() || {};
                const list = Object.keys(data).map((key) => ({ id: key, ...data[key] }));
                setUsers(list);
                setLoading(false);
            }, (err) => {
                console.error(err);
                showToast('Lỗi kết nối Realtime Database.', 'error');
                setLoading(false);
            });

            return () => {
                settingsRef.off('value', onSettingsVal);
                usersRef.off('value', onValue);
            };
        } else {
            refreshLocalData();
        }
    }, [adminUser, useFirebaseMode, refreshLocalData, showToast]);

    const normalizedUsers = useMemo(() => {
        return users.map((u) => {
            const admin = isAdminAccount(u);
            return {
                ...u,
                _isAdmin: admin,
                _isOwner: isOwnerAdminRecord(u),
                _role: admin ? 'admin' : 'user',
                _sub: getEffectiveSubscription(u),
            };
        });
    }, [users]);

    const stats = useMemo(() => {
        let total = normalizedUsers.length;
        let pending = 0;
        let activePaid = 0;
        let adminCount = 0;
        let freeCount = 0;
        let proUserCount = 0;
        let enterpriseCount = 0;
        let expiredCount = 0;
        let revenue = 0;

        normalizedUsers.forEach((u) => {
            const sub = u._sub;
            if (u._isAdmin) {
                adminCount++;
                activePaid++;
            } else {
                if (sub.status === 'pending') pending++;
                if (sub.status === 'expired') expiredCount++;
                if (sub.plan === 'pro') {
                    proUserCount++;
                    if (sub.status === 'active') activePaid++;
                } else if (sub.plan === 'enterprise') {
                    enterpriseCount++;
                    if (sub.status === 'active') activePaid++;
                } else {
                    freeCount++;
                }
            }

            (sub.history || []).forEach((h) => {
                if (h && h.status === 'approved') {
                    revenue += Number(h.amount) || 0;
                }
            });
        });

        return {
            total,
            pending,
            activePaid,
            adminCount,
            freeCount,
            proUserCount,
            enterpriseCount,
            expiredCount,
            revenue,
        };
    }, [normalizedUsers]);

    const pendingUsers = useMemo(() => {
        return normalizedUsers
            .filter((u) => !u._isAdmin && u._sub.status === 'pending')
            .sort((a, b) => {
                const aHist = (a._sub.history && a._sub.history[0]) || null;
                const bHist = (b._sub.history && b._sub.history[0]) || null;
                const aTime = new Date((aHist && aHist.date) || 0).getTime();
                const bTime = new Date((bHist && bHist.date) || 0).getTime();
                return bTime - aTime;
            });
    }, [normalizedUsers]);

    const adminAccounts = useMemo(() => {
        return normalizedUsers.filter((u) => u._isAdmin);
    }, [normalizedUsers]);

    const filteredUsers = useMemo(() => {
        const term = search.trim().toLowerCase();
        return normalizedUsers
            .filter((u) => {
                const sub = u._sub;
                if (tab === 'pending' && (u._isAdmin || sub.status !== 'pending')) return false;
                if (filterPlan !== 'all' && sub.plan !== filterPlan) return false;
                if (tab === 'all' && filterStatus !== 'all' && sub.status !== filterStatus) return false;
                if (tab === 'all' && filterRole !== 'all' && u._role !== filterRole) return false;
                if (!term) return true;
                const name = (u.name || '').toLowerCase();
                const email = (u.email || '').toLowerCase();
                const id = (u.id || '').toLowerCase();
                return name.indexOf(term) !== -1 || email.indexOf(term) !== -1 || id.indexOf(term) !== -1;
            })
            .sort((a, b) => {
                const aPend = a._sub.status === 'pending' ? 2 : a._isAdmin ? 1 : 0;
                const bPend = b._sub.status === 'pending' ? 2 : b._isAdmin ? 1 : 0;
                if (bPend !== aPend) return bPend - aPend;
                return (a.name || '').localeCompare(b.name || '', 'vi');
            });
    }, [normalizedUsers, tab, search, filterPlan, filterStatus, filterRole]);

    const handleApprove = async (userId) => {
        const user = users.find((u) => u.id === userId);
        if (!user) return;

        try {
            if (useFirebaseMode && rtdb && !(adminUser && adminUser.isLocal)) {
                const sub = user.subscription || {};
                const now = new Date();
                const baseDate = sub.expiresAt && new Date(sub.expiresAt) > now ? new Date(sub.expiresAt) : new Date(now);
                const requestedPlan = sub.pendingPlan || 'pro';
                const requestedMonths = Math.max(1, parseInt(sub.pendingMonths || 1, 10) || 1);
                baseDate.setMonth(baseDate.getMonth() + requestedMonths);

                const updatedHistory = (sub.history || []).map((h) =>
                    h.status === 'pending' ? { ...h, status: 'approved', date: now.toISOString() } : h
                );

                const updatedSub = {
                    ...sub,
                    plan: requestedPlan,
                    status: 'active',
                    expiresAt: baseDate.toISOString(),
                    isLifetime: false,
                    pendingPlan: null,
                    pendingMonths: null,
                    history: updatedHistory,
                };
                await rtdb.ref('users/' + userId + '/subscription').set(updatedSub);
            } else {
                const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/approve`, { method: 'POST' });
                if (!res.ok) throw new Error('Không thể duyệt yêu cầu');
                await refreshLocalData();
            }
            showToast('Đã duyệt nâng cấp gói dịch vụ thành công.', 'success');
        } catch (err) {
            showToast('Lỗi duyệt yêu cầu: ' + ((err && err.message) || ''), 'error');
        }
    };

    const handleReject = async (userId) => {
        const user = users.find((u) => u.id === userId);
        if (!user) return;

        try {
            if (useFirebaseMode && rtdb && !(adminUser && adminUser.isLocal)) {
                const sub = user.subscription || {};
                const now = new Date();
                const updatedHistory = (sub.history || []).map((h) =>
                    h.status === 'pending' ? { ...h, status: 'rejected', date: now.toISOString() } : h
                );
                const stillExpired = sub.plan && sub.plan !== 'free' && sub.expiresAt && new Date(sub.expiresAt) <= now;
                const updatedSub = {
                    ...sub,
                    status: stillExpired ? 'expired' : 'active',
                    pendingPlan: null,
                    pendingMonths: null,
                    history: updatedHistory,
                };
                await rtdb.ref('users/' + userId + '/subscription').set(updatedSub);
            } else {
                const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/reject`, { method: 'POST' });
                if (!res.ok) throw new Error('Không thể từ chối yêu cầu');
                await refreshLocalData();
            }
            showToast('Đã từ chối yêu cầu nâng cấp.', 'info');
        } catch (err) {
            showToast('Lỗi từ chối yêu cầu: ' + ((err && err.message) || ''), 'error');
        }
    };

    const openEditModal = (u) => {
        const latest = (u._sub.history || [])[0];
        setEditModal({
            userId: u.id,
            name: u.name || 'Thành viên',
            email: u.email || u.id,
            picture: u.picture || '',
            isOwner: u._isOwner,
            role: u._role,
            plan: u._isAdmin ? 'pro' : (u._sub.plan || 'free'),
            months: (latest && latest.months) || 1,
            status: u._isAdmin ? 'active' : (u._sub.status || 'active'),
        });
    };

    const handleEditSave = async () => {
        if (!editModal) return;
        const user = users.find((u) => u.id === editModal.userId);
        if (!user) return;

        const finalRole = editModal.isOwner ? 'admin' : (editModal.role === 'admin' ? 'admin' : 'user');
        const isBecomingAdmin = finalRole === 'admin';
        const safeMonths = Math.max(1, Math.min(36, parseInt(editModal.months, 10) || 1));

        setSavingUser(true);
        try {
            if (useFirebaseMode && rtdb && !(adminUser && adminUser.isLocal)) {
                const now = new Date();
                if (isBecomingAdmin) {
                    const existingHistory = (user.subscription && Array.isArray(user.subscription.history)) ? user.subscription.history : [];
                    const adminSub = {
                        ...(user.subscription || {}),
                        plan: 'pro',
                        status: 'active',
                        expiresAt: null,
                        isLifetime: true,
                        pendingPlan: null,
                        pendingMonths: null,
                        history: existingHistory,
                    };
                    await rtdb.ref('users/' + editModal.userId + '/subscription').set(adminSub);
                    await rtdb.ref('users/' + editModal.userId + '/role').set('admin');
                } else {
                    let expiresAt = null;
                    if (editModal.plan !== 'free' && safeMonths > 0) {
                        const exp = new Date(now);
                        exp.setMonth(exp.getMonth() + safeMonths);
                        expiresAt = exp.toISOString();
                    }
                    const historyEntry = {
                        id: Date.now(),
                        plan: editModal.plan,
                        months: safeMonths,
                        date: now.toISOString(),
                        status: editModal.status === 'active' ? 'approved' : editModal.status,
                        amount: editModal.plan === 'pro' ? safeMonths * 199000 : editModal.plan === 'enterprise' ? safeMonths * 499000 : 0,
                        note: 'Admin edited',
                    };
                    const prevHistory = (user.subscription && Array.isArray(user.subscription.history)) ? user.subscription.history : [];
                    const sub = {
                        ...(user.subscription || {}),
                        plan: editModal.plan,
                        status: editModal.status,
                        expiresAt,
                        isLifetime: false,
                        pendingPlan: null,
                        pendingMonths: null,
                        history: [historyEntry, ...prevHistory],
                    };
                    await rtdb.ref('users/' + editModal.userId + '/subscription').set(sub);
                    await rtdb.ref('users/' + editModal.userId + '/role').set('user');
                }
            } else {
                const payload = isBecomingAdmin
                    ? { role: 'admin', plan: 'pro', status: 'active', months: 0 }
                    : { role: 'user', plan: editModal.plan, status: editModal.status, months: safeMonths };
                const res = await fetch(`/api/admin/users/${encodeURIComponent(editModal.userId)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) throw new Error('Không thể cập nhật người dùng');
                await refreshLocalData();
            }
            setEditModal(null);
            showToast(
                isBecomingAdmin
                    ? 'Đã lưu quyền Admin — tự động kích hoạt Pro vĩnh viễn.'
                    : 'Đã cập nhật thông tin thành viên thành công.',
                'success'
            );
        } catch (err) {
            showToast('Lỗi cập nhật: ' + ((err && err.message) || ''), 'error');
        } finally {
            setSavingUser(false);
        }
    };

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        setSavingSettings(true);
        try {
            if (useFirebaseMode && rtdb && !(adminUser && adminUser.isLocal)) {
                await rtdb.ref('settings').set(settings);
            } else {
                const res = await fetch('/api/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings),
                });
                if (!res.ok) throw new Error('Không thể lưu cấu hình lên máy chủ');
            }
            showToast('Đã lưu cấu hình hệ thống thành công.', 'success');
        } catch (error) {
            showToast('Lỗi lưu cấu hình: ' + ((error && error.message) || ''), 'error');
        } finally {
            setSavingSettings(false);
        }
    };

    const resetFilters = () => {
        setSearch('');
        setFilterPlan('all');
        setFilterStatus('all');
        setFilterRole('all');
    };

    const navItems = [
        { id: 'overview', label: 'Tổng quan', icon: 'space_dashboard' },
        { id: 'pending', label: 'Đơn chờ duyệt', icon: 'pending_actions', badge: stats.pending },
        { id: 'all', label: 'Thành viên', icon: 'group', count: stats.total },
        { id: 'settings', label: 'Cấu hình hệ thống', icon: 'tune' },
    ];

    const currentSection = navItems.find((item) => item.id === tab);
    const currentSectionLabel = (currentSection && currentSection.label) || 'Tổng quan';

    const renderSidebarContent = () => (
        <div className="flex flex-col h-full text-slate-300">
            <div className="flex items-center gap-3 px-3 py-2 mb-6">
                {settings.logoUrl ? (
                    <img
                        src={settings.logoUrl}
                        alt={settings.appName}
                        className="w-9 h-9 rounded-lg object-cover border border-slate-700 shrink-0"
                    />
                ) : (
                    <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shrink-0">
                        <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
                    </div>
                )}
                <div className="min-w-0">
                    <h1 className="text-sm font-bold text-white leading-tight truncate">
                        {settings.appName || 'AutoPost Pro'}
                    </h1>
                    <p className="text-[11px] text-slate-400 font-medium truncate">Quản trị hệ thống</p>
                </div>
            </div>

            <div className="px-3 mb-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Điều hành
                </span>
            </div>
            <nav className="flex-1 flex flex-col gap-1">
                {navItems.map((item) => {
                    const active = tab === item.id;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                                setTab(item.id);
                                setShowMobileSidebar(false);
                            }}
                            className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                                active
                                    ? 'bg-slate-800 text-white font-semibold'
                                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
                            }`}
                        >
                            <span className="flex items-center gap-2.5 min-w-0">
                                <span className={`material-symbols-outlined text-[19px] shrink-0 ${active ? 'text-blue-400' : 'text-slate-500'}`}>
                                    {item.icon}
                                </span>
                                <span className="truncate">{item.label}</span>
                            </span>
                            {item.badge > 0 && (
                                <span className="font-mono tabular-nums text-[11px] font-bold px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 shrink-0">
                                    {item.badge}
                                </span>
                            )}
                            {item.count !== undefined && !item.badge && (
                                <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                                    {item.count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </nav>

            <div className="mx-1 mb-4 px-3 py-2.5 rounded-lg bg-slate-800/70 border border-slate-700/80">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                    <span className="material-symbols-outlined text-[15px] text-emerald-400">verified</span>
                    <span>Admin · Pro Vĩnh viễn</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Mọi tài khoản quyền Admin luôn hoạt động ở gói Pro không thời hạn.
                </p>
            </div>

            <div className="border-t border-slate-800 pt-3 flex flex-col gap-1">
                <a
                    href="/"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
                >
                    <span className="material-symbols-outlined text-[17px]">arrow_back</span>
                    <span>Về trang ứng dụng</span>
                </a>
                <button
                    type="button"
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors text-left"
                >
                    <span className="material-symbols-outlined text-[17px]">logout</span>
                    <span>Đăng xuất</span>
                </button>
            </div>
        </div>
    );

    if (!adminUser) {
        return (
            <div className="min-h-[100dvh] w-full overflow-y-auto bg-slate-50 flex flex-col items-center justify-center p-4 py-8">
                <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 animate-enter">
                    <div className="flex items-center gap-3 pb-6 border-b border-slate-200">
                        <div className="w-11 h-11 rounded-xl bg-slate-900 flex items-center justify-center text-white shrink-0">
                            <span className="material-symbols-outlined text-[24px]">admin_panel_settings</span>
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-slate-900 leading-tight truncate">
                                {settings.appName || 'AutoPost Pro'}
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">Cổng quản trị thành viên &amp; doanh thu</p>
                        </div>
                    </div>

                    <div className="py-5 space-y-2.5 text-xs text-slate-600 border-b border-slate-100">
                        <div className="flex items-start gap-2.5">
                            <span className="material-symbols-outlined text-[17px] text-blue-600 shrink-0 mt-0.5">shield_person</span>
                            <span>Chỉ tài khoản có quyền <strong>Admin</strong> mới được phép truy cập bảng điều khiển.</span>
                        </div>
                        <div className="flex items-start gap-2.5">
                            <span className="material-symbols-outlined text-[17px] text-emerald-600 shrink-0 mt-0.5">all_inclusive</span>
                            <span>Tài khoản Admin tự động kích hoạt gói <strong>Pro vĩnh viễn</strong>, không cần gia hạn.</span>
                        </div>
                    </div>

                    <div className="pt-5 space-y-3">
                        {useFirebaseMode && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleLogin}
                                    className="w-full min-h-[46px] flex items-center justify-center gap-2.5 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
                                >
                                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                                        <path fill="#EA4335" d="M12 5.04c1.66 0 3.2.57 4.38 1.69l3.27-3.27C17.67 1.54 14.98 1 12 1 7.35 1 3.37 3.65 1.4 7.56l3.89 3.02C6.21 7.37 8.9 5.04 12 5.04z"/>
                                        <path fill="#4285F4" d="M23.49 12.27c0-.81-.07-1.59-.2-2.36H12v4.47h6.46c-.28 1.47-1.11 2.71-2.36 3.55l3.66 2.84c2.14-1.97 3.37-4.87 3.37-8.5z"/>
                                        <path fill="#FBBC05" d="M5.29 14.54a7.12 7.12 0 0 1 0-4.54L1.4 6.98A11.96 11.96 0 0 0 1 12c0 1.76.38 3.43 1.05 4.93l3.24-2.39z"/>
                                        <path fill="#34A853" d="M12 23c3.24 0 5.97-1.07 7.96-2.91l-3.66-2.84c-1.01.68-2.31 1.09-4.3 1.09-3.1 0-5.79-2.33-6.71-5.54l-3.89 3.02C3.37 20.35 7.35 23 12 23z"/>
                                    </svg>
                                    <span>Đăng nhập Admin với Google</span>
                                </button>

                                <div className="text-center">
                                    <button
                                        type="button"
                                        onClick={() => setShowDomainHelper((prev) => !prev)}
                                        className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline py-1"
                                    >
                                        <span className="material-symbols-outlined text-[15px]">help</span>
                                        <span>Cấp quyền tên miền Firebase (autopost-8f16e)</span>
                                    </button>
                                </div>

                                {showDomainHelper && (
                                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs space-y-2.5 text-left">
                                        <p className="font-semibold text-amber-900 flex items-center gap-1.5">
                                            <span className="material-symbols-outlined text-[16px] text-amber-700">vpn_lock</span>
                                            Thêm vào Firebase Authorized Domains
                                        </p>
                                        <p className="text-amber-800 leading-relaxed">
                                            Sao chép tên miền này và dán vào <strong>Authentication → Settings → Authorized domains</strong> của dự án <strong>autopost-8f16e</strong>:
                                        </p>
                                        <div className="flex items-center gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                                            <code className="flex-1 text-[11px] font-mono text-slate-800 truncate select-all">
                                                {window.location.hostname || window.location.host}
                                            </code>
                                            <button
                                                type="button"
                                                onClick={handleCopyCurrentDomain}
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] transition-colors shrink-0"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">
                                                    {copiedDomain ? 'check' : 'content_copy'}
                                                </span>
                                                <span>{copiedDomain ? 'Đã chép' : 'Sao chép'}</span>
                                            </button>
                                        </div>
                                        <a
                                            href="https://console.firebase.google.com/project/autopost-8f16e/authentication/settings"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                                        >
                                            <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                                            <span>Mở cài đặt Firebase Console</span>
                                        </a>
                                    </div>
                                )}
                            </>
                        )}

                        <button
                            id="btn-local-admin-login"
                            type="button"
                            disabled={!firebaseReady}
                            onClick={handleLocalAdminLogin}
                            className="w-full min-h-[46px] flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                            <span className="material-symbols-outlined text-[19px] text-blue-600">key</span>
                            <span>Vào Quản Trị (Local / Demo)</span>
                        </button>

                        <div className="pt-1 text-center">
                            <a
                                href="/"
                                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors py-1"
                            >
                                <span className="material-symbols-outlined text-[15px]">arrow_back</span>
                                <span>Quay lại trang chủ AutoPost Pro</span>
                            </a>
                        </div>
                    </div>
                </div>

                {toast && (
                    <div
                        className={`fixed bottom-4 right-4 max-w-sm z-50 px-4 py-3 rounded-xl border bg-white shadow-lg flex items-center gap-2.5 text-xs font-semibold animate-enter ${
                            toast.type === 'error'
                                ? 'border-rose-200 text-rose-700'
                                : 'border-emerald-200 text-emerald-700'
                        }`}
                    >
                        <span className="material-symbols-outlined text-[18px] shrink-0">
                            {toast.type === 'error' ? 'error' : 'check_circle'}
                        </span>
                        <span>{toast.msg}</span>
                    </div>
                )}
            </div>
        );
    }

    const renderUsersTable = (rows, emptyTitle, emptySubtitle, showResetCta = false) => {
        if (loading) {
            return (
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    <div className="divide-y divide-slate-100">
                        {[1, 2, 3, 4, 5].map((n) => (
                            <div key={n} className="px-5 py-3.5 flex items-center justify-between gap-4 animate-pulse">
                                <div className="flex items-center gap-3 flex-1">
                                    <div className="w-9 h-9 rounded-lg bg-slate-200 shrink-0"></div>
                                    <div className="space-y-1.5 flex-1 max-w-xs">
                                        <div className="h-3.5 bg-slate-200 rounded w-3/4"></div>
                                        <div className="h-2.5 bg-slate-100 rounded w-1/2"></div>
                                    </div>
                                </div>
                                <div className="hidden md:block h-3 bg-slate-200 rounded w-20"></div>
                                <div className="hidden md:block h-3 bg-slate-200 rounded w-24"></div>
                                <div className="h-8 bg-slate-100 rounded-lg w-16"></div>
                            </div>
                        ))}
                    </div>
                </div>
            );
        }

        if (rows.length === 0) {
            return (
                <div className="bg-white border border-slate-200 rounded-xl py-16 px-6 text-center">
                    <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
                        <span className="material-symbols-outlined text-[24px]">inbox</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900">{emptyTitle}</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">{emptySubtitle}</p>
                    {showResetCta && (
                        <button
                            type="button"
                            onClick={resetFilters}
                            className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
                        >
                            <span className="material-symbols-outlined text-[15px]">refresh</span>
                            <span>Đặt lại bộ lọc</span>
                        </button>
                    )}
                </div>
            );
        }

        return (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                {/* Mobile View */}
                <div className="md:hidden divide-y divide-slate-200">
                    {rows.map((u) => {
                        const sub = u._sub;
                        const latest = (sub.history || [])[0];
                        const exp = !u._isAdmin && sub.expiresAt ? new Date(sub.expiresAt) : null;
                        const daysLeft = exp ? Math.ceil((exp.getTime() - Date.now()) / 86400000) : null;

                        return (
                            <div key={u.id} className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <UserAvatar name={u.name} email={u.email} src={u.picture} isAdmin={u._isAdmin} />
                                        <div className="min-w-0">
                                            <div className="text-sm font-semibold text-slate-900 truncate">
                                                {u.name || 'Thành viên mới'}
                                            </div>
                                            <div className="text-xs text-slate-500 truncate">{u.email || u.id}</div>
                                        </div>
                                    </div>
                                    <StatusText status={sub.status} isAdmin={u._isAdmin} />
                                </div>

                                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
                                    <div>
                                        <span className="text-[11px] text-slate-500 block">Gói &amp; Quyền</span>
                                        <span className="font-semibold text-slate-900">
                                            {sub.plan.toUpperCase()} · {u._isAdmin ? 'Admin' : 'Thành viên'}
                                        </span>
                                        {!u._isAdmin && sub.status === 'pending' && sub.pendingPlan && (
                                            <span className="block font-mono tabular-nums text-[11px] text-blue-700 font-semibold mt-0.5">
                                                → {sub.pendingPlan.toUpperCase()} ({sub.pendingMonths || 1}T)
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-right">
                                        <span className="text-[11px] text-slate-500 block">Thời hạn</span>
                                        {u._isAdmin ? (
                                            <span className="font-semibold text-emerald-700">Vĩnh viễn</span>
                                        ) : exp ? (
                                            <span className="font-mono tabular-nums font-medium text-slate-800">
                                                {formatShortDate(sub.expiresAt)}
                                                {daysLeft !== null && (
                                                    <span className={`block text-[11px] ${daysLeft <= 0 ? 'text-rose-600' : daysLeft <= 7 ? 'text-amber-600' : 'text-slate-500'}`}>
                                                        {daysLeft <= 0 ? 'Đã hết hạn' : `Còn ${daysLeft} ngày`}
                                                    </span>
                                                )}
                                            </span>
                                        ) : (
                                            <span className="text-slate-400">—</span>
                                        )}
                                    </div>
                                </div>

                                {latest && !u._isAdmin && (
                                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                                        <span>Giao dịch gần nhất</span>
                                        <span className="font-mono tabular-nums font-semibold text-slate-800">
                                            {latest.amount ? formatCurrency(latest.amount) : '—'}
                                        </span>
                                    </div>
                                )}

                                <div className="flex items-center gap-2 pt-1">
                                    {!u._isAdmin && sub.status === 'pending' && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => handleApprove(u.id)}
                                                className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">check</span>
                                                Duyệt
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleReject(u.id)}
                                                className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">close</span>
                                                Từ chối
                                            </button>
                                        </>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => openEditModal(u)}
                                        className={`${!u._isAdmin && sub.status === 'pending' ? 'px-3.5' : 'flex-1'} min-h-[38px] inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors`}
                                    >
                                        <span className="material-symbols-outlined text-[15px]">edit</span>
                                        Sửa
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[920px]">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                <th className="py-3 px-4">Thành viên</th>
                                <th className="py-3 px-4">Vai trò</th>
                                <th className="py-3 px-4">Gói dịch vụ</th>
                                <th className="py-3 px-4">Trạng thái</th>
                                <th className="py-3 px-4">Thời hạn</th>
                                <th className="py-3 px-4 text-right">Đã nộp gần nhất</th>
                                <th className="py-3 px-4 text-right">Cập nhật</th>
                                <th className="py-3 px-4 text-right">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm">
                            {rows.map((u) => {
                                const sub = u._sub;
                                const latest = (sub.history || [])[0];
                                const exp = !u._isAdmin && sub.expiresAt ? new Date(sub.expiresAt) : null;
                                const daysLeft = exp ? Math.ceil((exp.getTime() - Date.now()) / 86400000) : null;

                                return (
                                    <tr key={u.id} className="hover:bg-slate-50/90 transition-colors">
                                        <td className="py-3 px-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <UserAvatar name={u.name} email={u.email} src={u.picture} isAdmin={u._isAdmin} size="sm" />
                                                <div className="min-w-0 max-w-[220px]">
                                                    <div className="text-xs font-semibold text-slate-900 truncate">
                                                        {u.name || 'Thành viên mới'}
                                                    </div>
                                                    <div className="text-[11px] text-slate-500 truncate">{u.email || u.id}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className={`text-xs font-semibold ${u._isAdmin ? 'text-blue-700' : 'text-slate-600'}`}>
                                                {u._isAdmin ? 'Admin' : 'Thành viên'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4">
                                            <div className="flex flex-col">
                                                <span className={`text-xs font-bold uppercase tracking-wide ${
                                                    sub.plan === 'pro'
                                                        ? 'text-slate-900'
                                                        : sub.plan === 'enterprise'
                                                            ? 'text-indigo-700'
                                                            : 'text-slate-500'
                                                }`}>
                                                    {sub.plan}
                                                    {u._isAdmin && (
                                                        <span className="ml-1.5 font-medium normal-case tracking-normal text-emerald-700">
                                                            · Mặc định
                                                        </span>
                                                    )}
                                                </span>
                                                {!u._isAdmin && sub.status === 'pending' && sub.pendingPlan && (
                                                    <span className="font-mono tabular-nums text-[11px] font-semibold text-blue-700 mt-0.5">
                                                        → {sub.pendingPlan.toUpperCase()} · {sub.pendingMonths || 1} tháng
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-3 px-4">
                                            <StatusText status={sub.status} isAdmin={u._isAdmin} />
                                        </td>
                                        <td className="py-3 px-4">
                                            {u._isAdmin ? (
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-semibold text-emerald-700">Vĩnh viễn</span>
                                                    <span className="text-[11px] text-slate-500">Không cần gia hạn</span>
                                                </div>
                                            ) : exp ? (
                                                <div className="flex flex-col">
                                                    <span className="font-mono tabular-nums text-xs font-medium text-slate-800">
                                                        {formatShortDate(sub.expiresAt)}
                                                    </span>
                                                    {daysLeft !== null && (
                                                        <span className={`font-mono tabular-nums text-[11px] ${
                                                            daysLeft <= 0 || sub.status === 'expired'
                                                                ? 'text-rose-600 font-semibold'
                                                                : daysLeft <= 7
                                                                    ? 'text-amber-600 font-semibold'
                                                                    : 'text-slate-500'
                                                        }`}>
                                                            {daysLeft <= 0 || sub.status === 'expired' ? 'Đã hết hạn' : `Còn ${daysLeft} ngày`}
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-xs text-slate-400">—</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-800">
                                            {u._isAdmin ? (
                                                <span className="text-slate-400 font-sans font-normal">Miễn phí</span>
                                            ) : latest && latest.amount ? (
                                                <div>
                                                    <div>{formatCurrency(latest.amount)}</div>
                                                    {latest.months ? (
                                                        <div className="text-[11px] font-normal text-slate-500">{latest.months} tháng</div>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <span className="text-slate-400">—</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                                            {latest && latest.date ? formatDateTime(latest.date) : formatShortDate(u.createdAt)}
                                        </td>
                                        <td className="py-3 px-4 text-right">
                                            <div className="inline-flex items-center justify-end gap-1.5">
                                                {!u._isAdmin && sub.status === 'pending' && (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleApprove(u.id)}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                                                        >
                                                            <span className="material-symbols-outlined text-[15px]">check</span>
                                                            Duyệt
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleReject(u.id)}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold transition-colors whitespace-nowrap"
                                                        >
                                                            Hủy
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => openEditModal(u)}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors whitespace-nowrap"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">edit</span>
                                                    Sửa
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    const currentBankObj = BANK_OPTIONS.find((b) => b.code === settings.bankName);

    return (
        <div className="flex w-full h-full overflow-hidden bg-slate-50">
            {/* Desktop Sidebar */}
            <aside className="hidden md:flex w-64 bg-slate-900 border-r border-slate-800 flex-col h-full p-4 shrink-0">
                {renderSidebarContent()}
            </aside>

            {/* Mobile Sidebar Drawer */}
            {showMobileSidebar && (
                <div className="fixed inset-0 z-50 flex md:hidden">
                    <div
                        className="absolute inset-0 bg-slate-950/60"
                        onClick={() => setShowMobileSidebar(false)}
                    ></div>
                    <aside className="relative flex flex-col w-64 h-full p-4 bg-slate-900 border-r border-slate-800 animate-enter">
                        <button
                            type="button"
                            aria-label="Đóng menu"
                            onClick={() => setShowMobileSidebar(false)}
                            className="absolute top-3.5 right-3.5 w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800"
                        >
                            <span className="material-symbols-outlined text-[20px]">close</span>
                        </button>
                        {renderSidebarContent()}
                    </aside>
                </div>
            )}

            {/* Main Viewport */}
            <main className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
                <header className="h-14 sm:h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-3 shrink-0 z-30">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <button
                            type="button"
                            aria-label="Mở menu quản trị"
                            onClick={() => setShowMobileSidebar(true)}
                            className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 shrink-0"
                        >
                            <span className="material-symbols-outlined text-[22px]">menu</span>
                        </button>
                        <div className="flex items-center gap-1.5 text-sm min-w-0">
                            <span className="text-slate-400 font-medium hidden sm:inline">Quản trị</span>
                            <span className="text-slate-300 hidden sm:inline">/</span>
                            <span className="font-bold text-slate-900 truncate">{currentSectionLabel}</span>
                        </div>
                        <span className="hidden lg:inline text-xs text-slate-400 pl-2 border-l border-slate-200 whitespace-nowrap">
                            {useFirebaseMode && !adminUser.isLocal ? 'Firebase Realtime' : 'Chế độ cục bộ'}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                        {adminUser.isLocal && (
                            <button
                                type="button"
                                onClick={refreshLocalData}
                                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors whitespace-nowrap shrink-0"
                            >
                                <span className="material-symbols-outlined text-[16px]">refresh</span>
                                <span>Làm mới</span>
                            </button>
                        )}

                        <a
                            href="/"
                            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors whitespace-nowrap shrink-0"
                        >
                            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                            <span>Mở ứng dụng</span>
                        </a>

                        <div className="relative" ref={dropdownRef}>
                            <button
                                type="button"
                                onClick={() => setShowAdminDropdown((prev) => !prev)}
                                className="flex items-center gap-2 p-1 pr-2 rounded-lg hover:bg-slate-100 transition-colors"
                            >
                                <UserAvatar
                                    name={adminUser.displayName}
                                    email={adminUser.email}
                                    src={adminUser.photoURL}
                                    isAdmin={true}
                                    size="sm"
                                />
                                <div className="hidden sm:block text-left leading-tight">
                                    <div className="text-xs font-semibold text-slate-900 max-w-[140px] truncate">
                                        {adminUser.displayName || 'Admin'}
                                    </div>
                                    <div className="text-[11px] font-medium text-emerald-700">
                                        Pro · Vĩnh viễn
                                    </div>
                                </div>
                                <span className="material-symbols-outlined text-[18px] text-slate-400">
                                    expand_more
                                </span>
                            </button>

                            {showAdminDropdown && (
                                <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-50 animate-enter">
                                    <div className="px-3.5 py-2.5 border-b border-slate-100">
                                        <p className="text-xs font-bold text-slate-900 truncate">
                                            {adminUser.displayName || 'Quản trị viên'}
                                        </p>
                                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{adminUser.email}</p>
                                        <p className="text-[11px] font-semibold text-emerald-700 mt-1">
                                            Admin · Pro Vĩnh viễn (Không cần gia hạn)
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setTab('settings');
                                            setShowAdminDropdown(false);
                                        }}
                                        className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 text-left"
                                    >
                                        <span className="material-symbols-outlined text-[16px] text-slate-400">tune</span>
                                        Cấu hình hệ thống
                                    </button>
                                    <a
                                        href="/"
                                        className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                    >
                                        <span className="material-symbols-outlined text-[16px] text-slate-400">home</span>
                                        Về trang chủ AutoPost Pro
                                    </a>
                                    <div className="border-t border-slate-100 mt-1 pt-1">
                                        <button
                                            type="button"
                                            onClick={handleSignOut}
                                            className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 text-left"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">logout</span>
                                            Đăng xuất
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <div className="max-w-7xl mx-auto space-y-6">
                        {tab === 'overview' && (
                            <div className="space-y-6 animate-enter">
                                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                                    <div>
                                        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                                            Tổng quan vận hành
                                        </h2>
                                        <p className="text-xs sm:text-sm text-slate-500 mt-1">
                                            Theo dõi thành viên, duyệt giao dịch nâng cấp và doanh thu theo thời gian thực.
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {stats.pending > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setTab('pending')}
                                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors whitespace-nowrap"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">pending_actions</span>
                                                <span>Xử lý {stats.pending} đơn chờ duyệt</span>
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => setTab('all')}
                                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors whitespace-nowrap"
                                        >
                                            <span>Xem tất cả thành viên</span>
                                        </button>
                                    </div>
                                </div>

                                <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={() => setTab('all')}
                                        className="p-5 text-left hover:bg-slate-50/70 transition-colors"
                                    >
                                        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                                            <span>Tổng thành viên</span>
                                            <span className="material-symbols-outlined text-[18px] text-slate-400">group</span>
                                        </div>
                                        <div className="mt-2 font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-900">
                                            {stats.total}
                                        </div>
                                        <div className="mt-1.5 text-[11px] text-slate-500">
                                            <span className="font-mono tabular-nums font-semibold text-blue-700">{stats.adminCount}</span> admin ·{' '}
                                            <span className="font-mono tabular-nums">{stats.total - stats.adminCount}</span> người dùng
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setTab('pending')}
                                        className="p-5 text-left hover:bg-slate-50/70 transition-colors"
                                    >
                                        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                                            <span>Đơn chờ duyệt</span>
                                            <span className="material-symbols-outlined text-[18px] text-amber-600">pending_actions</span>
                                        </div>
                                        <div className={`mt-2 font-mono tabular-nums text-2xl sm:text-3xl font-bold ${stats.pending > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                                            {stats.pending}
                                        </div>
                                        <div className="mt-1.5 text-[11px] text-slate-500">
                                            {stats.pending > 0 ? 'Cần xác nhận thanh toán' : 'Đã xử lý toàn bộ'}
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setFilterPlan('pro');
                                            setFilterStatus('all');
                                            setFilterRole('all');
                                            setTab('all');
                                        }}
                                        className="p-5 text-left hover:bg-slate-50/70 transition-colors"
                                    >
                                        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                                            <span>Tài khoản Pro / Trả phí</span>
                                            <span className="material-symbols-outlined text-[18px] text-emerald-600">workspace_premium</span>
                                        </div>
                                        <div className="mt-2 font-mono tabular-nums text-2xl sm:text-3xl font-bold text-emerald-700">
                                            {stats.activePaid}
                                        </div>
                                        <div className="mt-1.5 text-[11px] text-slate-500">
                                            Gồm <span className="font-mono tabular-nums font-semibold">{stats.adminCount}</span> Admin Pro vĩnh viễn
                                        </div>
                                    </button>

                                    <div className="p-5 text-left">
                                        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                                            <span>Doanh thu đã duyệt</span>
                                            <span className="material-symbols-outlined text-[18px] text-blue-600">payments</span>
                                        </div>
                                        <div className="mt-2 font-mono tabular-nums text-2xl sm:text-3xl font-bold text-slate-900 truncate">
                                            {formatCurrency(stats.revenue)}
                                        </div>
                                        <div className="mt-1.5 text-[11px] text-slate-500">
                                            Tổng giao dịch đã xác nhận
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                                    <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
                                        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900">Hàng đợi duyệt nâng cấp</h3>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    Xác nhận chuyển khoản và kích hoạt gói ngay lập tức
                                                </p>
                                            </div>
                                            {pendingUsers.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setTab('pending')}
                                                    className="text-xs font-semibold text-blue-600 hover:text-blue-700 whitespace-nowrap"
                                                >
                                                    Xem tất cả ({pendingUsers.length}) →
                                                </button>
                                            )}
                                        </div>

                                        {loading ? (
                                            <div className="p-6 space-y-3 animate-pulse">
                                                {[1, 2, 3].map((i) => (
                                                    <div key={i} className="h-12 bg-slate-100 rounded-lg"></div>
                                                ))}
                                            </div>
                                        ) : pendingUsers.length === 0 ? (
                                            <div className="py-12 px-6 text-center">
                                                <span className="material-symbols-outlined text-[32px] text-emerald-600">task_alt</span>
                                                <p className="text-sm font-semibold text-slate-800 mt-2">
                                                    Không có đơn chờ duyệt
                                                </p>
                                                <p className="text-xs text-slate-500 mt-1">
                                                    Mọi yêu cầu nâng cấp gói của thành viên đã được xử lý xong.
                                                </p>
                                            </div>
                                        ) : (
                                            <div className="divide-y divide-slate-100">
                                                {pendingUsers.slice(0, 6).map((u) => {
                                                    const sub = u._sub;
                                                    const latest = (sub.history || [])[0];
                                                    return (
                                                        <div key={u.id} className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors">
                                                            <div className="flex items-center gap-3 min-w-0">
                                                                <UserAvatar name={u.name} email={u.email} src={u.picture} size="sm" />
                                                                <div className="min-w-0">
                                                                    <div className="text-xs font-semibold text-slate-900 truncate">
                                                                        {u.name || 'Thành viên mới'}
                                                                    </div>
                                                                    <div className="text-[11px] text-slate-500 truncate">
                                                                        {u.email || u.id}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center justify-between sm:justify-end gap-4">
                                                                <div className="text-left sm:text-right">
                                                                    <div className="font-mono tabular-nums text-xs font-bold text-slate-900">
                                                                        {(sub.pendingPlan || 'pro').toUpperCase()} · {sub.pendingMonths || 1} tháng
                                                                    </div>
                                                                    <div className="font-mono tabular-nums text-[11px] font-semibold text-emerald-700">
                                                                        {latest && latest.amount ? formatCurrency(latest.amount) : '—'}
                                                                    </div>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 shrink-0">
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleApprove(u.id)}
                                                                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                                                                    >
                                                                        <span className="material-symbols-outlined text-[15px]">check</span>
                                                                        Duyệt
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleReject(u.id)}
                                                                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700 text-slate-600 text-xs font-semibold transition-colors"
                                                                    >
                                                                        Hủy
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>

                                    <div className="lg:col-span-4 space-y-6">
                                        <div className="bg-white border border-slate-200 rounded-xl p-5">
                                            <h3 className="text-sm font-bold text-slate-900">Phân bổ gói dịch vụ</h3>
                                            <p className="text-xs text-slate-500 mt-0.5">Tỷ lệ gói hiện hành trong hệ thống</p>

                                            <div className="mt-4 space-y-3.5">
                                                {[
                                                    { label: 'Admin Pro (Vĩnh viễn)', count: stats.adminCount, bar: 'bg-blue-600' },
                                                    { label: 'Pro trả phí', count: stats.proUserCount, bar: 'bg-emerald-600' },
                                                    { label: 'Enterprise', count: stats.enterpriseCount, bar: 'bg-indigo-600' },
                                                    { label: 'Free (Miễn phí)', count: stats.freeCount, bar: 'bg-slate-400' },
                                                ].map((row) => {
                                                    const pct = stats.total > 0 ? Math.round((row.count / stats.total) * 100) : 0;
                                                    return (
                                                        <div key={row.label}>
                                                            <div className="flex items-center justify-between text-xs mb-1">
                                                                <span className="font-medium text-slate-700">{row.label}</span>
                                                                <span className="font-mono tabular-nums text-slate-600">
                                                                    <strong className="text-slate-900">{row.count}</strong> ({pct}%)
                                                                </span>
                                                            </div>
                                                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className={`h-full rounded-full ${row.bar}`} style={{ width: `${pct}%` }}></div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                                            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                                                <h3 className="text-sm font-bold text-slate-900">Tài khoản Admin</h3>
                                                <span className="text-[11px] font-semibold text-emerald-700">Pro Vĩnh viễn</span>
                                            </div>
                                            <div className="divide-y divide-slate-100">
                                                {adminAccounts.length === 0 ? (
                                                    <div className="p-5 text-xs text-slate-500 text-center">
                                                        Chưa có dữ liệu quản trị viên.
                                                    </div>
                                                ) : (
                                                    adminAccounts.slice(0, 5).map((u) => (
                                                        <div key={u.id} className="px-5 py-3 flex items-center justify-between gap-2.5">
                                                            <div className="flex items-center gap-2.5 min-w-0">
                                                                <UserAvatar name={u.name} email={u.email} src={u.picture} isAdmin={true} size="sm" />
                                                                <div className="min-w-0">
                                                                    <div className="text-xs font-semibold text-slate-900 truncate">
                                                                        {u.name || 'Admin'}
                                                                    </div>
                                                                    <div className="text-[11px] text-slate-500 truncate">
                                                                        {u.email || u.id}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <span className="text-[11px] font-semibold text-emerald-700 whitespace-nowrap shrink-0">
                                                                PRO · ∞
                                                            </span>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {(tab === 'pending' || tab === 'all') && (
                            <div className="space-y-4 animate-enter">
                                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                                    <div>
                                        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                                            {tab === 'pending' ? 'Đơn chờ duyệt thanh toán' : 'Quản lý thành viên'}
                                        </h2>
                                        <p className="text-xs sm:text-sm text-slate-500 mt-1">
                                            {tab === 'pending'
                                                ? 'Kiểm tra số tiền chuyển khoản và phê duyệt kích hoạt gói cho người dùng.'
                                                : 'Tìm kiếm, phân quyền và quản lý thời hạn gói dịch vụ. Tài khoản Admin luôn là Pro vĩnh viễn.'}
                                        </p>
                                    </div>
                                    <div className="text-xs text-slate-500 font-mono tabular-nums">
                                        Hiển thị <strong className="text-slate-900">{filteredUsers.length}</strong> / {tab === 'pending' ? stats.pending : stats.total} tài khoản
                                    </div>
                                </div>

                                <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                                    {tab === 'all' ? (
                                        <div className="flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0">
                                            {[
                                                { key: 'all', label: 'Tất cả', role: 'all', status: 'all' },
                                                { key: 'active', label: 'Hoạt động', role: 'all', status: 'active' },
                                                { key: 'pending', label: `Chờ duyệt (${stats.pending})`, role: 'all', status: 'pending' },
                                                { key: 'expired', label: 'Hết hạn', role: 'all', status: 'expired' },
                                                { key: 'admin', label: `Admin (${stats.adminCount})`, role: 'admin', status: 'all' },
                                            ].map((seg) => {
                                                const isActive =
                                                    seg.key === 'admin'
                                                        ? filterRole === 'admin'
                                                        : filterRole === 'all' && filterStatus === seg.status;
                                                return (
                                                    <button
                                                        key={seg.key}
                                                        type="button"
                                                        onClick={() => {
                                                            setFilterRole(seg.role);
                                                            setFilterStatus(seg.status);
                                                        }}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                                                            isActive
                                                                ? 'bg-slate-900 text-white'
                                                                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                                                        }`}
                                                    >
                                                        {seg.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="text-xs font-semibold text-amber-700 flex items-center gap-1.5 px-1">
                                            <span className="material-symbols-outlined text-[16px]">pending_actions</span>
                                            <span>{stats.pending} yêu cầu đang chờ xác nhận</span>
                                        </div>
                                    )}

                                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                                        <div className="relative flex-1 sm:w-64">
                                            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">
                                                search
                                            </span>
                                            <input
                                                type="text"
                                                value={search}
                                                onChange={(e) => setSearch(e.target.value)}
                                                placeholder="Tìm tên, email hoặc UID..."
                                                className="w-full h-9 bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 text-xs text-slate-900 placeholder-slate-400 focus:bg-white focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-colors"
                                            />
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={filterPlan}
                                                onChange={(e) => setFilterPlan(e.target.value)}
                                                className="h-9 flex-1 sm:flex-none bg-slate-50 border border-slate-200 rounded-lg px-2.5 text-xs font-medium text-slate-700 focus:bg-white focus:outline-none focus:border-blue-600 cursor-pointer"
                                            >
                                                <option value="all">Tất cả gói</option>
                                                <option value="free">Free</option>
                                                <option value="pro">Pro</option>
                                                <option value="enterprise">Enterprise</option>
                                            </select>
                                            {(search || filterPlan !== 'all' || filterStatus !== 'all' || filterRole !== 'all') && (
                                                <button
                                                    type="button"
                                                    onClick={resetFilters}
                                                    className="h-9 inline-flex items-center gap-1 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 whitespace-nowrap"
                                                >
                                                    <span className="material-symbols-outlined text-[15px]">refresh</span>
                                                    Đặt lại
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {renderUsersTable(
                                    filteredUsers,
                                    tab === 'pending' ? 'Không có đơn chờ duyệt nào' : 'Không tìm thấy thành viên phù hợp',
                                    tab === 'pending'
                                        ? 'Khi người dùng gửi yêu cầu nâng cấp gói dịch vụ, đơn sẽ xuất hiện ngay tại đây.'
                                        : 'Hãy thử thay đổi từ khóa tìm kiếm hoặc đặt lại bộ lọc để xem toàn bộ danh sách.',
                                    Boolean(search || filterPlan !== 'all' || filterStatus !== 'all' || filterRole !== 'all')
                                )}
                            </div>
                        )}

                        {tab === 'settings' && (
                            <div className="space-y-6 animate-enter">
                                <div>
                                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                                        Cấu hình hệ thống
                                    </h2>
                                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                                        Thiết lập thương hiệu hiển thị và tài khoản ngân hàng nhận thanh toán VietQR tự động.
                                    </p>
                                </div>

                                <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                                    <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
                                        <div className="p-5 sm:p-6 space-y-4">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900">Thông tin thương hiệu</h3>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    Hiển thị trên thanh tiêu đề và giao diện người dùng
                                                </p>
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                                        Tên ứng dụng
                                                    </label>
                                                    <input
                                                        type="text"
                                                        required
                                                        value={settings.appName}
                                                        onChange={(e) => setSettings({ ...settings, appName: e.target.value })}
                                                        className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                                        URL ảnh logo (tùy chọn)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        placeholder="https://..."
                                                        value={settings.logoUrl}
                                                        onChange={(e) => setSettings({ ...settings, logoUrl: e.target.value })}
                                                        className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="p-5 sm:p-6 space-y-4">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900">Cổng thanh toán VietQR</h3>
                                                <p className="text-xs text-slate-500 mt-0.5">
                                                    Tự động sinh mã QR chuyển khoản theo từng gói nâng cấp của thành viên
                                                </p>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                                        Ngân hàng
                                                    </label>
                                                    <select
                                                        required
                                                        value={settings.bankName || 'mbbank'}
                                                        onChange={(e) => {
                                                            const bCode = e.target.value;
                                                            setSettings({
                                                                ...settings,
                                                                bankName: bCode,
                                                                qrTemplate: `https://img.vietqr.io/image/${bCode}-${settings.bankNo || ''}-compact.png`,
                                                            });
                                                        }}
                                                        className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer"
                                                    >
                                                        {BANK_OPTIONS.map((b) => (
                                                            <option key={b.code} value={b.code}>{b.label}</option>
                                                        ))}
                                                    </select>
                                                </div>

                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                                        Số tài khoản (STK)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        required
                                                        placeholder="Nhập số tài khoản..."
                                                        value={settings.bankNo}
                                                        onChange={(e) => {
                                                            const stk = e.target.value.trim();
                                                            setSettings({
                                                                ...settings,
                                                                bankNo: stk,
                                                                qrTemplate: `https://img.vietqr.io/image/${settings.bankName || 'mbbank'}-${stk}-compact.png`,
                                                            });
                                                        }}
                                                        className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 font-mono text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                                                    />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                                        Tên chủ tài khoản (không dấu)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        required
                                                        placeholder="VD: NGUYEN VAN A"
                                                        value={settings.bankUser}
                                                        onChange={(e) => setSettings({ ...settings, bankUser: e.target.value.toUpperCase() })}
                                                        className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                                        Mẫu đường dẫn VietQR
                                                    </label>
                                                    <input
                                                        type="text"
                                                        readOnly
                                                        disabled
                                                        value={settings.qrTemplate || `https://img.vietqr.io/image/${settings.bankName || 'mbbank'}-${settings.bankNo || ''}-compact.png`}
                                                        className="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3 font-mono text-xs text-slate-500"
                                                    />
                                                </div>
                                            </div>
                                        </div>

                                        <div className="px-5 sm:px-6 py-4 bg-slate-50/60 flex items-center justify-end gap-3 rounded-b-xl">
                                            <button
                                                type="submit"
                                                disabled={savingSettings}
                                                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                                            >
                                                <span className="material-symbols-outlined text-[18px]">save</span>
                                                <span>{savingSettings ? 'Đang lưu...' : 'Lưu cấu hình hệ thống'}</span>
                                            </button>
                                        </div>
                                    </div>

                                    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
                                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                            <div>
                                                <h3 className="text-sm font-bold text-slate-900">Xem trước mã thanh toán</h3>
                                                <p className="text-xs text-slate-500 mt-0.5">Mẫu hiển thị cho gói Pro 1 tháng (199.000₫)</p>
                                            </div>
                                            <span className="material-symbols-outlined text-[20px] text-slate-400">qr_code_2</span>
                                        </div>

                                        <div className="flex flex-col items-center py-2">
                                            {settings.bankNo ? (
                                                <div className="p-3 rounded-xl border border-slate-200 bg-white">
                                                    <img
                                                        src={`https://img.vietqr.io/image/${settings.bankName || 'mbbank'}-${settings.bankNo}-compact.png?amount=199000&addInfo=AUTOPOST_PRO&accountName=${encodeURIComponent(settings.bankUser || 'AUTOPOST PRO')}`}
                                                        alt="VietQR Preview"
                                                        className="w-48 h-48 object-contain block"
                                                    />
                                                </div>
                                            ) : (
                                                <div className="w-48 h-48 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center text-center px-4 text-xs text-slate-500">
                                                    <span className="material-symbols-outlined text-[28px] text-slate-400 mb-1.5">qr_code</span>
                                                    Nhập số tài khoản để xem trước mã VietQR
                                                </div>
                                            )}
                                        </div>

                                        <div className="border-t border-slate-100 pt-3.5 space-y-2 text-xs">
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500">Ngân hàng</span>
                                                <span className="font-semibold text-slate-900 uppercase">
                                                    {(currentBankObj && currentBankObj.label) || settings.bankName || '—'}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500">Số tài khoản</span>
                                                <span className="font-mono tabular-nums font-semibold text-slate-900">
                                                    {settings.bankNo || '—'}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-slate-500">Chủ tài khoản</span>
                                                <span className="font-semibold text-slate-900">
                                                    {settings.bankUser || '—'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            {editModal && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div
                        className="absolute inset-0 bg-slate-950/50"
                        onClick={() => !savingUser && setEditModal(null)}
                    ></div>
                    <div className="relative w-full max-w-md max-h-[90dvh] overflow-y-auto bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-xl animate-enter">
                        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
                            <div>
                                <h2 className="text-base font-bold text-slate-900">Chỉnh sửa tài khoản</h2>
                                <p className="text-xs text-slate-500 mt-0.5 truncate max-w-[280px]">
                                    {editModal.name} · {editModal.email}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditModal(null)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                            >
                                <span className="material-symbols-outlined text-[20px]">close</span>
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                    Phân quyền vai trò
                                </label>
                                <select
                                    disabled={editModal.isOwner}
                                    value={editModal.role}
                                    onChange={(e) => {
                                        const nextRole = e.target.value;
                                        setEditModal({
                                            ...editModal,
                                            role: nextRole,
                                            ...(nextRole === 'admin' ? { plan: 'pro', status: 'active' } : {}),
                                        });
                                    }}
                                    className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 text-sm font-medium text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 disabled:bg-slate-50 disabled:text-slate-500 cursor-pointer"
                                >
                                    <option value="user">Thành viên (USER)</option>
                                    <option value="admin">Quản trị viên (ADMIN)</option>
                                </select>
                                {editModal.isOwner && (
                                    <p className="text-[11px] text-slate-500 mt-1">
                                        Đây là tài khoản Quản trị viên gốc của hệ thống.
                                    </p>
                                )}
                            </div>

                            {editModal.role === 'admin' ? (
                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-1.5">
                                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                                        <span className="material-symbols-outlined text-[18px] text-emerald-700">verified</span>
                                        <span>Gói Pro Vĩnh viễn (Mặc định Admin)</span>
                                    </div>
                                    <p className="text-xs text-emerald-800 leading-relaxed">
                                        Tài khoản có quyền <strong>Admin</strong> luôn tự động hoạt động ở gói <strong>Pro không giới hạn thời gian</strong> và không cần gia hạn định kỳ.
                                    </p>
                                </div>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Gói dịch vụ
                                        </label>
                                        <select
                                            value={editModal.plan}
                                            onChange={(e) => setEditModal({ ...editModal, plan: e.target.value })}
                                            className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer"
                                        >
                                            <option value="free">Free — Miễn phí (tối đa 3 nhóm)</option>
                                            <option value="pro">Pro — 199.000₫ / tháng</option>
                                            <option value="enterprise">Enterprise — 499.000₫ / tháng</option>
                                        </select>
                                    </div>

                                    {editModal.plan !== 'free' && (
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                                Số tháng kích hoạt / gia hạn
                                            </label>
                                            <input
                                                type="number"
                                                min="1"
                                                max="36"
                                                value={editModal.months}
                                                onChange={(e) => setEditModal({ ...editModal, months: e.target.value })}
                                                className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 font-mono tabular-nums text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600"
                                            />
                                        </div>
                                    )}

                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Trạng thái gói
                                        </label>
                                        <select
                                            value={editModal.status}
                                            onChange={(e) => setEditModal({ ...editModal, status: e.target.value })}
                                            className="w-full h-10 bg-white border border-slate-300 rounded-lg px-3 text-sm text-slate-900 focus:outline-none focus:border-blue-600 focus:ring-1 focus:ring-blue-600 cursor-pointer"
                                        >
                                            <option value="active">Hoạt động (Active)</option>
                                            <option value="pending">Chờ duyệt (Pending)</option>
                                            <option value="expired">Hết hạn (Expired)</option>
                                        </select>
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end gap-2.5 rounded-b-2xl">
                            <button
                                type="button"
                                disabled={savingUser}
                                onClick={() => setEditModal(null)}
                                className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
                            >
                                Hủy bỏ
                            </button>
                            <button
                                type="button"
                                disabled={savingUser}
                                onClick={handleEditSave}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                            >
                                {savingUser ? 'Đang lưu...' : 'Lưu thay đổi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {toast && (
                <div
                    className={`fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm z-50 px-4 py-3 rounded-xl border bg-white shadow-lg flex items-center justify-between gap-3 animate-enter ${
                        toast.type === 'error'
                            ? 'border-rose-200 text-rose-700'
                            : toast.type === 'info'
                                ? 'border-slate-200 text-slate-800'
                                : 'border-emerald-200 text-emerald-700'
                    }`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="material-symbols-outlined text-[18px] shrink-0">
                            {toast.type === 'error' ? 'error' : toast.type === 'info' ? 'info' : 'check_circle'}
                        </span>
                        <span className="text-xs font-semibold leading-snug">{toast.msg}</span>
                    </div>
                    <button
                        type="button"
                        onClick={() => setToast(null)}
                        className="text-slate-400 hover:text-slate-700 shrink-0"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            )}
        </div>
    );
}

const rootEl = document.getElementById('root');
if (ReactDOM.createRoot) {
    ReactDOM.createRoot(rootEl).render(<App />);
} else {
    ReactDOM.render(<App />, rootEl);
}
