(function () {
    const card = document.getElementById('login-card');
    const btnLogin = document.getElementById('btn-login');
    const btnDemoLogin = document.getElementById('btn-demo-login');
    const loading = document.getElementById('loading');
    const loadingText = document.getElementById('loading-text');
    const authActions = document.getElementById('auth-actions');
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    const toastIcon = document.getElementById('toast-icon');
    const brandTitle = document.getElementById('brand-title');

    let toastTimer = null;
    let auth = null;
    let rtdb = null;

    setTimeout(() => {
        if (card) {
            card.classList.remove('scale-95', 'opacity-0');
            card.classList.add('scale-100', 'opacity-100');
        }
    }, 80);

    function showToast(msg, type) {
        const t = type || 'error';
        if (toastTimer) clearTimeout(toastTimer);
        toastMsg.innerText = msg;
        toast.className =
            'fixed top-4 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm z-50 transform translate-y-0 opacity-100 transition-all duration-300 px-4 py-3.5 rounded-2xl shadow-xl flex items-center gap-3 ' +
            (t === 'success' ? 'bg-emerald-500' : t === 'info' ? 'bg-blue-600' : 'bg-rose-500') +
            ' text-white';
        toastIcon.innerText = t === 'success' ? 'check_circle' : t === 'info' ? 'info' : 'error';
        toastTimer = setTimeout(() => {
            toast.className =
                'fixed top-4 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-sm z-50 transform translate-y-[-140px] opacity-0 transition-all duration-300 bg-rose-500 text-white px-4 py-3.5 rounded-2xl shadow-xl flex items-center gap-3 pointer-events-none';
        }, 3500);
    }

    const urlParams = new URLSearchParams(window.location.search);
    const rawRedirect = urlParams.get('redirect') || '/';
    const allowedRedirects = [
        '/', '/share', '/pricing', '/admin',
        '/index.html', '/share.html', '/pricing.html', '/admin.html',
        'index.html', 'share.html', 'pricing.html', 'admin.html',
    ];
    const redirect = allowedRedirects.indexOf(rawRedirect) !== -1 ? rawRedirect : '/';

    async function completeLocalSession(userObj) {
        authActions.classList.add('hidden');
        loading.classList.remove('hidden');
        loading.classList.add('flex');
        loadingText.innerText = 'Đang đồng bộ tài khoản...';

        let syncedUser = null;
        try {
            const res = await fetch('/api/users/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userObj),
            });
            if (res.ok) syncedUser = await res.json();
        } catch (e) {
            console.warn('Local user sync warning:', e);
        }

        const storageUser = {
            name: (syncedUser && syncedUser.name) || userObj.name,
            email: (syncedUser && syncedUser.email) || userObj.email,
            picture: (syncedUser && syncedUser.picture) || userObj.picture || '',
            sub: (syncedUser && syncedUser.id) || userObj.sub,
            isFirebaseAuth: false,
        };
        const sub = (syncedUser && syncedUser.subscription) || {
            plan: 'free',
            expiresAt: null,
            status: 'active',
            history: [],
        };

        try {
            localStorage.setItem('google_user', JSON.stringify(storageUser));
            localStorage.setItem('subscription', JSON.stringify(sub));
            if (syncedUser && syncedUser.role) {
                localStorage.setItem('user_role', JSON.stringify(syncedUser.role));
            }
        } catch (e) {}

        showToast('Đăng nhập thành công! Đang chuyển hướng...', 'success');
        setTimeout(() => {
            window.location.href = redirect;
        }, 600);
    }

    const DEFAULT_FIREBASE_CONFIG = {
        apiKey: 'AIzaSyCvxzc0u0lxvY5JxEIWKOp59pAGb78ocdA',
        authDomain: 'autopost-8f16e.firebaseapp.com',
        databaseURL: 'https://autopost-8f16e-default-rtdb.firebaseio.com',
        projectId: 'autopost-8f16e',
        storageBucket: 'autopost-8f16e.firebasestorage.app',
        messagingSenderId: '213973905650',
        appId: '1:213973905650:web:4875b21b380eda1a2de06b',
    };

    async function bootstrapAuth() {
        try {
            const results = await Promise.all([
                fetch('/api/settings').catch(() => null),
                fetch('/api/firebase-config').catch(() => null),
            ]);
            const settingsRes = results[0];
            const fbRes = results[1];

            if (settingsRes && settingsRes.ok) {
                const settingsVal = await settingsRes.json();
                if (settingsVal && settingsVal.appName) {
                    document.title = 'Đăng nhập - ' + settingsVal.appName;
                    brandTitle.innerText = settingsVal.appName;
                }
            }

            let activeFbConfig = DEFAULT_FIREBASE_CONFIG;
            if (fbRes && fbRes.ok) {
                const fbData = await fbRes.json();
                if (fbData.configured && fbData.config) {
                    activeFbConfig = fbData.config;
                } else if (fbData.configured === false) {
                    activeFbConfig = null;
                }
            }

            if (activeFbConfig && typeof firebase !== 'undefined') {
                if (!firebase.apps.length) firebase.initializeApp(activeFbConfig);
                auth = firebase.auth();
                rtdb = firebase.database();

                if (typeof auth.getRedirectResult === 'function') {
                    auth.getRedirectResult().catch((err) => {
                        if (err && err.code === 'auth/unauthorized-domain') {
                            if (domainHelper) domainHelper.classList.remove('hidden');
                            showToast('Tên miền chưa được thêm vào Authorized Domains!', 'error');
                        }
                    });
                }

                auth.onAuthStateChanged((user) => {
                    if (user) {
                        rtdb.ref('settings').once('value').then((snap) => {
                            const s = snap.val();
                            if (s && s.appName) {
                                document.title = 'Đăng nhập - ' + s.appName;
                                brandTitle.innerText = s.appName;
                            }
                        }).catch(() => {});

                        authActions.classList.add('hidden');
                        loading.classList.remove('hidden');
                        loading.classList.add('flex');
                        loadingText.innerText = 'Đang kiểm tra quyền truy cập...';

                        rtdb.ref('users/' + user.uid).once('value').then((snapshot) => {
                            let userData = snapshot.val();
                            if (!userData) {
                                const initSub = { plan: 'free', expiresAt: null, status: 'active', history: [] };
                                userData = {
                                    name: user.displayName,
                                    email: user.email,
                                    picture: user.photoURL,
                                    createdAt: new Date().toISOString(),
                                    subscription: initSub,
                                    role: 'user',
                                };
                                rtdb.ref('users/' + user.uid).set(userData);
                            }

                            const storageUser = {
                                name: user.displayName,
                                email: user.email,
                                picture: user.photoURL,
                                sub: user.uid,
                                isFirebaseAuth: true,
                            };
                            try {
                                localStorage.setItem('google_user', JSON.stringify(storageUser));
                                if (userData && userData.subscription) {
                                    localStorage.setItem('subscription', JSON.stringify(userData.subscription));
                                }
                            } catch (e) {}

                            showToast('Đăng nhập thành công! Đang chuyển hướng...', 'success');
                            setTimeout(() => {
                                window.location.href = redirect;
                            }, 800);
                        }).catch(() => {
                            completeLocalSession({
                                sub: user.uid,
                                name: user.displayName || 'Người dùng Google',
                                email: user.email || '',
                                picture: user.photoURL || '',
                            });
                        });
                    }
                });
            }
        } catch (err) {
            console.warn('Bootstrap auth fallback:', err);
        }
    }

    bootstrapAuth();

    const domainHelper = document.getElementById('domain-helper');
    const currentDomainText = document.getElementById('current-domain-text');
    const btnCopyDomain = document.getElementById('btn-copy-domain');
    const btnToggleDomainHelper = document.getElementById('btn-toggle-domain-helper');
    const currentHostname = window.location.hostname || window.location.host;

    if (currentDomainText) {
        currentDomainText.textContent = currentHostname;
    }

    function copyDomainToClipboard() {
        const finish = () => {
            showToast('Đã sao chép tên miền: ' + currentHostname, 'success');
            if (btnCopyDomain) {
                const label = btnCopyDomain.querySelector('span:last-child');
                if (label) {
                    label.textContent = 'Đã chép';
                    setTimeout(() => { label.textContent = 'Sao chép'; }, 2000);
                }
            }
        };
        const fallback = () => {
            const ta = document.createElement('textarea');
            ta.value = currentHostname;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '0';
            ta.style.left = '0';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { ta.setSelectionRange(0, currentHostname.length); } catch (e) {}
            try { document.execCommand('copy'); } catch (e) {}
            document.body.removeChild(ta);
            finish();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(currentHostname).then(finish).catch(fallback);
        } else {
            fallback();
        }
    }

    if (btnCopyDomain) btnCopyDomain.addEventListener('click', copyDomainToClipboard);
    if (btnToggleDomainHelper && domainHelper) {
        btnToggleDomainHelper.addEventListener('click', () => {
            domainHelper.classList.toggle('hidden');
        });
    }

    if (btnLogin) {
        btnLogin.addEventListener('click', () => {
            if (location.protocol === 'file:') {
                showToast('Không hỗ trợ đăng nhập Google từ file:// trực tiếp. Vui lòng khởi chạy qua server.');
                return;
            }
            if (!auth) {
                showToast('Firebase Google Auth chưa được cấu hình trên máy chủ. Hãy dùng nút Đăng nhập nhanh bên dưới!', 'info');
                return;
            }
            const provider = new firebase.auth.GoogleAuthProvider();
            auth.signInWithPopup(provider).catch((err) => {
                const code = (err && err.code) || '';
                if (code === 'auth/unauthorized-domain') {
                    if (domainHelper) domainHelper.classList.remove('hidden');
                    showToast('Tên miền chưa được thêm vào Authorized Domains — hãy sao chép tên miền ở khung hướng dẫn bên dưới!', 'error');
                } else if (
                    window.__IS_IOS_BROWSER__ &&
                    (code === 'auth/popup-blocked' ||
                        code === 'auth/operation-not-supported-in-this-environment' ||
                        code === 'auth/popup-closed-by-user')
                ) {
                    showToast('Đang chuyển hướng đăng nhập Google tương thích iOS...', 'info');
                    auth.signInWithRedirect(provider).catch((redirErr) => {
                        showToast('Lỗi đăng nhập Google: ' + ((redirErr && redirErr.message) || code));
                    });
                } else if (code === 'auth/popup-blocked') {
                    showToast('Trình duyệt đã chặn cửa sổ bật lên. Vui lòng cho phép popup hoặc dùng Đăng nhập nhanh.');
                } else {
                    showToast('Lỗi đăng nhập Google: ' + ((err && err.message) || code));
                }
            });
        });
    }

    if (btnDemoLogin) {
        btnDemoLogin.addEventListener('click', () => {
            const nameInput = document.getElementById('quick-name').value.trim();
            const emailInput = document.getElementById('quick-email').value.trim();
            if (!nameInput) {
                showToast('Vui lòng nhập tên hiển thị!', 'error');
                return;
            }
            if (!emailInput || emailInput.indexOf('@') === -1) {
                showToast('Vui lòng nhập địa chỉ email hợp lệ!', 'error');
                return;
            }
            const uid = 'local_' + btoa(unescape(encodeURIComponent(emailInput.toLowerCase()))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
            completeLocalSession({
                sub: uid,
                name: nameInput,
                email: emailInput,
                picture: '',
            });
        });
    }
})();
