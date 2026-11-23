// ========================================
        // AutoPost Pro - Modern React Application
        // ========================================

        const { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } = React;

        const DEFAULT_FIREBASE_CONFIG = {
            apiKey: "AIzaSyCvxzc0u0lxvY5JxEIWKOp59pAGb78ocdA",
            authDomain: "autopost-8f16e.firebaseapp.com",
            databaseURL: "https://autopost-8f16e-default-rtdb.firebaseio.com",
            projectId: "autopost-8f16e",
            storageBucket: "autopost-8f16e.firebasestorage.app",
            messagingSenderId: "213973905650",
            appId: "1:213973905650:web:4875b21b380eda1a2de06b"
        };

        // Dynamic Firebase handles (loaded from /api/firebase-config with repo config fallback)
        let auth = null;
        let rtdb = null;

        async function initFirebaseFromServer() {
            if (auth && rtdb) return { auth, rtdb };
            let activeConfig = DEFAULT_FIREBASE_CONFIG;
            try {
                const res = await fetch('/api/firebase-config');
                if (res.ok) {
                    const payload = await res.json();
                    if (payload.configured && payload.config) {
                        activeConfig = payload.config;
                    } else if (payload.configured === false) {
                        return { auth: null, rtdb: null };
                    }
                }
            } catch (e) {
                console.warn('Using bundled Firebase config fallback:', e.message);
            }
            try {
                if (activeConfig && typeof firebase !== 'undefined') {
                    if (!firebase.apps.length) {
                        firebase.initializeApp(activeConfig);
                    }
                    auth = firebase.auth();
                    rtdb = firebase.database();
                    return { auth, rtdb };
                }
            } catch (e) {
                console.warn('Firebase init error, using local server API:', e.message);
            }
            return { auth: null, rtdb: null };
        }

        // Validate binary ZIP signatures: Local File Header (PK\x03\x04) + End of Central Directory (PK\x05\x06)
        function isValidZipBytes(bytes) {
            if (!bytes || bytes.length < 22) return false;
            if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
                return false;
            }
            const searchStart = Math.max(0, bytes.length - 65557);
            for (let i = bytes.length - 22; i >= searchStart; i--) {
                if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
                    return true;
                }
            }
            return false;
        }

        function decodeBase64ToBytes(base64) {
            const binaryStr = window.atob(base64);
            const len = binaryStr.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }
            return bytes;
        }

        // Resilient 3-channel Extension ZIP downloader (works on Vercel Edge CDN, Vercel API, and local/iframe preview)
        async function downloadExtensionZip(version = '3.8') {
            const filename = `fb-tool-ext-v${version}.zip`;
            const cacheBust = `v=${encodeURIComponent(version)}&t=${Date.now()}`;
            let zipBytes = null;

            // Channel 1 (Primary): Direct static file on CDN / web root (zero serverless overhead on Vercel)
            try {
                const res = await fetch(`/ext-download/fb-tool-ext.zip?${cacheBust}`, {
                    credentials: 'include',
                    cache: 'no-store',
                });
                if (res.ok) {
                    const candidate = new Uint8Array(await res.arrayBuffer());
                    if (isValidZipBytes(candidate)) {
                        zipBytes = candidate;
                    }
                }
            } catch (_) {}

            // Channel 2 (Fallback): JSON Base64 API (guarded by Content-Type to prevent JSON parse errors on 500 text/HTML)
            if (!zipBytes) {
                try {
                    const apiRes = await fetch(`/api/extension-download?format=base64&${cacheBust}`, {
                        credentials: 'include',
                        cache: 'no-store',
                    });
                    const contentType = (apiRes.headers.get('content-type') || '').toLowerCase();
                    if (apiRes.ok && contentType.includes('application/json')) {
                        const payload = await apiRes.json();
                        if (payload && payload.ok && typeof payload.base64 === 'string') {
                            const decoded = decodeBase64ToBytes(payload.base64);
                            if (isValidZipBytes(decoded)) {
                                zipBytes = decoded;
                            }
                        }
                    }
                } catch (_) {}
            }

            // Channel 3 (Fallback): Direct Binary API stream
            if (!zipBytes) {
                try {
                    const binRes = await fetch(`/api/extension-download?${cacheBust}`, {
                        credentials: 'include',
                        cache: 'no-store',
                    });
                    if (binRes.ok) {
                        const candidate = new Uint8Array(await binRes.arrayBuffer());
                        if (isValidZipBytes(candidate)) {
                            zipBytes = candidate;
                        }
                    }
                } catch (_) {}
            }

            if (!zipBytes) {
                throw new Error(`Không thể tải gói Extension v${version} hợp lệ. Vui lòng thử tải lại trang.`);
            }

            const blob = new Blob([zipBytes], { type: 'application/zip' });
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);

            return {
                filename,
                sizeBytes: zipBytes.length,
                kb: Math.max(1, Math.round(zipBytes.length / 1024)),
            };
        }

        // ========================================
        // Contexts & Global State
        // ========================================
        const ThemeContext = createContext(null);
        const LanguageContext = createContext(null);
        const AppContext = createContext(null);
        const GoogleAuthContext = createContext(null);

        const storage = {
            getUserPrefix: () => {
                try {
                    const uStr = localStorage.getItem('google_user');
                    if (uStr) {
                        const u = JSON.parse(uStr);
                        if (u && u.sub) {
                            return u.sub + '_';
                        }
                    }
                } catch(e) {}
                return '';
            },
            get: (key, defaultValue) => {
                try {
                    const globalKeys = ['google_user', 'subscription', 'theme', 'lang', 'active_page', 'sidebar_collapsed', 'extension_status'];
                    const finalKey = globalKeys.includes(key) ? key : (storage.getUserPrefix() + key);
                    const item = localStorage.getItem(finalKey);
                    return item ? JSON.parse(item) : defaultValue;
                } catch (e) { return defaultValue; }
            },
            set: (key, value) => {
                try {
                    const globalKeys = ['google_user', 'subscription', 'theme', 'lang', 'active_page', 'sidebar_collapsed', 'extension_status'];
                    const finalKey = globalKeys.includes(key) ? key : (storage.getUserPrefix() + key);
                    localStorage.setItem(finalKey, JSON.stringify(value));
                } catch (e) {
                    console.warn('localStorage.setItem failed for key:', key, e.message);
                }
            },
            remove: (key) => {
                const globalKeys = ['google_user', 'subscription', 'theme', 'lang', 'active_page', 'sidebar_collapsed', 'extension_status'];
                const finalKey = globalKeys.includes(key) ? key : (storage.getUserPrefix() + key);
                localStorage.removeItem(finalKey);
            }
        };

        // IndexedDB helper for large data (images) — avoids localStorage 5MB quota
        const imageDB = {
            DB_NAME: 'AutoPostProDB',
            STORE_NAME: 'images',
            DB_VERSION: 1,
            _open() {
                return new Promise((resolve, reject) => {
                    const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
                    req.onupgradeneeded = (e) => {
                        const db = e.target.result;
                        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                            db.createObjectStore(this.STORE_NAME);
                        }
                    };
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => reject(req.error);
                });
            },
            _getKey() {
                return storage.getUserPrefix() + 'fb_post_images';
            },
            async save(images) {
                try {
                    const db = await this._open();
                    const tx = db.transaction(this.STORE_NAME, 'readwrite');
                    tx.objectStore(this.STORE_NAME).put(images, this._getKey());
                    await new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = () => reject(tx.error);
                    });
                    db.close();
                } catch (e) {
                    console.warn('imageDB.save failed:', e.message);
                }
            },
            async load() {
                try {
                    const db = await this._open();
                    const tx = db.transaction(this.STORE_NAME, 'readonly');
                    const req = tx.objectStore(this.STORE_NAME).get(this._getKey());
                    const result = await new Promise((resolve, reject) => {
                        req.onsuccess = () => resolve(req.result);
                        req.onerror = () => reject(req.error);
                    });
                    db.close();
                    return result || [];
                } catch (e) {
                    console.warn('imageDB.load failed:', e.message);
                    return [];
                }
            },
            async clear() {
                try {
                    const db = await this._open();
                    const tx = db.transaction(this.STORE_NAME, 'readwrite');
                    tx.objectStore(this.STORE_NAME).delete(this._getKey());
                    await new Promise((resolve, reject) => {
                        tx.oncomplete = resolve;
                        tx.onerror = () => reject(tx.error);
                    });
                    db.close();
                } catch (e) {
                    console.warn('imageDB.clear failed:', e.message);
                }
            }
        };

        const translations = {
            vi: {
                app_name: 'AutoPost Pro',
                dashboard: 'Dashboard',
                new_campaign: 'Chiến dịch mới',
                campaign_desc: 'Thiết lập nội dung và cấu hình tự động đăng bài lên nhóm Facebook.',
                system_active: 'Hệ thống hoạt động',
                login_fb: 'Đăng nhập Facebook',
                logout: 'Đăng xuất',
                editor_title: 'Soạn Thảo Nội Dung',
                gen_gemini: 'Gen với Gemini',
                gen_generating: 'Đang tạo...',
                prompt_label: 'Prompt cho Gemini',
                prompt_select: '-- Chọn prompt có sẵn --',
                custom_prompt: 'Tự nhập prompt...',
                image_label: 'Hình ảnh đính kèm',
                drag_drop: 'Kéo thả ảnh hoặc tải lên',
                spin_content: 'AI chống spam từng nhóm',
                spin_desc: 'Tự động viết bài chuyên nghiệp khác biệt cho mỗi nhóm khi đăng',
                groups_title: 'Nhóm Facebook',
                scan_groups: 'Quét Nhóm từ Facebook',
                scanning: 'Đang quét...',
                search_placeholder: 'Tìm kiếm nhóm...',
                selected: 'Đã chọn:',
                select_all: 'Chọn tất cả',
                deselect_all: 'Bỏ chọn tất cả',
                start_post: 'Bắt đầu đăng',
                posting: 'Đang đăng...',
                progress_title: 'Kết Quả Đăng Bài',
                progress: 'Tiến độ:',
                stop: 'Dừng lại',
                ideas_title: 'Ý tưởng & Prompts đã lưu',
                add_idea: 'Thêm ý tưởng',
                no_ideas: 'Chưa có ý tưởng nào. Nhấn "Thêm ý tưởng" để lưu lại.',
                settings_delay: 'Posting Delays',
                min_sec: 'Min (giây)',
                max_sec: 'Max (giây)',
                settings_gemini: 'Gemini AI',
                api_key: 'Gemini API Key',
                model: 'Model',
                get_api_key: 'Lấy API Key',
                save: 'Lưu',
                cancel: 'Hủy',
                title: 'Tiêu đề',
                content: 'Nội dung / Prompt',
                toast_success: 'Thành công',
                toast_error: 'Lỗi',
                toast_warning: 'Cảnh báo',
                toast_info: 'Thông tin',
                // Page Posts Feature
                tab_groups: 'Nhóm',
                tab_page_posts: 'Bài viết trang',
                page_posts_title: 'Bài viết từ Trang',
                page_url_placeholder: 'Nhập URL trang Facebook...',
                scan_page_posts: 'Quét bài viết',
                scanning_posts: 'Đang quét...',
                share_selected: 'Chia sẻ bài đã chọn',
                no_posts_found: 'Chưa có bài viết nào',
                select_posts: 'Chọn bài viết để chia sẻ',
                post_shared: 'Đã chia sẻ thành công',
                sharing: 'Đang chia sẻ...',
                // Sidebar Navigation
                nav_post: 'Đăng bài',
                nav_share: 'Chia sẻ',
                nav_post_desc: 'Đăng nội dung mới lên nhóm',
                nav_share_desc: 'Chia sẻ bài viết từ trang',
                your_pages: 'Pages của bạn',
                or_enter_url: 'Hoặc nhập URL',
                fetch_pages: 'Lấy danh sách Pages',
                select_page: 'Chọn Page để quét bài viết',
                // Subscription
                nav_subscription: 'Gói dịch vụ',
                nav_subscription_desc: 'Quản lý gói & gia hạn',
                sub_title: 'Chọn Gói Dịch Vụ',
                sub_desc: 'Nâng cấp để sử dụng đầy đủ tính năng AutoPost Pro',
                sub_free: 'Miễn phí',
                sub_pro: 'Pro',
                sub_enterprise: 'Enterprise',
                sub_month: 'tháng',
                sub_current_plan: 'Gói hiện tại',
                sub_upgrade: 'Nâng cấp ngay',
                sub_renew: 'Gia hạn',
                sub_expired: 'Đã hết hạn',
                sub_active: 'Đang hoạt động',
                sub_days_left: 'ngày còn lại',
                sub_login_google: 'Đăng nhập Google để sử dụng',
                sub_login_google_desc: 'Bạn cần đăng nhập bằng tài khoản Google để quản lý gói dịch vụ',
                sub_logout_google: 'Đăng xuất Google',
                sub_features_free: 'Đăng 5 bài/ngày|3 nhóm tối đa|Không có AI rewrite',
                sub_features_pro: 'Đăng không giới hạn|Nhóm không giới hạn|AI rewrite nội dung|Hỗ trợ ưu tiên',
                sub_features_ent: 'Tất cả tính năng Pro|Multi-account|API access|Hỗ trợ 24/7 riêng',
                sub_contact: 'Liên hệ',
                sub_require_login: 'Vui lòng đăng nhập Google để sử dụng tính năng này',
                sub_expire_date: 'Ngày hết hạn',
                sub_plan_info: 'Thông tin gói',
                sub_history: 'Lịch sử gia hạn',
                sub_no_history: 'Chưa có lịch sử gia hạn',
                sub_payment_method: 'Phương thức thanh toán',
                sub_bank_transfer: 'Chuyển khoản ngân hàng',
                sub_confirm_payment: 'Xác nhận đã thanh toán',
                sub_pending: 'Đang chờ xác nhận',
                sub_approved: 'Đã duyệt',
                onboarding_title: 'Hoàn tất thiết lập',
                onboarding_subtitle: 'Vui lòng hoàn thành các bước bên dưới để bắt đầu sử dụng FBTool',
                step_login: 'Đăng nhập Google',
                step_subscription: 'Kiểm tra gói dịch vụ',
                step_facebook: 'Kết nối Facebook',
                step_groups: 'Quét danh sách nhóm',
                step_done: 'Sẵn sàng sử dụng',
                btn_continue: 'Tiếp tục',
                btn_start_now: 'Bắt đầu ngay',
                btn_connect_fb: 'Kết nối Facebook',
                btn_scan_groups: 'Quét nhóm ngay',
                sub_status_active: 'Đã kích hoạt',
                sub_status_free: 'Chưa có gói (Free)',
                sub_status_expired: 'Hết hạn',
                // Extension Download
                step_extension: 'Cài đặt Extension',
                ext_download_title: 'Tải & Cài đặt Extension',
                ext_download_desc: 'Extension là bộ não giúp FBTool tương tác với Facebook. Bạn cần cài đặt trước khi sử dụng.',
                ext_download_btn: 'Tải Extension (.zip)',
                ext_download_recheck: 'Kiểm tra lại',
                ext_download_checking: 'Đang kiểm tra...',
                ext_guide_title: 'Hướng dẫn cài đặt',
                ext_guide_step1: 'Tải file .zip bên trên',
                ext_guide_step2: 'Giải nén file .zip',
                ext_guide_step3: 'Mở Chrome, vào chrome://extensions',
                ext_guide_step4: 'Bật "Developer mode" (Chế độ nhà phát triển)',
                ext_guide_step5: 'Nhấn "Load unpacked" → chọn thư mục đã giải nén',
                ext_guide_step6: 'Quay lại trang này và nhấn "Kiểm tra lại"'
            },
            en: {
                app_name: 'AutoPost Pro',
                dashboard: 'Dashboard',
                new_campaign: 'New Campaign',
                campaign_desc: 'Setup content and configuration for auto-posting to Facebook groups.',
                system_active: 'System Active',
                login_fb: 'Login Facebook',
                logout: 'Logout',
                editor_title: 'Content Editor',
                gen_gemini: 'Gen with Gemini',
                gen_generating: 'Generating...',
                prompt_label: 'Gemini Prompt',
                prompt_select: '-- Select preset --',
                custom_prompt: 'Custom prompt...',
                image_label: 'Attached Images',
                drag_drop: 'Drag & drop or upload',
                spin_content: 'AI Anti-Spam per Group',
                spin_desc: 'Automatically craft a distinct professional post for every group',
                groups_title: 'Facebook Groups',
                scan_groups: 'Scan Groups',
                scanning: 'Scanning...',
                search_placeholder: 'Search groups...',
                selected: 'Selected:',
                select_all: 'Select All',
                deselect_all: 'Deselect All',
                start_post: 'Start Posting',
                posting: 'Posting...',
                progress_title: 'Posting Results',
                progress: 'Progress:',
                stop: 'Stop',
                ideas_title: 'Saved Ideas & Prompts',
                add_idea: 'Add Idea',
                no_ideas: 'No ideas yet. Click "Add Idea" to save one.',
                settings_delay: 'Posting Delays',
                min_sec: 'Min (sec)',
                max_sec: 'Max (sec)',
                settings_gemini: 'Gemini AI',
                api_key: 'Gemini API Key',
                model: 'Model',
                get_api_key: 'Get API Key',
                save: 'Save',
                cancel: 'Cancel',
                title: 'Title',
                content: 'Content / Prompt',
                toast_success: 'Success',
                toast_error: 'Error',
                toast_warning: 'Warning',
                toast_info: 'Info',
                // Page Posts Feature
                tab_groups: 'Groups',
                tab_page_posts: 'Page Posts',
                page_posts_title: 'Posts from Page',
                page_url_placeholder: 'Enter Facebook Page URL...',
                scan_page_posts: 'Scan Posts',
                scanning_posts: 'Scanning...',
                share_selected: 'Share Selected',
                no_posts_found: 'No posts found',
                select_posts: 'Select posts to share',
                post_shared: 'Shared successfully',
                sharing: 'Sharing...',
                // Sidebar Navigation
                nav_post: 'Create Post',
                nav_share: 'Share Posts',
                nav_post_desc: 'Create new posts to groups',
                nav_share_desc: 'Share posts from Pages',
                your_pages: 'Your Pages',
                or_enter_url: 'Or enter URL',
                fetch_pages: 'Fetch Pages',
                select_page: 'Select a Page to scan posts',
                // Subscription
                nav_subscription: 'Subscription',
                nav_subscription_desc: 'Manage plans & renew',
                sub_title: 'Choose Your Plan',
                sub_desc: 'Upgrade to unlock all AutoPost Pro features',
                sub_free: 'Free',
                sub_pro: 'Pro',
                sub_enterprise: 'Enterprise',
                sub_month: 'month',
                sub_current_plan: 'Current Plan',
                sub_upgrade: 'Upgrade Now',
                sub_renew: 'Renew',
                sub_expired: 'Expired',
                sub_active: 'Active',
                sub_days_left: 'days left',
                sub_login_google: 'Sign in with Google',
                sub_login_google_desc: 'You need to sign in with Google to manage subscriptions',
                sub_logout_google: 'Sign out Google',
                sub_features_free: '5 posts/day|3 groups max|No AI rewrite',
                sub_features_pro: 'Unlimited posts|Unlimited groups|AI content rewrite|Priority support',
                sub_features_ent: 'All Pro features|Multi-account|API access|Dedicated 24/7 support',
                sub_contact: 'Contact',
                sub_require_login: 'Please sign in with Google to use this feature',
                sub_expire_date: 'Expiry Date',
                sub_plan_info: 'Plan Info',
                sub_history: 'Renewal History',
                sub_no_history: 'No renewal history',
                sub_payment_method: 'Payment Method',
                sub_bank_transfer: 'Bank Transfer',
                sub_confirm_payment: 'Confirm Payment',
                sub_pending: 'Pending',
                sub_approved: 'Approved',
                onboarding_title: 'Complete Setup',
                onboarding_subtitle: 'Please complete the following steps to start using FBTool',
                step_login: 'Google Login',
                step_subscription: 'Check Subscription',
                step_facebook: 'Connect Facebook',
                step_groups: 'Scan Groups',
                step_done: 'Ready to use',
                btn_continue: 'Continue',
                btn_start_now: 'Start Now',
                btn_connect_fb: 'Connect Facebook',
                btn_scan_groups: 'Scan Groups Now',
                sub_status_active: 'Active',
                sub_status_free: 'Free Plan',
                sub_status_expired: 'Expired',
                // Extension Download
                step_extension: 'Install Extension',
                ext_download_title: 'Download & Install Extension',
                ext_download_desc: 'The extension is the brain that helps FBTool interact with Facebook. You need to install it first.',
                ext_download_btn: 'Download Extension (.zip)',
                ext_download_recheck: 'Re-check',
                ext_download_checking: 'Checking...',
                ext_guide_title: 'Installation Guide',
                ext_guide_step1: 'Download the .zip file above',
                ext_guide_step2: 'Unzip the .zip file',
                ext_guide_step3: 'Open Chrome, go to chrome://extensions',
                ext_guide_step4: 'Enable "Developer mode"',
                ext_guide_step5: 'Click "Load unpacked" → select the unzipped folder',
                ext_guide_step6: 'Return to this page and click "Re-check"'
            }
        };

        // ========================================
        // Component Definitions
        // ========================================
        function SettingsDelay({ delayMin, setDelayMin, delayMax, setDelayMax, postingCountdown, postMode, setPostMode, t }) {
            const hasCountdown = postingCountdown && postingCountdown.current > 0;
            return (
                <div className={`relative bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 p-6 flex flex-col justify-between hover:shadow-soft transition-all duration-500 overflow-hidden ${hasCountdown ? 'ring-2 ring-primary bg-gradient-to-br from-indigo-50/50 to-purple-50/30 dark:from-indigo-950/20 dark:to-purple-950/20' : ''}`}>
                    {hasCountdown && (
                        <div className="absolute inset-0 bg-primary/[0.02] dark:bg-primary/[0.05] animate-pulse pointer-events-none" />
                    )}
                    <div>
                        <div className="flex items-center justify-between mb-5">
                             <div className="flex items-center gap-3">
                                <div className={`p-1.5 rounded-md transition-colors duration-300 ${hasCountdown ? 'bg-rose-500 text-white animate-bounce' : 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400'}`}>
                                    <span className="material-symbols-outlined text-[20px]">{hasCountdown ? 'alarm_on' : 'timer'}</span>
                                </div>
                                <h3 className="font-semibold text-base text-text-main dark:text-white">{t('settings_delay')}</h3>
                            </div>
                            {hasCountdown && (
                                <span className="inline-flex px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-rose-500 text-white animate-pulse">
                                    Đang chờ đăng...
                                </span>
                            )}
                        </div>

                        {hasCountdown ? (
                            <div className="flex flex-col items-center justify-center py-4 mb-4 relative">
                                <div className="relative flex items-center justify-center w-24 h-24">
                                    <svg className="w-full h-full transform -rotate-90">
                                        <circle 
                                            cx="48" 
                                            cy="48" 
                                            r="40" 
                                            stroke="currentColor" 
                                            strokeWidth="6" 
                                            className="text-slate-100 dark:text-slate-700" 
                                            fill="transparent" 
                                        />
                                        <circle 
                                            cx="48" 
                                            cy="48" 
                                            r="40" 
                                            stroke="currentColor" 
                                            strokeWidth="6" 
                                            className="text-primary transition-all duration-1000" 
                                            fill="transparent" 
                                            strokeDasharray={251.2}
                                            strokeDashoffset={251.2 - (251.2 * postingCountdown.current) / postingCountdown.total}
                                        />
                                    </svg>
                                    <div className="absolute flex flex-col items-center justify-center">
                                        <span className="text-3xl font-black text-text-main dark:text-white font-mono animate-pulse">
                                            {postingCountdown.current}
                                        </span>
                                        <span className="text-[8px] font-extrabold uppercase tracking-widest text-text-secondary">giây</span>
                                    </div>
                                </div>
                                <div className="mt-4 text-center">
                                    <p className="text-xs font-semibold text-text-main dark:text-white">Đang đếm ngược</p>
                                    <p className="text-[10px] text-text-secondary mt-0.5 font-medium">Đợi đăng nhóm tiếp theo</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div className="relative">
                                        <label className="block text-xxs font-bold text-text-secondary uppercase tracking-widest mb-1.5">{t('min_sec')}</label>
                                        <input
                                            type="number"
                                            min="5"
                                            value={Number.isFinite(delayMin) ? delayMin : ''}
                                            onChange={e => {
                                                const raw = e.target.value;
                                                if (raw === '') return setDelayMin('');
                                                const val = parseInt(raw, 10);
                                                setDelayMin(Number.isNaN(val) ? 10 : Math.max(5, val));
                                            }}
                                            onBlur={() => {
                                                const safeMin = Number.isFinite(Number(delayMin)) && Number(delayMin) >= 5 ? Math.floor(Number(delayMin)) : 10;
                                                setDelayMin(safeMin);
                                                storage.set('fb_delay_min', safeMin);
                                                if (!Number.isFinite(Number(delayMax)) || Number(delayMax) <= safeMin) {
                                                    const nextMax = safeMin + 30;
                                                    setDelayMax(nextMax);
                                                    storage.set('fb_delay_max', nextMax);
                                                }
                                            }}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono text-center font-semibold text-text-main dark:text-white shadow-sm text-sm"
                                        />
                                    </div>
                                    <div className="relative">
                                        <label className="block text-xxs font-bold text-text-secondary uppercase tracking-widest mb-1.5">{t('max_sec')}</label>
                                        <input
                                            type="number"
                                            min="10"
                                            value={Number.isFinite(delayMax) ? delayMax : ''}
                                            onChange={e => {
                                                const raw = e.target.value;
                                                if (raw === '') return setDelayMax('');
                                                const val = parseInt(raw, 10);
                                                setDelayMax(Number.isNaN(val) ? 30 : Math.max(10, val));
                                            }}
                                            onBlur={() => {
                                                const safeMin = Number.isFinite(Number(delayMin)) && Number(delayMin) >= 5 ? Math.floor(Number(delayMin)) : 10;
                                                const safeMax = Number.isFinite(Number(delayMax)) && Number(delayMax) > safeMin ? Math.floor(Number(delayMax)) : safeMin + 30;
                                                setDelayMax(safeMax);
                                                storage.set('fb_delay_max', safeMax);
                                            }}
                                            className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono text-center font-semibold text-text-main dark:text-white shadow-sm text-sm"
                                        />
                                    </div>
                                </div>
                                <div className="relative mb-4">
                                    <label className="block text-xxs font-bold text-text-secondary uppercase tracking-widest mb-1.5">Chế độ đăng bài</label>
                                    <select 
                                        value={postMode || 'desktop'} 
                                        onChange={e => {
                                            const mode = e.target.value;
                                            setPostMode(mode);
                                            storage.set('fb_post_mode', mode);
                                        }} 
                                        className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-semibold text-text-main dark:text-white shadow-sm text-xs cursor-pointer outline-none transition-colors"
                                    >
                                        <option value="desktop">🕶️ Tab ngầm (Không chiếm màn hình - Mặc định)</option>
                                        <option value="desktop_visible">🖥️ Hiển thị tab (Gỡ lỗi trực tiếp)</option>
                                        <option value="mobile">📱 Mobile Mode (Mbasic - Chạy ẩn)</option>
                                    </select>
                                    <p className="mt-1.5 text-[11px] text-text-secondary leading-snug">
                                        {(postMode || 'desktop') === 'desktop'
                                            ? 'Tự mở tab ngầm riêng để đăng từng nhóm rồi tự đóng, không nhảy tab hay ảnh hưởng các công việc khác.'
                                            : postMode === 'desktop_visible'
                                                ? 'Hiển thị trực tiếp tab Facebook khi đăng để bạn theo dõi thao tác.'
                                                : 'Gửi yêu cầu trực tiếp qua giao diện Mbasic không cần mở tab.'}
                                    </p>
                                </div>
                            </>
                        )}
                    </div>
                    <div className="flex items-start gap-2.5 bg-indigo-50/50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300 px-3.5 py-3 rounded-lg text-xs leading-relaxed border border-indigo-100 dark:border-indigo-800/50">
                        <span className="material-symbols-outlined text-[16px] mt-0.5 shrink-0">info</span>
                        <span>Setting a random delay between <span className="font-bold">60s-300s</span> is recommended.</span>
                    </div>
                </div>
            );
        }

        function SettingsAI({ model, setModel, writingStyle, setWritingStyle, customPrompt, setCustomPrompt, defaultPrompt, t, addLog, showToast }) {
            const [isTesting, setIsTesting] = useState(false);
            const [showPromptEditor, setShowPromptEditor] = useState(false);

            return (
                <div className="bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 p-6 relative overflow-hidden group hover:shadow-soft transition-shadow duration-300">
                    <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                        <span className="flex h-2.5 w-2.5">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500"></span>
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mb-5">
                        <div className="p-1.5 bg-purple-50 dark:bg-purple-900/30 rounded-md text-purple-600 dark:text-purple-400">
                            <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
                        </div>
                        <div>
                            <h3 className="font-semibold text-base text-text-main dark:text-white">{t('settings_gemini')}</h3>
                            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">AI xử lý trực tiếp trên máy chủ · Chống spam đa góc viết</p>
                        </div>
                    </div>

                    <div className="flex flex-col gap-3 mb-4">
                        <div className="flex flex-col">
                            <label htmlFor="gemini-model-select" className="text-xs font-semibold text-text-secondary mb-1.5">{t('model')}</label>
                            <select
                                id="gemini-model-select"
                                value={['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].includes(model) ? model : 'gemini-3.1-flash-lite'}
                                onChange={e => setModel(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-xl text-xs font-medium text-text-main dark:text-gray-200 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none cursor-pointer"
                            >
                                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Khuyên dùng trên Vercel · Siêu nhanh)</option>
                                <option value="gemini-4-hydrogen">Gemini 4 Hydrogen (Cân bằng chất lượng)</option>
                            </select>
                        </div>

                        <div className="flex flex-col">
                            <label htmlFor="ai-writing-style-select" className="text-xs font-semibold text-text-secondary mb-1.5">Phong cách viết bài AI</label>
                            <select
                                id="ai-writing-style-select"
                                value={writingStyle || 'auto'}
                                onChange={e => setWritingStyle(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-xl text-xs font-medium text-text-main dark:text-gray-200 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none cursor-pointer"
                            >
                                <option value="auto">Đa dạng tự động (Chống spam tối đa · 8 góc viết)</option>
                                <option value="professional">Chuyên nghiệp &amp; Cao cấp</option>
                                <option value="friendly">Thân thiện cộng đồng (Tự nhiên trong nhóm)</option>
                                <option value="promo">Chốt đơn &amp; Ưu đãi mạnh</option>
                                <option value="concise">Ngắn gọn súc tích (Chuẩn đọc trên di động)</option>
                            </select>
                        </div>
                    </div>

                    <div className="mb-4 pt-3 border-t border-border-light/50">
                        <div className="flex items-center justify-between mb-1.5">
                            <button
                                type="button"
                                onClick={() => setShowPromptEditor(!showPromptEditor)}
                                className="text-xs font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
                            >
                                <span className="material-symbols-outlined text-[15px]">tune</span>
                                {showPromptEditor ? 'Ẩn Prompt tùy chỉnh' : 'Tùy chỉnh Prompt viết lại'}
                            </button>
                            {showPromptEditor && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setCustomPrompt(defaultPrompt);
                                        showToast('Đã khôi phục Prompt mặc định', 'info');
                                    }}
                                    className="text-[10px] font-semibold text-text-secondary hover:text-primary"
                                >
                                    Mặc định
                                </button>
                            )}
                        </div>
                        {showPromptEditor && (
                            <textarea
                                value={customPrompt}
                                onChange={e => setCustomPrompt(e.target.value)}
                                rows={4}
                                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-xl text-[11px] font-mono text-text-main dark:text-gray-200 focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none"
                                placeholder="Dùng {{content}} làm vị trí nội dung gốc..."
                            />
                        )}
                    </div>

                    <div className="mt-2">
                        <button
                            type="button"
                            disabled={isTesting}
                            onClick={async () => {
                                setIsTesting(true);
                                addLog('info', `🔍 Đang kiểm tra kết nối Gemini AI (${model})...`);
                                try {
                                    const res = await fetch('/api/gemini/test', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ model })
                                    });
                                    const rawText = await res.text();
                                    let data = {};
                                    try { data = rawText ? JSON.parse(rawText) : {}; } catch (_) {}
                                    if (res.ok && data.ok) {
                                        addLog('success', `✅ Kết nối Gemini AI sẵn sàng! (${data.model} - ${data.latencyMs}ms)`);
                                        showToast(`Kết nối Gemini AI thành công (${data.latencyMs}ms)!`, 'success');
                                    } else {
                                        const fallbackErr = res.status === 504
                                            ? 'Máy chủ Vercel hết thời gian chờ (504). Hãy thử chọn Gemini 3.1 Flash Lite.'
                                            : (rawText && !rawText.trim().startsWith('<') ? rawText.trim().slice(0, 180) : `Lỗi máy chủ (HTTP ${res.status})`);
                                        throw new Error(data.error || fallbackErr);
                                    }
                                } catch (e) {
                                    addLog('error', `❌ Lỗi kết nối AI: ${e.message}`);
                                    showToast(e.message, 'error');
                                } finally {
                                    setIsTesting(false);
                                }
                            }}
                            className="w-full py-2.5 bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 disabled:opacity-60 text-text-secondary dark:text-gray-200 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 border border-border-light dark:border-slate-700"
                        >
                            <span className={`material-symbols-outlined text-[18px] ${isTesting ? 'animate-spin' : ''}`}>
                                {isTesting ? 'progress_activity' : 'api'}
                            </span>
                            {isTesting ? 'Đang kiểm tra...' : 'Kiểm tra kết nối AI'}
                        </button>
                    </div>
                </div>
            );
        }
        function App() {
            const [theme, setTheme] = useState(() => storage.get('theme', 'light'));
            const [lang, setLang] = useState(() => storage.get('lang', 'vi'));
            const t = (key) => {
                let text = translations[lang][key] || key;
                if (typeof text === 'string') {
                    return text.replace(/AutoPost Pro/g, settings.appName || 'AutoPost Pro');
                }
                return text;
            };
            const [extensionStatus, setExtensionStatus] = useState(() => storage.get('extension_status', false));
            const [settings, setSettings] = useState({
                appName: 'AutoPost Pro',
                logoUrl: '',
                bankName: 'mbbank',
                bankNo: '0886041173',
                bankUser: 'HOANG PHUONG ANH',
                qrTemplate: 'https://img.vietqr.io/image/mbbank-0886041173-compact.png'
            });
            const [fbUser, setFbUser] = useState(() => storage.get('fb_user_info', null));
            const [content, setContent] = useState(() => storage.get('fb_post_content', '') || '');
            const [groups, setGroups] = useState(() => storage.get('fb_groups', []));
            const [selectedGroups, setSelectedGroups] = useState(() => new Set(storage.get('fb_selected_groups', [])));
            const [images, setImages] = useState([]);

            // Load images from IndexedDB on mount (async)
            useEffect(() => {
                imageDB.load().then(saved => {
                    if (saved && saved.length > 0) setImages(saved);
                });
                // Also clean up any old localStorage images to free space
                try {
                    const oldKey = storage.getUserPrefix() + 'fb_post_images';
                    if (localStorage.getItem(oldKey)) {
                        localStorage.removeItem(oldKey);
                    }
                } catch(e) {}
            }, []);
            const [isPosting, setIsPosting] = useState(false);
            const [safeDelayMin, setSafeDelayMin] = useState(() => storage.get('fb_delay_min', 60));
            const [safeDelayMax, setSafeDelayMax] = useState(() => storage.get('fb_delay_max', 120));
            const [postMode, setPostMode] = useState(() => storage.get('fb_post_mode', 'desktop'));
            const [model, setModel] = useState(() => {
                const saved = storage.get('gemini_model', 'gemini-3.1-flash-lite');
                return ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].includes(saved) ? saved : 'gemini-3.1-flash-lite';
            });
            const [previewMode, setPreviewMode] = useState(() => {
                const params = new URLSearchParams(window.location.search);
                if (params.get('autostart') === '1') return true;
                return storage.get('preview_mode', false);
            });
            useEffect(() => {
                if (previewMode && !fbUser) {
                    setFbUser({
                        userName: 'Tài khoản Facebook (Xem trước)',
                        userId: 'preview_fb',
                        userAvatar: ''
                    });
                }
            }, [previewMode, fbUser]);
            const [firebaseReady, setFirebaseReady] = useState(false);
            const groupsRef = useRef(groups);
            useEffect(() => { groupsRef.current = groups; }, [groups]);
            const stopPostingRef = useRef(false);
            const typingIntervalRef = useRef(null);
            const userSettingsLoadedRef = useRef(false);
            const defaultPrompt = `Viết lại nội dung sau thành một bài đăng Facebook tự nhiên, mạch lạc, khác biệt hoàn toàn về cách diễn đạt để chống trùng lặp khi đăng nhiều nhóm và trình bày thoáng mắt trên điện thoại.

BỐ CỤC LINH HOẠT (CHỈ đưa vào những phần CÓ THẬT trong bài gốc, tách đoạn bằng 1 dòng trống):
- Giữ đúng thể loại bài gốc (nếu là bài chia sẻ / kể chuyện / tâm sự thì giữ giọng tự nhiên gần gũi; nếu là bài bán hàng thì trình bày rõ ràng, thuyết phục).
- Mở đầu thu hút tự nhiên (KHÔNG viết toàn bộ chữ IN HOA gây cảm giác spam).
- Các ý chính rõ ràng: mỗi ý dùng 1 emoji phù hợp ở đầu dòng và XUỐNG DÒNG RIÊNG.
- Nếu bài gốc có giá bán, ưu đãi, địa chỉ, giờ mở cửa hoặc SĐT/Zalo: giữ nguyên 100% thông tin thật đó.

NGUYÊN TẮC CẤM TUYỆT ĐỐI:
- TUYỆT ĐỐI KHÔNG tự bịa thêm số điện thoại, Zalo, Hotline, địa chỉ, giờ mở cửa, giá bán, khuyến mãi hay #hashtag nếu bài gốc KHÔNG CÓ.
- Không dùng ký tự markdown (**in đậm**, *in nghiêng*, \`\`\`, ###).
- Không thêm lời giải thích hay ghi chú ("Dưới đây là", "Biến thể", "Final", "Note").
- Chỉ trả về duy nhất nội dung bài viết hoàn chỉnh bằng tiếng Việt.

Input:
{{content}}`;
            const [customPrompt, setCustomPrompt] = useState(() => storage.get('ai_custom_prompt', defaultPrompt));
            const [writingStyle, setWritingStyle] = useState(() => storage.get('ai_writing_style', 'auto'));
            const [isGeneratingVariations, setIsGeneratingVariations] = useState(false);
            const [toasts, setToasts] = useState([]);
            const toastTimersRef = useRef(new Map());
            const [logs, setLogs] = useState([]);
            const [progress, setProgress] = useState(0);
            const [isRewriting, setIsRewriting] = useState(false);
            const [collections, setCollections] = useState(() => storage.get('favorite_group_collections', []));

            // Page Posts Feature State
            const [activeTab, setActiveTab] = useState('groups'); // 'groups' | 'page_posts'
            const [pageUrl, setPageUrl] = useState('');
            const [pagePosts, setPagePosts] = useState([]);
            const [selectedPosts, setSelectedPosts] = useState(new Set());
            const [shareCaption, setShareCaption] = useState('');
            const [isScanning, setIsScanning] = useState(false);
            const [isScanningGroups, setIsScanningGroups] = useState(false); // Track group scan
            const REQUIRED_EXT_VERSION = '3.8';
            const [installedExtVersion, setInstalledExtVersion] = useState(() => (typeof document !== 'undefined' ? (document.documentElement?.dataset?.fbToolInstalled || '') : ''));
            const [duplicateExtCount, setDuplicateExtCount] = useState(0);
            const seenExtIdsRef = useRef(new Set());
            const [isSharing, setIsSharing] = useState(false);
            const stopSharingRef = useRef(false);
            const [shareCountdown, setShareCountdown] = useState(null); // null or { current, total, nextGroupName }
            const [shareDelayMin, setShareDelayMin] = useState(() => storage.get('share_delay_min', 10));
            const [shareDelayMax, setShareDelayMax] = useState(() => storage.get('share_delay_max', 20));
            const [postingCountdown, setPostingCountdown] = useState(null); // null or { current, total }
            const [successItems, setSuccessItems] = useState(() => {
                const saved = storage.get('success_items', []);
                return Array.isArray(saved) ? saved.slice(0, 100) : [];
            });
            const successItemsRef = useRef(successItems);
            useEffect(() => {
                successItemsRef.current = successItems;
                storage.set('success_items', successItems.slice(0, 100));
            }, [successItems]);
            const [isCheckingStatus, setIsCheckingStatus] = useState(false);
            const [checkProgress, setCheckProgress] = useState(null); // { done, total }
            const stopStatusCheckRef = useRef(false);
            const pendingStatusChecksRef = useRef(new Map());
            const autoCheckQueueRef = useRef([]);
            const autoCheckRunningRef = useRef(false);

            const resolvePageFromUrl = () => {
                if (typeof window !== 'undefined') {
                    if (window.__AUTOPOST_INITIAL_PAGE__) return window.__AUTOPOST_INITIAL_PAGE__;
                    const path = (window.location.pathname || '/').toLowerCase();
                    if (path.startsWith('/share')) return 'share';
                    if (path.startsWith('/pricing') || path.startsWith('/subscription')) return 'subscription';
                }
                return 'post';
            };

            const PAGE_ROUTES = {
                post: '/',
                share: '/share',
                subscription: '/pricing'
            };

            // Main Navigation State - Multi-Page synced
            const [activePage, setActivePageState] = useState(resolvePageFromUrl); // 'post' | 'share' | 'subscription'
            const setActivePage = useCallback((nextPage) => {
                const targetUrl = PAGE_ROUTES[nextPage] || '/';
                const currentPath = (window.location.pathname || '/').replace(/\.html$/i, '') || '/';
                const normalizedCurrent = currentPath === '/index' ? '/' : currentPath;
                if (normalizedCurrent !== targetUrl && window.location.protocol !== 'file:') {
                    storage.set('active_page', nextPage);
                    window.location.href = targetUrl;
                    return;
                }
                setActivePageState(nextPage);
            }, []);
            const [fbPages, setFbPages] = useState([]); // User's managed Facebook Pages
            const [selectedPage, setSelectedPage] = useState(null);
            const [isFetchingPages, setIsFetchingPages] = useState(false);
            const [sidebarCollapsed, setSidebarCollapsed] = useState(() => storage.get('sidebar_collapsed', false));
            // Spin Content state - Default ON
            const [spinEnabled, setSpinEnabled] = useState(true);

            // ========================================
            // Google Auth & Subscription State
            // ========================================
            const [googleUser, setGoogleUser] = useState(() => storage.get('google_user', null));
            const [authInitialized, setAuthInitialized] = useState(() => Boolean(storage.get('preview_mode', false) || storage.get('google_user', null) || window.__AUTOPOST_INITIAL_PAGE__ === 'subscription'));
            const [subscription, setSubscription] = useState(() => storage.get('subscription', {
                plan: 'free', // 'free' | 'pro' | 'enterprise'
                expiresAt: null,
                status: 'active', // 'active' | 'expired' | 'pending'
                history: []
            }));
            const [showPaymentModal, setShowPaymentModal] = useState(false);
            const [selectedPlan, setSelectedPlan] = useState(null);
            const [userRole, setUserRole] = useState('user');
            const [timeTick, setTimeTick] = useState(0);

            useEffect(() => {
                const interval = setInterval(() => {
                    setTimeTick(prev => prev + 1);
                }, 60000);
                return () => clearInterval(interval);
            }, []);

            // Google Sign-In handler (Unified Shared Login)
            const handleGoogleLogin = useCallback(() => {
                const currentRoute = PAGE_ROUTES[activePage] || '/';
                window.location.href = `/login?redirect=${encodeURIComponent(currentRoute)}`;
            }, [activePage]);

            const handleGoogleLogout = useCallback(() => {
                const clearLocal = () => {
                    setGoogleUser(null);
                    setSubscription({
                        plan: 'free',
                        expiresAt: null,
                        status: 'active',
                        history: []
                    });
                    storage.remove('google_user');
                    storage.remove('subscription');
                    storage.remove('extension_status');
                    showToast('Đã đăng xuất Google', 'info');
                };

                if (auth) {
                    auth.signOut().then(clearLocal).then(() => {
                        window.location.reload();
                    }).catch(e => {
                        console.error('Sign out error:', e);
                        clearLocal();
                        window.location.reload();
                    });
                } else {
                    clearLocal();
                    window.location.reload();
                }
            }, []);

            // Firebase & Local Auth Bootstrap Listener
            useEffect(() => {
                let unsub = null;
                let cancelled = false;
                const safetyTimer = setTimeout(() => {
                    if (!cancelled) setAuthInitialized(true);
                }, 700);

                initFirebaseFromServer().then(({ auth: fbAuth }) => {
                    if (cancelled) return;
                    setFirebaseReady(true);

                    if (!fbAuth) {
                        clearTimeout(safetyTimer);
                        const cachedRole = storage.get('user_role', 'user');
                        if (cachedRole) setUserRole(cachedRole);
                        setAuthInitialized(true);
                        return;
                    }

                    unsub = fbAuth.onAuthStateChanged(user => {
                        clearTimeout(safetyTimer);
                        if (user) {
                            const storageUser = {
                                name: user.displayName,
                                email: user.email,
                                picture: user.photoURL,
                                sub: user.uid,
                                isFirebaseAuth: true
                            };
                            setGoogleUser(storageUser);
                            storage.set('google_user', storageUser);
                        } else {
                            const cachedUser = storage.get('google_user', null);
                            if (!cachedUser || cachedUser.isFirebaseAuth) {
                                setGoogleUser(null);
                            }
                        }
                        setAuthInitialized(true);
                    });
                });

                return () => {
                    cancelled = true;
                    clearTimeout(safetyTimer);
                    if (typeof unsub === 'function') unsub();
                };
            }, []);

            // System Settings Listener (Firebase RTDB when authenticated, else local /api/settings)
            useEffect(() => {
                const loadLocalSettings = () => {
                    fetch('/api/settings')
                        .then(r => r.ok ? r.json() : null)
                        .then(val => {
                            if (val) {
                                setSettings({
                                    appName: val.appName || 'AutoPost Pro',
                                    logoUrl: val.logoUrl || '',
                                    bankName: val.bankName || 'mbbank',
                                    bankNo: val.bankNo || '',
                                    bankUser: val.bankUser || '',
                                    qrTemplate: val.qrTemplate || ''
                                });
                            }
                        })
                        .catch(() => {});
                };

                if (rtdb && auth && auth.currentUser) {
                    const settingsRef = rtdb.ref('settings');
                    const onSettings = settingsRef.on('value', snapshot => {
                        const val = snapshot.val();
                        if (val) {
                            setSettings({
                                appName: val.appName || 'AutoPost Pro',
                                logoUrl: val.logoUrl || '',
                                bankName: val.bankName || 'mbbank',
                                bankNo: val.bankNo || '',
                                bankUser: val.bankUser || '',
                                qrTemplate: val.qrTemplate || ''
                            });
                        }
                    }, () => {
                        loadLocalSettings();
                    });
                    return () => {
                        settingsRef.off('value', onSettings);
                    };
                }

                loadLocalSettings();
            }, [firebaseReady, googleUser]);

            // Dynamic Document Title Updater
            useEffect(() => {
                const appLabel = settings.appName || 'AutoPost Pro';
                if (activePage === 'share') {
                    document.title = `Chia sẻ bài viết - ${appLabel}`;
                } else if (activePage === 'subscription') {
                    document.title = `Gói dịch vụ - ${appLabel}`;
                } else {
                    document.title = `${appLabel} - Đăng bài tự động lên nhiều nhóm Facebook`;
                }
            }, [settings.appName, activePage]);

            // Realtime database or local server subscription sync listener
            useEffect(() => {
                if (!googleUser || !googleUser.sub) return;

                if (rtdb && auth && auth.currentUser && googleUser.isFirebaseAuth) {
                    const subRef = rtdb.ref('users/' + googleUser.sub + '/subscription');
                    const onValue = subRef.on('value', (snapshot) => {
                        const subData = snapshot.val();
                        if (subData) {
                            setSubscription(subData);
                            storage.set('subscription', subData);
                        }
                    }, (error) => {
                        console.warn('RTDB Subscription listener fallback:', error.message);
                    });

                    return () => {
                        subRef.off('value', onValue);
                    };
                }

                fetch(`/api/users/${encodeURIComponent(googleUser.sub)}`)
                    .then(r => r.ok ? r.json() : null)
                    .then(userData => {
                        if (userData && userData.subscription) {
                            setSubscription(userData.subscription);
                            storage.set('subscription', userData.subscription);
                        }
                        if (userData && userData.role) {
                            setUserRole(userData.role);
                        }
                    })
                    .catch(() => {});
            }, [googleUser, firebaseReady]);

            // Realtime database user role sync listener
            useEffect(() => {
                if (!googleUser || !googleUser.sub) {
                    setUserRole('user');
                    return;
                }
                const adminEmails = ['hungboa5075@gmail.com', 'admin@autopost.local'];
                const adminUids = ['112937746933560753066', '113264177727144211176'];
                const isBootstrappedAdmin =
                    (googleUser.email && adminEmails.includes(googleUser.email.toLowerCase())) ||
                    adminUids.includes(googleUser.sub);

                if (isBootstrappedAdmin) {
                    setUserRole('admin');
                }
                if (!rtdb || !auth || !auth.currentUser || !googleUser.isFirebaseAuth) {
                    if (!isBootstrappedAdmin) {
                        const cachedRole = storage.get('user_role', 'admin');
                        setUserRole(cachedRole || 'user');
                    }
                    return;
                }
                const roleRef = rtdb.ref('users/' + googleUser.sub + '/role');
                const onRole = roleRef.on('value', snapshot => {
                    const role = snapshot.val() || (isBootstrappedAdmin ? 'admin' : 'user');
                    setUserRole(isBootstrappedAdmin ? 'admin' : role);
                }, (error) => {
                    console.warn('RTDB Role listener fallback:', error.message);
                });
                return () => {
                    roleRef.off('value', onRole);
                };
            }, [googleUser, firebaseReady]);

            // Subscription helpers
            const getSubscriptionDaysLeft = useCallback(() => {
                if (!subscription.expiresAt) return 0;
                const now = new Date();
                const exp = new Date(subscription.expiresAt);
                const diff = Math.ceil((exp - now) / (1000 * 60 * 60 * 24));
                return Math.max(0, diff);
            }, [subscription.expiresAt]);

            const getSubscriptionTimeLeft = useCallback(() => {
                if (!subscription.expiresAt || subscription.status === 'expired') return { days: 0, hours: 0, text: 'Hết hạn' };
                const exp = new Date(subscription.expiresAt);
                const diffMs = exp - new Date();
                if (diffMs <= 0) return { days: 0, hours: 0, text: 'Hết hạn' };
                
                const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
                const days = Math.floor(totalHours / 24);
                const hours = totalHours % 24;
                
                let text = '';
                if (days > 0) {
                    text += `${days} ngày `;
                }
                text += `${hours} giờ`;
                return { days, hours, text };
            }, [subscription.expiresAt, subscription.status]);

            const isSubscriptionActive = useCallback(() => {
                if (subscription.plan === 'free') return true;
                if (subscription.status === 'expired') return false;
                const daysLeft = getSubscriptionDaysLeft();
                return daysLeft > 0;
            }, [subscription.plan, subscription.status, getSubscriptionDaysLeft]);

            const handleSelectPlan = useCallback((plan) => {
                if (!googleUser) {
                    showToast(t('sub_require_login'), 'error');
                    return;
                }
                if (plan === 'free') {
                    const updated = { ...subscription, plan: 'free', expiresAt: null, status: 'active', pendingPlan: null, pendingMonths: null };
                    setSubscription(updated);
                    storage.set('subscription', updated);

                    if (googleUser && googleUser.sub && rtdb && auth && auth.currentUser && googleUser.isFirebaseAuth) {
                        rtdb.ref('users/' + googleUser.sub + '/subscription').set(updated)
                            .catch(e => console.error('RTDB Update Error:', e));
                    } else if (googleUser && googleUser.sub) {
                        fetch('/api/users/sync', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ...googleUser, id: googleUser.sub, subscription: updated })
                        }).catch(() => {});
                    }

                    showToast('Đã chuyển sang gói Miễn phí', 'info');
                    return;
                }
                if (plan === 'enterprise') {
                    setSelectedPlan('enterprise');
                    setShowPaymentModal(true);
                    return;
                }
                setSelectedPlan(plan);
                setShowPaymentModal(true);
            }, [googleUser, subscription, t]);

            const handleConfirmPayment = useCallback((months = 1) => {
                const now = new Date();
                const safeMonths = Math.max(1, parseInt(months, 10) || 1);

                const historyEntry = {
                    id: Date.now(),
                    plan: selectedPlan,
                    months: safeMonths,
                    date: now.toISOString(),
                    status: 'pending',
                    amount: selectedPlan === 'pro' ? safeMonths * 199000 : safeMonths * 499000
                };

                const updatedSubscription = {
                    ...subscription,
                    status: 'pending',
                    pendingPlan: selectedPlan,
                    pendingMonths: safeMonths,
                    history: [historyEntry, ...(subscription.history || [])]
                };

                setSubscription(updatedSubscription);
                storage.set('subscription', updatedSubscription);

                // Update RTDB (when Firebase authenticated) or built-in local server API
                if (auth && auth.currentUser && rtdb && googleUser && googleUser.sub && googleUser.isFirebaseAuth) {
                    rtdb.ref('users/' + googleUser.sub + '/subscription').set(updatedSubscription)
                        .then(() => {
                            showToast('Đã ghi nhận thanh toán! Đang chờ xác nhận.', 'success');
                        }).catch(e => {
                            console.error('RTDB Update Error:', e);
                            showToast('Đã ghi nhận (Offline). Lỗi đồng bộ hệ thống!', 'warning');
                        });
                } else if (googleUser && googleUser.sub) {
                    fetch('/api/users/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: googleUser.sub,
                            name: googleUser.name,
                            email: googleUser.email,
                            picture: googleUser.picture,
                            subscription: updatedSubscription
                        })
                    }).then(() => {
                        showToast('Đã ghi nhận thanh toán! Đang chờ Admin xác nhận.', 'success');
                    }).catch(() => {
                        showToast('Đã ghi nhận thanh toán! Đang chờ xác nhận.', 'success');
                    });
                } else {
                    showToast('Đã ghi nhận thanh toán! Đang chờ xác nhận.', 'success');
                }

                setShowPaymentModal(false);
            }, [selectedPlan, subscription, googleUser]);

            // Auto-check subscription expiry
            useEffect(() => {
                if (subscription.expiresAt && subscription.plan !== 'free') {
                    const daysLeft = getSubscriptionDaysLeft();
                    if (daysLeft <= 0 && subscription.status !== 'expired') {
                        setSubscription(prev => {
                            const updated = { ...prev, status: 'expired' };
                            storage.set('subscription', updated);
                            return updated;
                        });
                    }
                    if (daysLeft > 0 && daysLeft <= 3) {
                        showToast(`Gói ${subscription.plan.toUpperCase()} sắp hết hạn! Còn ${daysLeft} ngày.`, 'warning');
                    }
                }
            }, []);

            useEffect(() => { storage.set('subscription', subscription); }, [subscription]);

            useEffect(() => {
                document.documentElement.classList.toggle('dark', theme === 'dark');
                storage.set('theme', theme);
            }, [theme]);
            useEffect(() => { storage.set('lang', lang); }, [lang]);
            useEffect(() => { storage.set('preview_mode', previewMode); }, [previewMode]);

            // Sync Gemini Model to Local Storage and Firebase RTDB (only after initial load)
            useEffect(() => {
                storage.set('gemini_model', model);
                if (!googleUser || !googleUser.sub || !googleUser.isFirebaseAuth || !rtdb || !auth?.currentUser || !userSettingsLoadedRef.current) return;

                const timer = setTimeout(() => {
                    rtdb.ref('users/' + googleUser.sub + '/gemini_model').set(model)
                        .catch(e => {
                            console.warn('RTDB gemini_model set warning:', e.message);
                        });
                }, 1000);
                return () => clearTimeout(timer);
            }, [model, googleUser]);

            // Sync Favorite Group Collections to Local Storage and Firebase RTDB (only after initial load)
            useEffect(() => {
                storage.set('favorite_group_collections', collections);
                if (!googleUser || !googleUser.sub || !googleUser.isFirebaseAuth || !rtdb || !auth?.currentUser || !userSettingsLoadedRef.current) return;

                rtdb.ref('users/' + googleUser.sub + '/favorite_group_collections').set(collections)
                    .catch(e => {
                        console.warn('RTDB collections set warning:', e.message);
                    });
            }, [collections, googleUser]);

            // Load user settings (collections, gemini_model) from RTDB on login/mount BEFORE allowing writes
            useEffect(() => {
                userSettingsLoadedRef.current = false;
                if (!googleUser || !googleUser.sub || !googleUser.isFirebaseAuth || !rtdb || !auth?.currentUser) {
                    userSettingsLoadedRef.current = true;
                    return;
                }

                let active = true;

                const modelRef = rtdb.ref('users/' + googleUser.sub + '/gemini_model');
                const collectionsRef = rtdb.ref('users/' + googleUser.sub + '/favorite_group_collections');

                Promise.all([
                    modelRef.once('value').catch(() => null),
                    collectionsRef.once('value').catch(() => null)
                ]).then(([modelSnap, colSnap]) => {
                    if (!active) return;

                    if (modelSnap && modelSnap.val() !== null) {
                        const val = modelSnap.val();
                        const validModel = ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].includes(val) ? val : 'gemini-4-hydrogen';
                        setModel(validModel);
                        storage.set('gemini_model', validModel);
                    }

                    if (colSnap && colSnap.val() !== null) {
                        const val = colSnap.val();
                        setCollections(Array.isArray(val) ? val : []);
                        storage.set('favorite_group_collections', Array.isArray(val) ? val : []);
                    }

                    userSettingsLoadedRef.current = true;
                });

                return () => {
                    active = false;
                };
            }, [googleUser, firebaseReady]);

            useEffect(() => { storage.set('active_page', activePage); }, [activePage]);
            useEffect(() => { storage.set('fb_groups', groups); }, [groups]);
            useEffect(() => { storage.set('fb_selected_groups', [...selectedGroups]); }, [selectedGroups]);
            useEffect(() => { storage.set('ai_custom_prompt', customPrompt); }, [customPrompt]);
            useEffect(() => { storage.set('ai_writing_style', writingStyle); }, [writingStyle]);
            useEffect(() => { storage.set('fb_post_content', content); }, [content]);
            useEffect(() => { imageDB.save(images); }, [images]);

            useEffect(() => {
                // Auto-upgrade legacy default prompts (including old 5-block prompt that could trigger fake Hotline/Zalo)
                const saved = storage.get('ai_custom_prompt', '');
                if (
                    saved &&
                    (saved.includes('QUY TẮC HARDCORE') ||
                        saved.includes('BẮT BUỘC TRÌNH BÀY THEO 5 PHẦN TÁCH BIỆT BẰNG DÒNG TRỐNG') ||
                        saved.includes('CẤU TRÚC CHUẨN 5 KHỐI') ||
                        (!saved.includes('XUỐNG DÒNG RIÊNG') && !saved.includes('xuống dòng')))
                ) {
                    storage.set('ai_custom_prompt', defaultPrompt);
                    setCustomPrompt(defaultPrompt);
                }

                // Migrate legacy/deprecated model selections to fast Gemini 3.1 Flash Lite
                const savedModel = storage.get('gemini_model', '');
                if (!savedModel || !['gemini-4-hydrogen', 'gemini-3.1-flash-lite'].includes(savedModel)) {
                    storage.set('gemini_model', 'gemini-3.1-flash-lite');
                    setModel('gemini-3.1-flash-lite');
                }
            }, []);

            const removeToast = useCallback((id) => {
                const existingTimer = toastTimersRef.current.get(id);
                if (existingTimer) {
                    clearTimeout(existingTimer);
                    toastTimersRef.current.delete(id);
                }
                setToasts(prev => prev.filter(t => t.id !== id));
            }, []);

            const showToast = useCallback((message, type = 'info', duration = 3000) => {
                const id = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                setToasts(prev => {
                    const next = [...prev, { id, message, type, duration }];
                    if (next.length > 4) {
                        const evicted = next.slice(0, next.length - 4);
                        evicted.forEach(t => {
                            const oldTimer = toastTimersRef.current.get(t.id);
                            if (oldTimer) {
                                clearTimeout(oldTimer);
                                toastTimersRef.current.delete(t.id);
                            }
                        });
                        return next.slice(-4);
                    }
                    return next;
                });
                const timer = setTimeout(() => {
                    toastTimersRef.current.delete(id);
                    setToasts(prev => prev.filter(t => t.id !== id));
                }, duration);
                toastTimersRef.current.set(id, timer);
            }, []);

            useEffect(() => {
                return () => {
                    toastTimersRef.current.forEach(timer => clearTimeout(timer));
                    toastTimersRef.current.clear();
                };
            }, []);
            const normalizeFbUrl = (url) => {
                if (!url || typeof url !== 'string') return url;
                return url.trim().replace(/\\\//g, '/').replace(/([^:]\/)\/+/g, '$1');
            };
            const runSingleStatusCheck = (item) => new Promise((resolve) => {
                if (!item || !item.link) return resolve({ status: 'unknown' });
                setSuccessItems(prev => prev.map(it => it.id === item.id ? {
                    ...it,
                    status: 'checking',
                    statusDetail: 'Đang tự động kiểm tra trên Facebook...'
                } : it));
                const timer = setTimeout(() => {
                    if (pendingStatusChecksRef.current.has(item.id)) {
                        pendingStatusChecksRef.current.delete(item.id);
                        setSuccessItems(prev => prev.map(it => it.id === item.id ? {
                            ...it,
                            status: 'unknown',
                            statusDetail: 'Hết thời gian chờ phản hồi từ Facebook (hãy bấm kiểm tra lại)',
                            checkedAt: new Date().toLocaleTimeString('vi-VN')
                        } : it));
                        resolve({ status: 'unknown' });
                    }
                }, 25000);
                pendingStatusChecksRef.current.set(item.id, (res) => {
                    clearTimeout(timer);
                    resolve(res);
                });
                window.postMessage({
                    type: 'CHECK_POST_STATUS',
                    requestId: item.id,
                    url: item.link,
                    groupId: item.groupId || ''
                }, '*');
            });

            const enqueueAutoCheck = (item) => {
                if (!item || !item.link) return;
                const liveVer = (typeof document !== 'undefined' && document.documentElement?.dataset?.fbToolInstalled) || '';
                if (!liveVer || liveVer !== REQUIRED_EXT_VERSION) return;
                autoCheckQueueRef.current.push(item);
                if (autoCheckRunningRef.current) return;
                autoCheckRunningRef.current = true;
                (async () => {
                    try {
                        while (autoCheckQueueRef.current.length > 0) {
                            const next = autoCheckQueueRef.current.shift();
                            const elapsed = Date.now() - (next.createdAt || 0);
                            if (elapsed < 2500) {
                                await new Promise(r => setTimeout(r, 2500 - elapsed));
                            }
                            const res = await runSingleStatusCheck(next);
                            const icon = res.status === 'live' ? '🟢' : res.status === 'pending' ? '🟡' : res.status === 'removed' ? '🔴' : '⚪';
                            const label = res.status === 'live' ? 'Đang hiển thị (Đã duyệt)' : res.status === 'pending' ? 'Chờ QTV duyệt' : res.status === 'removed' ? 'Bị gỡ / Từ chối' : 'Chưa xác định';
                            addLog('info', `${icon} Tự động kiểm tra "${next.groupName}": ${label}`);
                            if (autoCheckQueueRef.current.length > 0) {
                                await new Promise(r => setTimeout(r, 500));
                            }
                        }
                    } finally {
                        autoCheckRunningRef.current = false;
                    }
                })();
            };

            const recordSuccessItem = ({ groupId, groupName, link, action = 'post', isPending = false }) => {
                const cleanLink = link ? normalizeFbUrl(link) : '';
                const pendingFlag = Boolean(isPending || (cleanLink && cleanLink.includes('/my_pending_content')));
                const liveVer = (typeof document !== 'undefined' && document.documentElement?.dataset?.fbToolInstalled) || '';
                const willAutoCheck = Boolean(cleanLink && liveVer === REQUIRED_EXT_VERSION);
                const item = {
                    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    groupId: String(groupId || ''),
                    groupName: String(groupName || groupId || '').replace(/\uFFFD/g, '').trim() || String(groupId || ''),
                    link: cleanLink,
                    action,
                    time: new Date().toLocaleTimeString('vi-VN'),
                    createdAt: Date.now(),
                    status: willAutoCheck ? 'checking' : (pendingFlag ? 'pending' : 'unchecked'),
                    statusDetail: willAutoCheck
                        ? 'Đang tự động kiểm tra trạng thái trên Facebook...'
                        : (pendingFlag ? 'Facebook báo đang chờ QTV phê duyệt' : ''),
                    checkedAt: null
                };
                setSuccessItems(prev => [item, ...prev].slice(0, 100));
                if (willAutoCheck) {
                    enqueueAutoCheck(item);
                }
                return item;
            };
            const addLog = (type, message, link = null) => {
                const time = new Date().toLocaleTimeString('vi-VN');
                const cleanLink = link ? normalizeFbUrl(link) : link;
                setLogs(prev => {
                    const lastLog = prev[prev.length - 1];
                    // Collapse consecutive countdown logs into one line
                    const isCountdown = typeof message === 'string' && message.includes('s trước nhóm');
                    const wasCountdown = lastLog && typeof lastLog.message === 'string' && lastLog.message.includes('s trước nhóm');

                    if (lastLog && isCountdown && wasCountdown) {
                        const newLogs = [...prev];
                        newLogs[newLogs.length - 1] = { time, type, message, link: cleanLink };
                        return newLogs;
                    }
                    return [...prev, { time, type, message, link: cleanLink }];
                });
            };

            // Pending posts tracker for Promise-based waiting (normalized string keys)
            const pendingPostsRef = React.useRef(new Map());

            const abortAllPendingPosts = (reason = 'Stopped') => {
                pendingPostsRef.current.forEach(({ resolve }) => {
                    resolve({ success: false, aborted: true, error: reason });
                });
                pendingPostsRef.current.clear();
            };

            const waitForPostResult = (groupId, timeoutMs = 60000) => {
                const key = String(groupId);
                return new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => {
                        if (pendingPostsRef.current.has(key)) {
                            pendingPostsRef.current.delete(key);
                            reject(new Error('Timeout waiting for post result'));
                        }
                    }, timeoutMs);

                    pendingPostsRef.current.set(key, {
                        resolve: (val) => { clearTimeout(timeoutId); resolve(val); },
                        reject: (err) => { clearTimeout(timeoutId); reject(err); }
                    });
                });
            };

            // Extension Messaging
            useEffect(() => {
                let pollIntervalId;
                let watchdogIntervalId;
                let lastSeenTime = storage.get('extension_status', false) ? Date.now() : 0;
                let hasCheckedLogin = false;

                const markExtensionActive = (verFromMsg, extIdFromMsg, fromMessage = false) => {
                    lastSeenTime = Date.now();
                    setExtensionStatus(true);
                    storage.set('extension_status', true);
                    const detectedVer = String(verFromMsg || document.documentElement?.dataset?.fbToolInstalled || '').trim();
                    if (detectedVer) {
                        setInstalledExtVersion(detectedVer);
                        try { if (document.documentElement) document.documentElement.dataset.fbToolInstalled = detectedVer; } catch (_) {}
                    }
                    if (fromMessage) {
                        if (extIdFromMsg) {
                            const idKey = `id:${extIdFromMsg}`;
                            if (!seenExtIdsRef.current.has(idKey)) {
                                seenExtIdsRef.current.add(idKey);
                            }
                            // Remove any legacy version-only placeholder if a real extId arrived for the same version
                            seenExtIdsRef.current.delete(`ver:${detectedVer}`);
                            setDuplicateExtCount(seenExtIdsRef.current.size);
                        } else if (detectedVer) {
                            const hasAnyRealId = Array.from(seenExtIdsRef.current).some((k) => k.startsWith('id:'));
                            if (!hasAnyRealId) {
                                const verKey = `ver:${detectedVer}`;
                                if (!seenExtIdsRef.current.has(verKey)) {
                                    seenExtIdsRef.current.add(verKey);
                                    setDuplicateExtCount(seenExtIdsRef.current.size);
                                }
                            } else {
                                // An older extension without extId responded alongside a v3.2 extension with extId!
                                const oldKey = `legacy:${detectedVer}`;
                                if (!seenExtIdsRef.current.has(oldKey)) {
                                    seenExtIdsRef.current.add(oldKey);
                                    setDuplicateExtCount(seenExtIdsRef.current.size);
                                }
                            }
                        }
                    }
                    if (!hasCheckedLogin) {
                        hasCheckedLogin = true;
                        window.postMessage({ type: 'CHECK_FACEBOOK_LOGIN' }, '*');
                    }
                };

                const handleMessage = (event) => {
                    if (event.source !== window || !event.data || typeof event.data !== 'object') return;
                    const { type, data } = event.data;
                    if (type === 'FB_TOOL_INSTALLED') {
                        markExtensionActive(event.data.version, event.data.extId, true);
                    }
                    if (type === 'FB_USER_INFO') {
                        setFbUser(prev => {
                            // Only show success toast if logging in for the first time or as a different user
                            if (!prev || prev.userId !== data.userId) {
                                showToast(`Logged in as ${data.userName}`, 'success');
                            }
                            return data;
                        });
                        storage.set('fb_user_info', data);
                    }
                    if (type === 'FB_LOGGED_IN') {
                        if (window.__fbClearTimer) {
                            clearTimeout(window.__fbClearTimer);
                            window.__fbClearTimer = null;
                        }
                        if (data) {
                            setFbUser(data);
                            storage.set('fb_user_info', data);
                        }
                    }
                    if (type === 'FB_NOT_LOGGED_IN') {
                        const handleClear = () => {
                            setFbUser(null);
                            storage.remove('fb_user_info');
                            if (window.__loginRequested) {
                                window.__loginRequested = false;
                                showToast('Chưa kết nối Facebook. Đang mở cửa sổ đăng nhập...', 'warning');
                                window.postMessage({ type: 'OPEN_FACEBOOK' }, '*');
                            }
                        };

                        const cachedFb = storage.get('fb_user_info', null);
                        if (cachedFb && !window.__loginRequested) {
                            if (!window.__fbClearTimer) {
                                window.__fbClearTimer = setTimeout(() => {
                                    handleClear();
                                    window.__fbClearTimer = null;
                                }, 1500);
                            }
                        } else {
                            if (window.__fbClearTimer) {
                                clearTimeout(window.__fbClearTimer);
                                window.__fbClearTimer = null;
                            }
                            handleClear();
                        }
                    }
                    if (type === 'GROUP_DATA') {
                        // Extension sends array of groups
                        const groupsArray = Array.isArray(data) ? data : [data];
                        setGroups(prev => {
                            const existingIds = new Set(prev.map(g => g.id));
                            const newGroups = groupsArray
                                .filter(g => g && g.id && g.name && !existingIds.has(g.id))
                                .map(g => ({ ...g, name: String(g.name).replace(/\uFFFD/g, '').trim() }));
                            return [...prev, ...newGroups];
                        });
                    }
                    if (type === 'STATUS_UPDATE') {
                        const rawMsg = event.data.message !== undefined ? event.data.message : event.data.data;
                        const msg = typeof rawMsg === 'string'
                            ? rawMsg
                            : (rawMsg && typeof rawMsg === 'object'
                                ? String(rawMsg.message || rawMsg.text || '')
                                : (rawMsg == null ? '' : String(rawMsg)));
                        if (msg && msg.trim()) {
                            addLog('info', msg.trim());
                        }
                    }
                    if (type === 'ERROR') {
                        const rawErr = event.data.message !== undefined ? event.data.message : event.data.data;
                        const errMsg = typeof rawErr === 'string'
                            ? rawErr
                            : (rawErr && typeof rawErr === 'object'
                                ? String(rawErr.message || rawErr.text || 'Đã xảy ra lỗi')
                                : (rawErr == null ? 'Đã xảy ra lỗi' : String(rawErr)));
                        showToast(errMsg, 'error');
                        addLog('error', errMsg);
                        setIsScanningGroups(false);
                        setIsScanning(false);
                        setIsFetchingPages(false);
                    }
                    if (type === 'COMPLETE') {
                        showToast('Quét nhóm thành công!', 'success');
                        addLog('success', 'Quét nhóm thành công');
                        setIsScanningGroups(false);
                    }
                    if (type === 'TOTAL_COUNT') {
                        // Suppress log
                    }
                    if (type === 'POST_SUCCESS' && data) {
                        const { groupId, postId, postLink: rawPostLink, isPending } = data;
                        const postLink = rawPostLink ? normalizeFbUrl(rawPostLink) : null;
                        const normKey = String(groupId);
                        showToast(isPending ? 'Đã gửi bài (chờ QTV duyệt)!' : 'Đăng thành công!', 'success');

                        // Look up group name from live groupsRef and strip stray broken surrogate chars
                        const groupObj = groupsRef.current.find(g => String(g.id) === normKey);
                        const rawName = groupObj ? groupObj.name : normKey;
                        const groupName = String(rawName || normKey).replace(/\uFFFD/g, '').trim() || normKey;

                        if (postLink && !postLink.includes('/my_pending_content')) {
                            addLog('success', `✅ Đăng bài OK: ${groupName}`, postLink);
                            addLog('info', `🔗 Link: ${postLink}`);
                            recordSuccessItem({ groupId: normKey, groupName, link: postLink, action: 'post', isPending: !!isPending });
                        } else if (isPending || (postLink && postLink.includes('/my_pending_content'))) {
                            const pendingUrl = postLink || `https://www.facebook.com/groups/${normKey}/my_pending_content`;
                            addLog('success', `✅ Đăng bài OK: ${groupName} (chờ QTV duyệt)`, pendingUrl);
                            recordSuccessItem({ groupId: normKey, groupName, link: pendingUrl, action: 'post', isPending: true });
                        } else {
                            const fallbackUrl = `https://www.facebook.com/groups/${normKey}/my_posted_content`;
                            addLog('success', `✅ Đăng bài OK: ${groupName} (không lấy được link trực tiếp)`, fallbackUrl);
                            recordSuccessItem({ groupId: normKey, groupName, link: fallbackUrl, action: 'post', isPending: false });
                        }

                        if (pendingPostsRef.current.has(normKey)) {
                            const { resolve } = pendingPostsRef.current.get(normKey);
                            pendingPostsRef.current.delete(normKey);
                            resolve({ success: true, postLink: postLink || null, postId, isPending: !!isPending });
                        }
                    }
                    if (type === 'POST_ERROR' && data) {
                        const { groupId, message } = data;
                        const normKey = String(groupId);
                        showToast(`Lỗi đăng bài: ${message}`, 'error');
                        addLog('error', `❌ Lỗi đăng nhóm ${normKey}: ${message}`);

                        if (pendingPostsRef.current.has(normKey)) {
                            const { resolve } = pendingPostsRef.current.get(normKey);
                            pendingPostsRef.current.delete(normKey);
                            resolve({ success: false, error: message });
                        }
                    }
                    // Anti-block handlers (abort active posting loop immediately)
                    if (type === 'RATE_LIMIT_REACHED' && data) {
                        const { message, postsThisHour } = data;
                        stopPostingRef.current = true;
                        abortAllPendingPosts('Rate limit reached');
                        setIsPosting(false);
                        showToast(message, 'error');
                        addLog('error', `Rate limit: Đã đăng ${postsThisHour} bài trong giờ này`);
                    }
                    if (type === 'CHECKPOINT_DETECTED' && data) {
                        const { groupId } = data;
                        stopPostingRef.current = true;
                        abortAllPendingPosts('Checkpoint detected');
                        setIsPosting(false);
                        showToast('⚠️ Facebook yêu cầu xác minh! Dừng đăng bài.', 'error');
                        addLog('error', `Checkpoint detected tại nhóm ${groupId}. Cần xác minh tài khoản!`);
                    }
                    // Page Posts Feature Handlers
                    if (type === 'PAGE_POSTS_DATA') {
                        const postsArray = Array.isArray(data) ? data : [data];
                        setPagePosts(prev => {
                            const existingIds = new Set(prev.map(p => p.id));
                            const existingUrls = new Set(prev.map(p => p.url));
                            const newPosts = postsArray.filter(p => p && p.id && !existingIds.has(p.id) && (!p.url || !existingUrls.has(p.url)));
                            return [...prev, ...newPosts];
                        });
                    }
                    if (type === 'PAGE_POSTS_COMPLETE') {
                        setIsScanning(false);
                        const totalCount = data && typeof data.count === 'number' ? data.count : null;
                        if (totalCount === 0) {
                            showToast('Không quét được bài viết nào. Bạn có thể dán trực tiếp link bài viết ở Bước 2!', 'warning');
                            addLog('info', '⚠️ Quét xong nhưng chưa thấy bài viết công khai — có thể dán link bài viết trực tiếp ở Bước 2.');
                        } else {
                            showToast(totalCount ? `Quét thành công ${totalCount} bài viết!` : 'Quét bài viết thành công!', 'success');
                            addLog('success', totalCount ? `✅ Quét thành công ${totalCount} bài viết từ Page` : '✅ Quét bài viết thành công');
                        }
                    }
                    if (type === 'SHARE_SUCCESS' && data) {
                        const { groupId, groupName: payloadGroupName, sharedLink, postUrl, isPending } = data;
                        const normKey = String(groupId || '');
                        const groupObj = groupsRef.current.find(g => String(g.id) === normKey);
                        const resolvedName = String(payloadGroupName || groupObj?.name || normKey).replace(/\uFFFD/g, '').trim() || normKey;
                        const rawTargetLink = sharedLink || postUrl || (normKey ? `https://www.facebook.com/groups/${normKey}/my_posted_content` : '');
                        const targetLink = rawTargetLink ? normalizeFbUrl(rawTargetLink) : '';
                        const pendingFlag = Boolean(isPending || (targetLink && targetLink.includes('/my_pending_content')));
                        const pendingSuffix = pendingFlag ? ' (chờ QTV duyệt)' : '';
                        showToast(`Đã chia sẻ lên: ${resolvedName}${pendingSuffix}`, 'success');
                        addLog('success', `✅ Chia sẻ OK: ${resolvedName}${pendingSuffix}`, targetLink);
                        recordSuccessItem({ groupId: normKey, groupName: resolvedName, link: targetLink, action: 'share', isPending: pendingFlag });
                    }
                    if (type === 'POST_STATUS_RESULT' && data) {
                        const { requestId, status, detail, resolvedUrl } = data;
                        const normResolved = resolvedUrl ? normalizeFbUrl(resolvedUrl) : null;
                        const checkedTime = new Date().toLocaleTimeString('vi-VN');
                        setSuccessItems(prev => prev.map(item => {
                            if (item.id !== requestId) return item;
                            return {
                                ...item,
                                status: status || 'unknown',
                                statusDetail: detail || '',
                                link: normResolved || item.link,
                                checkedAt: checkedTime
                            };
                        }));
                        if (pendingStatusChecksRef.current.has(requestId)) {
                            const resolver = pendingStatusChecksRef.current.get(requestId);
                            pendingStatusChecksRef.current.delete(requestId);
                            resolver({ status: status || 'unknown', detail: detail || '' });
                        }
                    }
                    if (type === 'SHARE_ERROR' && data) {
                        const { groupId, groupName: payloadGroupName, message } = data;
                        const normKey = String(groupId || '');
                        const groupObj = groupsRef.current.find(g => String(g.id) === normKey);
                        const resolvedName = String(payloadGroupName || groupObj?.name || normKey).replace(/\uFFFD/g, '').trim() || normKey;
                        showToast(`Lỗi chia sẻ (${resolvedName}): ${message}`, 'error');
                        addLog('error', `❌ Lỗi chia sẻ nhóm ${resolvedName}: ${message}`);
                    }
                    // Fetch Pages Handler
                    if (type === 'FB_PAGES_DATA') {
                        setFbPages(data || []);
                        setIsFetchingPages(false);
                        if (data && data.length > 0) {
                            showToast(`Tìm thấy ${data.length} Pages!`, 'success');
                        } else {
                            showToast('Không tìm thấy Pages nào! Bạn có thể dán link Page trực tiếp.', 'warning');
                        }
                    }
                    if (type === 'CURRENT_PAGE_INFO') {
                        const page = data;
                        setIsFetchingPages(false);
                        if (page && page.url) {
                            setSelectedPage(page);
                            setPageUrl(page.url);
                            storage.set('last_selected_page', page);

                            setFbPages(prev => {
                                if (!prev.find(p => p.id === page.id)) return [page, ...prev];
                                return prev;
                            });

                            addLog('success', `✅ Đã lấy thông tin Page: ${page.name}`);
                            // Auto scan posts after getting page
                            setPagePosts([]);
                            setSelectedPosts(new Set());
                            setIsScanning(true);
                            addLog('info', `Đang quét bài viết từ: ${page.url}`);
                            window.postMessage({ type: 'SCAN_PAGE_POSTS', pageUrl: page.url }, '*');
                        }
                    }
                };
                window.addEventListener('message', handleMessage);

                // Load cached user info from localStorage
                const cachedUser = storage.get('fb_user_info');
                if (cachedUser) {
                    setFbUser(cachedUser);
                }

                // Check DOM marker immediately (avoids postMessage race before React mounts)
                if (document.documentElement?.dataset?.fbToolInstalled) {
                    markExtensionActive();
                }

                // Check for extension and request login status immediately and via interval
                window.postMessage({ type: 'CHECK_EXTENSION' }, '*');
                pollIntervalId = setInterval(() => {
                    if (document.documentElement?.dataset?.fbToolInstalled) {
                        markExtensionActive();
                    }
                    window.postMessage({ type: 'CHECK_EXTENSION' }, '*');
                }, 2000);

                // Watchdog to check if extension is disabled or uninstalled
                watchdogIntervalId = setInterval(() => {
                    if (document.documentElement?.dataset?.fbToolInstalled) {
                        lastSeenTime = Date.now();
                        return;
                    }
                    if (storage.get('extension_status', false) && Date.now() - lastSeenTime > 5000) {
                        setExtensionStatus(false);
                        storage.set('extension_status', false);
                        hasCheckedLogin = false; // Reset to allow verification upon reconnect
                    }
                }, 3000);

                return () => {
                    window.removeEventListener('message', handleMessage);
                    if (pollIntervalId) clearInterval(pollIntervalId);
                    if (watchdogIntervalId) clearInterval(watchdogIntervalId);
                };
            }, []);

            const handleLoadDemoGroups = () => {
                const sampleGroups = [
                    { id: '101001', name: 'Cộng đồng Kinh Doanh Online Việt Nam', url: 'https://www.facebook.com/groups/101001' },
                    { id: '101002', name: 'Hội Bán Hàng Thời Trang & Phụ Kiện', url: 'https://www.facebook.com/groups/101002' },
                    { id: '101003', name: 'Chợ Tốt Hà Nội - Mua Bán Nhanh', url: 'https://www.facebook.com/groups/101003' },
                    { id: '101004', name: 'Hội Săn Deal & Khuyến Mãi Toàn Quốc', url: 'https://www.facebook.com/groups/101004' },
                    { id: '101005', name: 'Marketing & Digital Ads Thực Chiến', url: 'https://www.facebook.com/groups/101005' }
                ];
                setGroups(sampleGroups);
                setSelectedGroups(new Set(['101001', '101002']));
                showToast('Đã tải 5 nhóm Facebook mẫu (Chế độ xem trước)!', 'success');
                addLog('success', '✅ Đã tải 5 nhóm mẫu để kiểm thử giao diện & AI viết lại');
            };

            const handleScan = () => {
                if (!extensionStatus) {
                    if (previewMode) {
                        handleLoadDemoGroups();
                        return;
                    }
                    return showToast('Vui lòng cài đặt Extension trước!', 'error');
                }
                if (!fbUser) {
                    window.__loginRequested = true;
                    window.postMessage({ type: 'CHECK_FACEBOOK_LOGIN' }, '*');
                    showToast('Đang kết nối Facebook...', 'info');
                    return;
                }
                setGroups([]);
                setSelectedGroups(new Set());
                storage.remove('fb_groups');
                storage.remove('fb_selected_groups');
                setIsScanningGroups(true);
                window.postMessage({
                    type: 'START_EXTRACTION',
                    pageId: selectedPage?.id || null,
                    pageName: selectedPage?.name || null
                }, '*');
            };

            const handleStopScan = () => {
                setIsScanningGroups(false);
                window.postMessage({ type: 'STOP_EXTRACTION' }, '*');
                showToast('Đã dừng quét nhóm', 'info');
            };

            // Fetch User's Facebook Pages
            const handleFetchPages = () => {
                if (!extensionStatus) {
                    if (previewMode) {
                        const demoPages = [
                            { id: 'page_demo_1', name: 'AutoPost Official Store', url: 'https://www.facebook.com/autopostpro' },
                            { id: 'page_demo_2', name: 'Góc Review Công Nghệ & Sale', url: 'https://www.facebook.com/reviewcongnghe' }
                        ];
                        setFbPages(demoPages);
                        setSelectedPage(demoPages[0]);
                        setPageUrl(demoPages[0].url);
                        showToast('Đã tải 2 Fanpage mẫu (Chế độ xem trước)!', 'success');
                        return;
                    }
                    return showToast('Vui lòng cài đặt Extension trước!', 'error');
                }
                if (!fbUser) {
                    window.__loginRequested = true;
                    window.postMessage({ type: 'CHECK_FACEBOOK_LOGIN' }, '*');
                    showToast('Đang kết nối Facebook...', 'info');
                    return;
                }
                setIsFetchingPages(true);
                addLog('info', 'Đang lấy danh sách Pages...');
                window.postMessage({ type: 'FETCH_USER_PAGES' }, '*');
            };

            // Get currently open Facebook Page tab
            const handleGetCurrentPage = () => {
                if (!extensionStatus) {
                    if (previewMode) {
                        const demoPage = { id: 'page_demo_1', name: 'AutoPost Official Store', url: 'https://www.facebook.com/autopostpro' };
                        setSelectedPage(demoPage);
                        setPageUrl(demoPage.url);
                        setFbPages(prev => prev.some(p => p.id === demoPage.id) ? prev : [demoPage, ...prev]);
                        showToast('Đã lấy Fanpage mẫu (Chế độ xem trước)!', 'success');
                        return;
                    }
                    return showToast('Vui lòng cài đặt Extension v3.8 trước!', 'error');
                }
                setIsFetchingPages(true);
                addLog('info', 'Đang tìm tab Fanpage Facebook đang mở...');
                window.postMessage({ type: 'GET_CURRENT_PAGE' }, '*');
            };

            const handleStopCheckStatus = () => {
                stopStatusCheckRef.current = true;
                pendingStatusChecksRef.current.forEach((resolve) => resolve({ status: 'unknown', detail: 'Đã dừng kiểm tra' }));
                pendingStatusChecksRef.current.clear();
                setIsCheckingStatus(false);
                setCheckProgress(null);
            };

            const handleClearSuccessItems = () => {
                setSuccessItems([]);
                storage.set('success_items', []);
                showToast('Đã xóa danh sách bài thành công đã lưu.', 'info');
            };

            const handleSaveLiveGroupsCollection = ({ name = '', mergeCollectionId = '' } = {}) => {
                const liveItems = (successItemsRef.current || []).filter((it) => it && it.status === 'live');
                if (liveItems.length === 0) {
                    showToast('Chưa có nhóm nào đăng thành công & hiển thị ngay (không cần duyệt). Hãy chạy "Kiểm tra duyệt / gỡ" trước!', 'warning');
                    return { ok: false, count: 0 };
                }

                const extractGroupIdFromLink = (link) => {
                    if (!link) return '';
                    const m = String(link).match(/facebook\.com\/groups\/([^/?#]+)/i);
                    return m ? m[1] : '';
                };

                const resolvedIds = [];
                const seenIds = new Set();
                for (const item of liveItems) {
                    const rawId = String(item.groupId || '').trim();
                    const linkId = extractGroupIdFromLink(item.link);
                    const itemNameLower = String(item.groupName || '').trim().toLowerCase();

                    const matchedGroup = groups.find((g) => {
                        const gid = String(g.id || '').trim();
                        if (rawId && gid === rawId) return true;
                        if (linkId && gid === linkId) return true;
                        if (linkId && g.url && String(g.url).includes(`/groups/${linkId}`)) return true;
                        if (itemNameLower && String(g.name || '').trim().toLowerCase() === itemNameLower) return true;
                        return false;
                    });

                    const finalId = matchedGroup ? matchedGroup.id : (rawId || linkId);
                    const key = String(finalId || '').trim();
                    if (key && !seenIds.has(key)) {
                        seenIds.add(key);
                        resolvedIds.push(finalId);
                    }
                }

                if (resolvedIds.length === 0) {
                    showToast('Không tìm thấy ID nhóm hợp lệ từ danh sách bài hiển thị!', 'error');
                    return { ok: false, count: 0 };
                }

                if (mergeCollectionId) {
                    const targetCol = collections.find((col) => col.id === mergeCollectionId);
                    if (!targetCol) {
                        showToast('Không tìm thấy bộ sưu tập cần gộp!', 'error');
                        return { ok: false, count: 0 };
                    }
                    const existingKeys = new Set((targetCol.groupIds || []).map((id) => String(id)));
                    const merged = [...(targetCol.groupIds || [])];
                    let addedCount = 0;
                    for (const gid of resolvedIds) {
                        if (!existingKeys.has(String(gid))) {
                            existingKeys.add(String(gid));
                            merged.push(gid);
                            addedCount++;
                        }
                    }
                    const totalCount = merged.length;
                    setCollections((prev) => prev.map((col) => (
                        col.id === mergeCollectionId ? { ...col, groupIds: merged } : col
                    )));
                    if (addedCount > 0) {
                        showToast(`⭐ Đã thêm ${addedCount} nhóm không cần duyệt vào "${targetCol.name}" (tổng ${totalCount} nhóm)!`, 'success');
                    } else {
                        showToast(`Tất cả ${resolvedIds.length} nhóm không cần duyệt đã có sẵn trong "${targetCol.name}".`, 'info');
                    }
                    return { ok: true, count: resolvedIds.length, addedCount };
                }

                const now = new Date();
                const dateTag = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
                const finalName = String(name || '').trim() || `Nhóm không duyệt (${dateTag})`;
                const newCol = {
                    id: Date.now() + '_' + Math.random().toString(36).substring(2, 9),
                    name: finalName,
                    groupIds: resolvedIds
                };
                setCollections((prev) => [...prev, newCol]);
                showToast(`⭐ Đã lưu bộ sưu tập "${finalName}" (${resolvedIds.length} nhóm không cần duyệt)!`, 'success');
                return { ok: true, count: resolvedIds.length };
            };

            const handleCheckPostStatuses = async (targetIds = null) => {
                const itemsToCheck = (Array.isArray(targetIds) && targetIds.length > 0)
                    ? successItemsRef.current.filter(it => targetIds.includes(it.id) && it.link)
                    : successItemsRef.current.filter(it => it.link);

                if (itemsToCheck.length === 0) {
                    return showToast('Chưa có bài viết nào có link để kiểm tra!', 'info');
                }

                if (!extensionStatus) {
                    return showToast(`Vui lòng cài đặt Extension v${REQUIRED_EXT_VERSION} để kiểm tra trạng thái duyệt / gỡ thực tế trên Facebook!`, 'error');
                }
                const liveExtVer = installedExtVersion || (typeof document !== 'undefined' ? (document.documentElement?.dataset?.fbToolInstalled || '') : '');
                if (liveExtVer && liveExtVer !== REQUIRED_EXT_VERSION) {
                    return showToast(`Cần cập nhật Extension lên v${REQUIRED_EXT_VERSION} để dùng tính năng kiểm tra bài chưa duyệt / bị gỡ!`, 'error');
                }

                if (isCheckingStatus) return;
                setIsCheckingStatus(true);
                stopStatusCheckRef.current = false;
                setCheckProgress({ done: 0, total: itemsToCheck.length });
                addLog('info', `🔍 Bắt đầu kiểm tra trạng thái ${itemsToCheck.length} bài viết trên Facebook...`);

                let liveCount = 0;
                let pendingCount = 0;
                let removedCount = 0;

                for (let idx = 0; idx < itemsToCheck.length; idx++) {
                    if (stopStatusCheckRef.current) break;
                    const item = itemsToCheck[idx];

                    setSuccessItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'checking', statusDetail: 'Đang kiểm tra trên Facebook...' } : it));

                    const result = await new Promise((resolve) => {
                        const timer = setTimeout(() => {
                            if (pendingStatusChecksRef.current.has(item.id)) {
                                pendingStatusChecksRef.current.delete(item.id);
                                setSuccessItems(prev => prev.map(it => it.id === item.id ? {
                                    ...it,
                                    status: 'unknown',
                                    statusDetail: 'Hết thời gian chờ phản hồi từ Facebook (hãy thử kiểm tra lại)',
                                    checkedAt: new Date().toLocaleTimeString('vi-VN')
                                } : it));
                                resolve({ status: 'unknown' });
                            }
                        }, 25000);

                        pendingStatusChecksRef.current.set(item.id, (res) => {
                            clearTimeout(timer);
                            resolve(res);
                        });

                        window.postMessage({
                            type: 'CHECK_POST_STATUS',
                            requestId: item.id,
                            url: item.link,
                            groupId: item.groupId || ''
                        }, '*');
                    });

                    if (result.status === 'live') liveCount++;
                    else if (result.status === 'pending') pendingCount++;
                    else if (result.status === 'removed') removedCount++;

                    setCheckProgress({ done: idx + 1, total: itemsToCheck.length });

                    if (idx < itemsToCheck.length - 1 && !stopStatusCheckRef.current) {
                        await new Promise(r => setTimeout(r, 600));
                    }
                }

                setIsCheckingStatus(false);
                setCheckProgress(null);

                if (!stopStatusCheckRef.current) {
                    const summary = `Kiểm tra xong: ${liveCount} đang hiển thị, ${pendingCount} chờ QTV duyệt, ${removedCount} bị gỡ/từ chối.`;
                    addLog('info', `📊 ${summary}`);
                    showToast(summary, removedCount > 0 ? 'warning' : 'success');
                }
            };

            // Add a direct Facebook post/reel/video link manually into Step 2
            const handleAddManualPostUrl = (rawUrl) => {
                let cleanUrl = String(rawUrl || '').trim();
                if (!cleanUrl) {
                    showToast('Vui lòng dán link bài viết Facebook!', 'error');
                    return false;
                }
                if (!/^https?:\/\//i.test(cleanUrl)) {
                    cleanUrl = 'https://' + cleanUrl;
                }
                const isFbLink = /(facebook\.com|fb\.watch|fb\.com)/i.test(cleanUrl);
                if (!isFbLink) {
                    showToast('Link phải là bài viết/video/reel từ Facebook!', 'error');
                    return false;
                }
                const normalized = cleanUrl.split('#')[0];
                const postId = 'manual_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                const shortLabel = normalized
                    .replace(/^https?:\/\/(www\.|m\.)?facebook\.com\//i, '')
                    .slice(0, 72);
                const newPost = {
                    id: postId,
                    url: normalized,
                    text: `Bài viết dán trực tiếp (${shortLabel || normalized})`,
                    time: 'Link trực tiếp',
                    type: /\/(videos|reel|watch)/i.test(normalized) ? 'video' : 'text',
                    media: null
                };
                setPagePosts(prev => {
                    const existing = prev.find(p => p.url === normalized);
                    if (existing) {
                        setSelectedPosts(sel => new Set([...sel, existing.id]));
                        return prev;
                    }
                    return [newPost, ...prev];
                });
                setSelectedPosts(prev => new Set([...prev, postId]));
                showToast('Đã thêm link bài viết vào danh sách chia sẻ!', 'success');
                addLog('success', `✅ Đã thêm bài viết trực tiếp: ${normalized}`);
                return true;
            };

            const handleStopShare = () => {
                stopSharingRef.current = true;
                showToast('Đang dừng chiến dịch chia sẻ...', 'info');
                addLog('info', '⏹ Người dùng yêu cầu dừng chia sẻ.');
            };

            // Page Posts Feature Handlers
            const handleScanPagePosts = () => {
                const trimmedUrl = pageUrl.trim();
                if (!trimmedUrl) return showToast('Vui lòng nhập URL Fanpage hoặc link bài viết Facebook!', 'error');
                if (!extensionStatus) {
                    if (previewMode) {
                        const demoPosts = [
                            {
                                id: 'post_demo_1',
                                url: 'https://www.facebook.com/autopostpro/posts/10001',
                                text: '🔥 Khai trương ưu đãi giảm 40% toàn bộ sản phẩm trong tuần này! Nhắn tin ngay để nhận mã freeship.',
                                time: '2 giờ trước',
                                type: 'text'
                            },
                            {
                                id: 'post_demo_2',
                                url: 'https://www.facebook.com/autopostpro/posts/10002',
                                text: '✨ Bộ sưu tập mới đã lên kệ — giao hàng toàn quốc 24h, kiểm tra hàng trước khi thanh toán.',
                                time: 'Hôm qua',
                                type: 'text'
                            }
                        ];
                        setPagePosts(demoPosts);
                        setSelectedPosts(new Set(['post_demo_1']));
                        showToast('Đã tải 2 bài viết mẫu (Chế độ xem trước)!', 'success');
                        addLog('success', '✅ Đã quét 2 bài viết mẫu từ trang');
                        return;
                    }
                    return showToast('Vui lòng cài đặt Extension v3.8 trước!', 'error');
                }

                setPagePosts([]);
                setSelectedPosts(new Set());
                setIsScanning(true);
                addLog('info', `Đang quét bài viết từ: ${trimmedUrl}`);
                window.postMessage({ type: 'SCAN_PAGE_POSTS', pageUrl: trimmedUrl }, '*');
            };

            const handleSharePosts = async () => {
                if (!extensionStatus && !previewMode) return showToast('Vui lòng cài đặt Extension v3.8 trước!', 'error');
                const liveExtVer = installedExtVersion || (typeof document !== 'undefined' ? (document.documentElement?.dataset?.fbToolInstalled || '') : '');
                if (extensionStatus && liveExtVer && liveExtVer !== REQUIRED_EXT_VERSION) {
                    const msg = `Chrome đang chạy Extension bản cũ (v${liveExtVer})! Vui lòng vào chrome://extensions gỡ bản cũ và cài bản v${REQUIRED_EXT_VERSION} để chia sẻ đúng nhóm đã chọn.`;
                    addLog('error', `⚠️ ${msg}`);
                    return showToast(msg, 'error');
                }
                if (extensionStatus && duplicateExtCount > 1) {
                    const msg = `Phát hiện ${duplicateExtCount} bản Extension đang cùng bật trong Chrome! Hãy vào chrome://extensions gỡ toàn bộ bản cũ, chỉ giữ lại duy nhất v${REQUIRED_EXT_VERSION}.`;
                    addLog('error', `⚠️ ${msg}`);
                    return showToast(msg, 'error');
                }
                if (selectedPosts.size === 0) return showToast('Vui lòng chọn ít nhất 1 bài viết!', 'error');
                if (selectedGroups.size === 0) return showToast('Vui lòng chọn ít nhất 1 nhóm!', 'error');

                // Subscription Check
                if (subscription.plan === 'free' && selectedGroups.size > 3) {
                    return showToast('Gói MIỄN PHÍ chỉ được chọn tối đa 3 nhóm. Vui lòng nâng cấp!', 'error');
                }
                if (subscription.plan !== 'free' && !isSubscriptionActive()) {
                    return showToast('Gói dịch vụ đã hết hạn. Vui lòng gia hạn để tiếp tục!', 'error');
                }

                stopSharingRef.current = false;
                setIsSharing(true);
                setShareCountdown(null);
                setProgress(0);
                const postsToShare = pagePosts.filter(p => selectedPosts.has(p.id));
                const groupsToShare = groups.filter(g => selectedGroups.has(g.id));
                const total = postsToShare.length * groupsToShare.length;
                const minSec = Math.max(3, Number(shareDelayMin) || 10);
                const maxSec = Math.max(minSec, Number(shareDelayMax) || 20);
                storage.set('share_delay_min', minSec);
                storage.set('share_delay_max', maxSec);

                addLog('info', `🚀 Bắt đầu chia sẻ ${postsToShare.length} bài viết lên ${groupsToShare.length} nhóm${!extensionStatus ? ' (Mô phỏng)' : ''}`);

                let count = 0;
                let successCount = 0;
                outerLoop: for (const post of postsToShare) {
                    for (const group of groupsToShare) {
                        if (stopSharingRef.current) {
                            addLog('info', '⏹ Đã dừng chia sẻ theo yêu cầu.');
                            break outerLoop;
                        }

                        // Live countdown between shares (interruptible)
                        if (count > 0) {
                            const delaySec = !extensionStatus ? 3 : (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec);
                            for (let s = delaySec; s > 0; s--) {
                                if (stopSharingRef.current) {
                                    setShareCountdown(null);
                                    addLog('info', '⏹ Đã dừng chia sẻ theo yêu cầu.');
                                    break outerLoop;
                                }
                                setShareCountdown({ current: s, total: delaySec, nextGroupName: group.name });
                                addLog('info', `⏳ Đếm ngược ${s}s trước nhóm tiếp theo: ${group.name}...`);
                                await new Promise(r => setTimeout(r, 1000));
                            }
                            setShareCountdown(null);
                        }

                        // Validate URL before sharing
                        let shareUrl = post.url || post.id;
                        if (!shareUrl || shareUrl === '' ||
                            shareUrl.endsWith('/photo/') ||
                            shareUrl.endsWith('/photo') ||
                            !/(facebook\.com|fb\.watch|fb\.com)/i.test(shareUrl)) {
                            addLog('error', `❌ URL bài viết không hợp lệ: ${shareUrl}`);
                            count++;
                            setProgress(Math.round((count / total) * 100));
                            continue;
                        }

                        if (stopSharingRef.current) {
                            addLog('info', '⏹ Đã dừng chia sẻ theo yêu cầu.');
                            break outerLoop;
                        }

                        addLog('info', `📤 Chia sẻ trực tiếp bài gốc → ${group.name} (${shareUrl.replace(/^https?:\/\/(www\.)?facebook\.com/i, '')})`);

                        if (!extensionStatus && previewMode) {
                            await new Promise(r => setTimeout(r, 400));
                            successCount++;
                            addLog('success', `✅ Chia sẻ OK: ${group.name}`, `https://www.facebook.com/groups/${group.id}/posts/demo_${Date.now()}/`);
                        } else {
                            window.postMessage({
                                type: 'SHARE_POST_TO_GROUP',
                                groupId: group.id,
                                groupName: group.name,
                                groupUrl: group.url || `https://www.facebook.com/groups/${group.id}`,
                                postUrl: shareUrl,
                                caption: ''
                            }, '*');

                            // Wait for share result with proper listener cleanup & stop support
                            try {
                                await new Promise((resolve) => {
                                    let settled = false;
                                    const finish = (result) => {
                                        if (settled) return;
                                        settled = true;
                                        clearTimeout(timeout);
                                        clearInterval(stopCheck);
                                        window.removeEventListener('message', handler);
                                        resolve(result);
                                    };
                                    const handler = (event) => {
                                        if (event.source !== window || !event.data || typeof event.data !== 'object') return;
                                        const { type, data } = event.data;
                                        if (type === 'SHARE_SUCCESS' && data && String(data.groupId) === String(group.id)) {
                                            successCount++;
                                            finish({ success: true });
                                        }
                                        if (type === 'SHARE_ERROR' && data && String(data.groupId) === String(group.id)) {
                                            finish({ success: false });
                                        }
                                    };
                                    const stopCheck = setInterval(() => {
                                        if (stopSharingRef.current) finish({ success: false, stopped: true });
                                    }, 500);
                                    const timeout = setTimeout(() => {
                                        addLog('error', `⏰ Quá thời gian chờ chia sẻ nhóm ${group.name}`);
                                        finish({ success: false, timeout: true });
                                    }, 120000);
                                    window.addEventListener('message', handler);
                                });
                            } catch (e) {
                                addLog('error', `⏰ Timeout chia sẻ nhóm ${group.name}`);
                            }
                        }

                        count++;
                        setProgress(Math.round((count / total) * 100));
                    }
                }

                const wasStopped = stopSharingRef.current;
                stopSharingRef.current = false;
                setShareCountdown(null);
                setIsSharing(false);
                if (wasStopped) {
                    addLog('info', `⏹ Đã dừng! Chia sẻ thành công ${successCount}/${count} lượt đã chạy.`);
                    showToast(`Đã dừng chia sẻ (${successCount}/${count} thành công)`, 'info');
                } else {
                    addLog('success', `✅ Hoàn thành! Chia sẻ thành công ${successCount}/${total} lượt`);
                    showToast(`Hoàn thành chia sẻ ${successCount}/${total} lượt!`, 'success');
                }
            };

            // Helpers (nested spintax supported with safety cap)
            const spinContent = (text) => {
                if (!text) return "";
                let result = text;
                for (let pass = 0; pass < 10; pass++) {
                    const next = result.replace(/\{([^{}]+)\}/g, (match, p1) => {
                        const options = p1.split('|');
                        return options[Math.floor(Math.random() * options.length)];
                    });
                    if (next === result) break;
                    result = next;
                }
                return result;
            };

            const shuffleArray = (array) => {
                let newArr = array.map((item, idx) => ({
                    ...item,
                    id: (item.id || idx) + '_' + Math.random().toString(36).substring(2, 7)
                }));
                for (let i = newArr.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [newArr[i], newArr[j]] = [newArr[j], newArr[i]];
                }
                return newArr;
            };

            const [groupVariations, setGroupVariations] = useState({});
            const rewritingIdsRef = useRef(new Set());

            // Sync group variations when selectedGroups, groups or spinEnabled changes.
            useEffect(() => {
                setGroupVariations(prev => {
                    const next = { ...prev };
                    let changed = false;

                    Object.keys(next).forEach(groupId => {
                        if (!selectedGroups.has(groupId)) {
                            delete next[groupId];
                            changed = true;
                        }
                    });

                    selectedGroups.forEach(groupId => {
                        if (!next[groupId]) {
                            const groupName = groups.find(g => g.id === groupId)?.name || '';
                            next[groupId] = {
                                content: spinEnabled ? spinContent(content) : content,
                                images: spinEnabled ? shuffleArray(images) : [...images],
                                groupName: groupName,
                                isAiRewritten: false,
                                isRewriting: false
                            };
                            changed = true;
                        }
                    });

                    return changed ? next : prev;
                });
            }, [selectedGroups, groups, spinEnabled]);

            // Safely update existing variations when the main editor content or images list updates
            // Fixed: track per-group `itemChanged` instead of sharing `changed` across loop iterations
            useEffect(() => {
                setGroupVariations(prev => {
                    const next = { ...prev };
                    let anyChanged = false;

                    selectedGroups.forEach(groupId => {
                        if (next[groupId]) {
                            const currentVar = next[groupId];
                            let nextContent = currentVar.content;
                            let nextImages = currentVar.images;
                            let nextIsAiRewritten = currentVar.isAiRewritten;
                            let nextIsRewriting = currentVar.isRewriting;
                            let itemChanged = false;

                            if (!spinEnabled) {
                                if (currentVar.content !== content) {
                                    nextContent = content;
                                    nextIsAiRewritten = false;
                                    nextIsRewriting = false;
                                    itemChanged = true;
                                }
                                if (currentVar.images.length !== images.length || JSON.stringify(currentVar.images.map(img => img.id)) !== JSON.stringify(images.map(img => img.id))) {
                                    nextImages = [...images];
                                    itemChanged = true;
                                }
                            } else {
                                if (!currentVar.content || currentVar.content.trim() === '' || !content.trim() || (!currentVar.isAiRewritten && currentVar.sourceContent !== content)) {
                                    nextContent = spinContent(content);
                                    nextIsAiRewritten = false;
                                    nextIsRewriting = false;
                                    itemChanged = true;
                                }
                                if (currentVar.images.length !== images.length) {
                                    nextImages = shuffleArray(images);
                                    itemChanged = true;
                                }
                            }

                            if (itemChanged) {
                                anyChanged = true;
                                next[groupId] = {
                                    ...currentVar,
                                    sourceContent: content,
                                    content: nextContent,
                                    images: nextImages,
                                    isAiRewritten: nextIsAiRewritten,
                                    isRewriting: nextIsRewriting
                                };
                            }
                        }
                    });

                    return anyChanged ? next : prev;
                });
            }, [content, images, selectedGroups, spinEnabled]);

            // Helper: extract opening hook line from a post for anti-duplication tracking
            const extractOpeningLine = (text) => {
                if (!text || typeof text !== 'string') return '';
                const firstLine = text.split('\n').map(l => l.trim()).find(Boolean) || '';
                return firstLine.slice(0, 140);
            };

            // Generate genuinely distinct professional AI variations for each selected group
            const regenerateVariations = async () => {
                if (!content || !content.trim()) {
                    showToast('Vui lòng nhập nội dung bài viết trước khi tạo biến thể!', 'warning');
                    return;
                }
                const targetGroupIds = [...selectedGroups];
                if (targetGroupIds.length === 0) {
                    showToast('Vui lòng chọn ít nhất 1 nhóm để tạo biến thể AI!', 'warning');
                    return;
                }
                if (isGeneratingVariations) return;

                rewritingIdsRef.current.clear();

                if (!spinEnabled) {
                    const next = {};
                    targetGroupIds.forEach(groupId => {
                        const groupName = groups.find(g => g.id === groupId)?.name || '';
                        next[groupId] = {
                            sourceContent: content,
                            content: formatSalesContent(content),
                            images: [...images],
                            groupName,
                            isAiRewritten: false,
                            isRewriting: false,
                            angleLabel: ''
                        };
                    });
                    setGroupVariations(next);
                    showToast('Đã đồng bộ bài viết gốc cho các nhóm đã chọn.', 'info');
                    return;
                }

                setIsGeneratingVariations(true);
                const maxPreviewAi = Math.min(targetGroupIds.length, 6);
                const previewGroupIds = targetGroupIds.slice(0, maxPreviewAi);

                // Initialize shuffled images & mark previewed cards as generating
                setGroupVariations(prev => {
                    const next = { ...prev };
                    targetGroupIds.forEach((groupId, idx) => {
                        const groupName = groups.find(g => g.id === groupId)?.name || '';
                        next[groupId] = {
                            sourceContent: content,
                            content: prev[groupId]?.content || spinContent(content),
                            images: shuffleArray(images),
                            groupName,
                            isAiRewritten: false,
                            isRewriting: idx < maxPreviewAi,
                            angleLabel: ''
                        };
                    });
                    return next;
                });

                addLog('info', `✨ Đang tạo ${previewGroupIds.length} biến thể AI chuyên nghiệp chống spam cho từng nhóm...`);
                const usedOpenings = [];
                let successCount = 0;

                try {
                    for (let i = 0; i < previewGroupIds.length; i++) {
                        const groupId = previewGroupIds[i];
                        const groupName = groups.find(g => g.id === groupId)?.name || `Nhóm #${i + 1}`;
                        try {
                            const baseSpinned = spinContent(content);
                            const aiRes = await rewriteWithGemini(baseSpinned, {
                                groupName,
                                variationIndex: i,
                                totalVariations: targetGroupIds.length,
                                writingStyle,
                                avoidOpenings: usedOpenings
                            });
                            const opening = extractOpeningLine(aiRes.text);
                            if (opening) usedOpenings.push(opening);
                            successCount++;

                            setGroupVariations(prev => ({
                                ...prev,
                                [groupId]: {
                                    ...(prev[groupId] || {}),
                                    sourceContent: content,
                                    content: aiRes.text,
                                    images: prev[groupId]?.images?.length === images.length ? prev[groupId].images : shuffleArray(images),
                                    groupName,
                                    isAiRewritten: true,
                                    isRewriting: false,
                                    angleLabel: aiRes.angleLabel || `Biến thể #${i + 1}`
                                }
                            }));
                        } catch (err) {
                            setGroupVariations(prev => ({
                                ...prev,
                                [groupId]: {
                                    ...(prev[groupId] || {}),
                                    isRewriting: false
                                }
                            }));
                            addLog('error', `❌ Không tạo được biến thể AI cho "${groupName}": ${err.message}`);
                        }
                    }

                    if (successCount > 0) {
                        const extraNote = targetGroupIds.length > maxPreviewAi
                            ? ` (${targetGroupIds.length - maxPreviewAi} nhóm còn lại sẽ tự động tạo biến thể AI riêng ngay khi đăng!)`
                            : '';
                        showToast(`✨ Đã tạo ${successCount}/${previewGroupIds.length} biến thể AI chuyên nghiệp khác biệt!${extraNote}`, 'success');
                    } else {
                        showToast('Không thể tạo biến thể AI. Vui lòng kiểm tra log lỗi.', 'error');
                    }
                } finally {
                    setIsGeneratingVariations(false);
                }
            };

            // Regenerate a single group's AI variation without repeating other groups' openings
            const regenerateSingleGroupVariation = async (groupId) => {
                if (!content || !content.trim()) return;
                const targetGroupIds = [...selectedGroups];
                const idx = Math.max(0, targetGroupIds.indexOf(groupId));
                const groupName = groups.find(g => g.id === groupId)?.name || `Nhóm #${idx + 1}`;

                const otherOpenings = Object.entries(groupVariations)
                    .filter(([id, v]) => id !== groupId && v && v.content)
                    .map(([, v]) => extractOpeningLine(v.content))
                    .filter(Boolean);
                const currentOpening = extractOpeningLine(groupVariations[groupId]?.content || '');
                if (currentOpening) otherOpenings.push(currentOpening);

                setGroupVariations(prev => ({
                    ...prev,
                    [groupId]: {
                        ...(prev[groupId] || { sourceContent: content, content, images: shuffleArray(images), groupName }),
                        isRewriting: true
                    }
                }));

                try {
                    const aiRes = await rewriteWithGemini(spinContent(content), {
                        groupName,
                        variationIndex: idx + Math.floor(Math.random() * 8) + 1,
                        totalVariations: Math.max(targetGroupIds.length, 1),
                        writingStyle,
                        avoidOpenings: otherOpenings
                    });
                    setGroupVariations(prev => ({
                        ...prev,
                        [groupId]: {
                            ...(prev[groupId] || {}),
                            sourceContent: content,
                            content: aiRes.text,
                            images: spinEnabled ? shuffleArray(images) : [...images],
                            groupName,
                            isAiRewritten: true,
                            isRewriting: false,
                            angleLabel: aiRes.angleLabel || 'Biến thể mới'
                        }
                    }));
                    showToast(`✨ Đã viết mới biến thể AI cho "${groupName}"!`, 'success');
                } catch (err) {
                    setGroupVariations(prev => ({
                        ...prev,
                        [groupId]: {
                            ...(prev[groupId] || {}),
                            isRewriting: false
                        }
                    }));
                    showToast(`Lỗi viết lại cho "${groupName}": ${err.message}`, 'error');
                }
            };

            // Cleanup typing interval on unmount
            useEffect(() => {
                return () => {
                    if (typingIntervalRef.current) {
                        clearInterval(typingIntervalRef.current);
                        typingIntervalRef.current = null;
                    }
                };
            }, []);

            // Helper: Smart Facebook Sales Content Formatter (splits dense emoji bullets, jammed hashtags & adds section spacing)
            const formatSalesContent = (text) => {
                if (!text) return "";
                const BULLET_LEAD_EMOJI = '(?:✨|⚡|🔥|💥|🎯|✅|✔️|☑️|👉|📌|📍|📞|☎️|📲|💬|💰|💵|🎁|🎉|🏷️|⭐|🌟|💎|🚀|🛡️|🎓|♻️|💳|🖥️|💻|📱|⏰|🕒|🏪|🏠|🚚|📦|❤️|🔹|🔸|▪️|•|📢|🔔|💡|🏆)';
                const PRICING_EMOJI_RE = /^(?:💰|💵|🎁|🏷️|💳|🎓|♻️)/u;
                const CONTACT_EMOJI_RE = /^(?:📍|📌|👉|🏪|🏠|📞|☎️|📲|⏰|🕒)/u;

                let normalized = text
                    .replace(/\r\n/g, '\n')
                    .replace(/\r/g, '\n')
                    .replace(/\u00A0/g, ' ');

                // 1. Separate hashtags jammed directly onto preceding text (e.g. "0355936679#CellphoneS")
                normalized = normalized.replace(/([^\s#\n])(#[\p{L}\p{N}_]+)/gu, '$1\n\n$2');

                // 2. Split "| <emoji> ..." into separate bullet lines (keep "Hotline: ... | Zalo: ..." on one line)
                const pipeBulletRe = new RegExp(`\\s*\\|\\s*(?=${BULLET_LEAD_EMOJI}\\s+\\S)`, 'gu');
                normalized = normalized.replace(pipeBulletRe, '\n');

                // 3. Split inline bullet emojis followed by space + text (preserve trailing headline emojis like "💻✨")
                const inlineBulletRe = new RegExp(`([^\\n])\\s*(${BULLET_LEAD_EMOJI}(?=\\s+[^\\s\\n]))`, 'gu');
                normalized = normalized
                    .split('\n')
                    .map((line) => {
                        const trimmed = line.trim();
                        if (!trimmed || /^#[\p{L}\p{N}_]/u.test(trimmed)) return trimmed;
                        return trimmed.replace(inlineBulletRe, '$1\n$2');
                    })
                    .join('\n');

                // 4. Clean whitespace and add breathing room between Hook, Features, Price/Promo, Contact, and Hashtags
                const rawLines = normalized.split('\n').map((l) => l.replace(/[ \t]{2,}/g, ' ').trim());
                const out = [];
                const getSectionType = (line) => {
                    if (!line) return 'empty';
                    if (/^#[\p{L}\p{N}_]/u.test(line)) return 'hashtag';
                    if (CONTACT_EMOJI_RE.test(line)) return 'contact';
                    if (PRICING_EMOJI_RE.test(line)) return 'pricing';
                    return 'body';
                };

                let prevNonEmptyType = null;
                for (let i = 0; i < rawLines.length; i++) {
                    const line = rawLines[i];
                    if (!line) {
                        if (out.length > 0 && out[out.length - 1] !== '') out.push('');
                        continue;
                    }
                    const currentType = prevNonEmptyType === null ? 'headline' : getSectionType(line);
                    const hasLeadingBlank = out.length > 0 && out[out.length - 1] === '';
                    if (prevNonEmptyType !== null && !hasLeadingBlank) {
                        const shouldAddBlank =
                            prevNonEmptyType === 'headline' ||
                            currentType === 'hashtag' ||
                            (currentType === 'pricing' && prevNonEmptyType !== 'pricing') ||
                            (currentType === 'contact' && prevNonEmptyType !== 'contact');
                        if (shouldAddBlank) out.push('');
                    }
                    out.push(line);
                    if (currentType !== 'empty') prevNonEmptyType = currentType;
                }

                return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
            };

            // Server-side Gemini API to rewrite content with unique copywriting angles & anti-duplication guards
            const rewriteWithGemini = async (text, options = {}) => {
                if (!text || !text.trim()) {
                    return { text: '', model, angleLabel: '', angleId: '' };
                }

                const opts = typeof options === 'string' ? { groupName: options } : (options || {});
                const {
                    groupName = '',
                    variationIndex,
                    totalVariations,
                    writingStyle: requestedStyle = writingStyle,
                    avoidOpenings = []
                } = opts;

                const callRewriteApi = async (requestedModel) => {
                    const response = await fetch('/api/gemini/rewrite', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            content: text,
                            model: requestedModel,
                            customPrompt: customPrompt,
                            groupName: groupName,
                            variationIndex: variationIndex,
                            totalVariations: totalVariations,
                            writingStyle: requestedStyle,
                            avoidOpenings: avoidOpenings
                        })
                    });

                    const rawText = await response.text();
                    let data = {};
                    try { data = rawText ? JSON.parse(rawText) : {}; } catch (_) {}

                    if (!response.ok) {
                        const fallbackMsg = response.status === 504
                            ? 'Máy chủ Vercel phản hồi quá thời gian chờ (504).'
                            : (rawText && !rawText.trim().startsWith('<') ? rawText.trim().slice(0, 180) : `HTTP ${response.status}`);
                        const err = new Error(data.error || fallbackMsg);
                        err.status = response.status;
                        throw err;
                    }
                    return data;
                };

                try {
                    const varBadge = typeof variationIndex === 'number'
                        ? ` · Biến thể #${variationIndex + 1}${totalVariations ? `/${totalVariations}` : ''}`
                        : '';
                    addLog('info', `🤖 Gọi Gemini AI (${model}${varBadge}) cho "${groupName || 'bài viết'}"...`);

                    let data;
                    try {
                        data = await callRewriteApi(model);
                        if (!(data.rewritten || data.text || '').trim()) {
                            const emptyErr = new Error('AI trả về nội dung rỗng. Vui lòng thử lại.');
                            emptyErr.status = 502;
                            throw emptyErr;
                        }
                    } catch (firstErr) {
                        const isTimeoutOrTransient =
                            firstErr?.status === 504 ||
                            firstErr?.status === 502 ||
                            /timed out|504|502|nội dung rỗng|network/i.test(firstErr?.message || '');
                        if (isTimeoutOrTransient) {
                            const altModel = model === 'gemini-3.1-flash-lite' ? 'gemini-4-hydrogen' : 'gemini-3.1-flash-lite';
                            addLog('info', `⚡ Thử lại tự động bằng ${altModel}...`);
                            data = await callRewriteApi(altModel);
                        } else {
                            throw firstErr;
                        }
                    }

                    const result = (data.rewritten || data.text || '').trim();
                    if (!result) {
                        throw new Error('AI trả về nội dung rỗng. Vui lòng thử lại.');
                    }

                    const angleSuffix = data.angleLabel ? ` · Góc viết: ${data.angleLabel}` : '';
                    addLog('success', `✅ Gemini AI (${data.model || model}${angleSuffix}) đã viết xong (${result.length} ký tự)`);
                    return {
                        text: result,
                        model: data.model || model,
                        angleLabel: data.angleLabel || '',
                        angleId: data.angleId || ''
                    };
                } catch (error) {
                    console.error("AI API Error:", error);
                    addLog('error', `❌ Lỗi AI: ${error.message}`);
                    throw error;
                }
            };

            const sleep = (ms) => new Promise(r => setTimeout(r, ms));

            const handleTestGemini = async () => {
                if (!content.trim()) return showToast('Vui lòng nhập nội dung trước!', 'error');
                if (isRewriting) return;

                if (typingIntervalRef.current) {
                    clearInterval(typingIntervalRef.current);
                    typingIntervalRef.current = null;
                }

                setIsRewriting(true);
                addLog('info', '✍️ Đang tối ưu bài viết chuyên nghiệp bằng Gemini AI...');

                try {
                    const spinned = spinEnabled ? spinContent(content) : content;
                    const currentOpening = extractOpeningLine(content);

                    const aiRes = await rewriteWithGemini(spinned, {
                        groupName: 'Tối ưu bài viết chính',
                        writingStyle,
                        avoidOpenings: currentOpening ? [currentOpening] : []
                    });
                    const rewritten = aiRes.text;

                    if (rewritten && rewritten.trim()) {
                        const isIdentical = rewritten.trim() === content.trim() || rewritten.trim() === spinned.trim();
                        if (isIdentical) {
                            addLog('warning', '⚠️ AI trả về nội dung tương đồng với bản gốc.');
                        } else {
                            addLog('success', `✅ Đã tối ưu bài viết chuyên nghiệp (${aiRes.angleLabel || 'Copywriting AI'} · ${rewritten.length} ký tự)`);
                        }

                        // Fast smooth typing effect with guaranteed cleanup
                        setContent('');
                        let i = 0;
                        const step = Math.max(2, Math.ceil(rewritten.length / 80));
                        typingIntervalRef.current = setInterval(() => {
                            i = Math.min(rewritten.length, i + step);
                            setContent(rewritten.substring(0, i));
                            if (i >= rewritten.length) {
                                clearInterval(typingIntervalRef.current);
                                typingIntervalRef.current = null;
                                setIsRewriting(false);
                                showToast(
                                    isIdentical
                                        ? 'Đã cập nhật nội dung!'
                                        : `✨ Đã tối ưu bài viết chuyên nghiệp (${aiRes.angleLabel || 'AI'})!`,
                                    isIdentical ? 'info' : 'success'
                                );
                            }
                        }, 16);
                    } else {
                        setIsRewriting(false);
                        addLog('error', '❌ AI không trả về nội dung hợp lệ.');
                        showToast('AI không thể viết lại nội dung. Kiểm tra log để biết chi tiết.', 'warning');
                    }
                } catch (err) {
                    setIsRewriting(false);
                    addLog('error', `❌ Lỗi viết lại: ${err.message}`);
                    showToast(`Lỗi viết lại: ${err.message}`, 'error');
                }
            };

            const handleStopPost = () => {
                if (!isPosting) return;
                stopPostingRef.current = true;
                abortAllPendingPosts();
                setPostingCountdown(null);
                setIsPosting(false);
                addLog('warning', '⏹️ Đã dừng chiến dịch đăng bài theo yêu cầu.');
                showToast('⏹️ Đã dừng chiến dịch đăng bài.', 'warning');
            };

            const handleStartPost = async () => {
                if (isPosting) {
                    return showToast('Đang trong tiến trình đăng bài!', 'warning');
                }
                if (!content.trim()) {
                    return showToast('Vui lòng nhập nội dung bài viết!', 'error');
                }
                if (selectedGroups.size === 0) {
                    return showToast('Vui lòng chọn ít nhất 1 nhóm!', 'error');
                }

                // Subscription Check
                if (subscription.plan === 'free' && selectedGroups.size > 3) {
                    return showToast('Gói MIỄN PHÍ chỉ được chọn tối đa 3 nhóm. Vui lòng nâng cấp!', 'error');
                }
                if (subscription.plan !== 'free' && !isSubscriptionActive()) {
                    return showToast('Gói dịch vụ đã hết hạn. Vui lòng gia hạn để tiếp tục!', 'error');
                }

                stopPostingRef.current = false;
                setProgress(0);
                setIsPosting(true);

                const isSimulated = !extensionStatus;
                showToast(
                    isSimulated
                        ? `🧪 Đang mô phỏng đăng bài lên ${selectedGroups.size} nhóm (chế độ xem trước)...`
                        : `🚀 Bắt đầu đăng lên ${selectedGroups.size} nhóm${spinEnabled ? ' (AI tạo bài riêng từng nhóm)' : ''}...`,
                    'info'
                );
                addLog(
                    'info',
                    isSimulated
                        ? `🧪 Chế độ xem trước (chưa kết nối Extension): mô phỏng chiến dịch ${selectedGroups.size} nhóm`
                        : `🚀 Bắt đầu chiến dịch đăng bài lên ${selectedGroups.size} nhóm${spinEnabled ? ' · Bật AI chống spam cho từng nhóm' : ''}`
                );

                const groupsToPost = groups.filter(g => selectedGroups.has(g.id));
                const total = groupsToPost.length;
                let successCount = 0;

                // Track openings & normalized content across all groups in this run so zero duplicates are posted
                const usedOpenings = [];
                const usedNormalizedBodies = new Set();
                const normalizeForDupCheck = (str) => (str || '').toLowerCase().replace(/\s+/g, ' ').trim();

                try {
                    for (let i = 0; i < total; i++) {
                        if (stopPostingRef.current) break;

                        const group = groupsToPost[i];

                        // 1. Prepare genuinely unique, professional content per group when spinEnabled is ON
                        const existingVar = groupVariations[group.id];
                        const uniqueImagesList = existingVar?.images?.length === images.length
                            ? existingVar.images
                            : (spinEnabled ? shuffleArray(images) : [...images]);
                        const uniqueImages = (uniqueImagesList || []).map(img => img.data);

                        let uniqueContent = '';

                        if (spinEnabled) {
                            const hasFreshPreGeneratedAi =
                                existingVar &&
                                existingVar.isAiRewritten &&
                                existingVar.sourceContent === content &&
                                existingVar.content &&
                                existingVar.content.trim().length > 0 &&
                                !usedNormalizedBodies.has(normalizeForDupCheck(existingVar.content));

                            if (hasFreshPreGeneratedAi) {
                                uniqueContent = formatSalesContent(existingVar.content);
                                addLog('info', `✨ Dùng biến thể AI đã tạo sẵn (${existingVar.angleLabel || `Biến thể #${i + 1}`}) cho "${group.name}"`);
                            } else {
                                addLog('info', `✨ [Chống spam AI ${i + 1}/${total}] Đang viết biến thể chuyên nghiệp riêng cho "${group.name}"...`);
                                setGroupVariations(prev => ({
                                    ...prev,
                                    [group.id]: {
                                        ...(prev[group.id] || { sourceContent: content, content, images: uniqueImagesList, groupName: group.name }),
                                        isRewriting: true
                                    }
                                }));

                                try {
                                    const baseSpinned = spinContent(content);
                                    const aiRes = await rewriteWithGemini(baseSpinned, {
                                        groupName: group.name,
                                        variationIndex: i,
                                        totalVariations: total,
                                        writingStyle,
                                        avoidOpenings: usedOpenings
                                    });
                                    if (stopPostingRef.current) break;
                                    uniqueContent = formatSalesContent(aiRes.text);

                                    setGroupVariations(prev => ({
                                        ...prev,
                                        [group.id]: {
                                            ...(prev[group.id] || {}),
                                            sourceContent: content,
                                            content: uniqueContent,
                                            images: uniqueImagesList,
                                            groupName: group.name,
                                            isAiRewritten: true,
                                            isRewriting: false,
                                            angleLabel: aiRes.angleLabel || `Biến thể #${i + 1}`
                                        }
                                    }));
                                } catch (aiErr) {
                                    setGroupVariations(prev => ({
                                        ...prev,
                                        [group.id]: {
                                            ...(prev[group.id] || {}),
                                            isRewriting: false
                                        }
                                    }));
                                    addLog('error', `❌ Dừng đăng nhóm "${group.name}" để tránh đăng trùng lặp spam vì AI gặp lỗi: ${aiErr.message}`);
                                    showToast(`Lỗi AI ở nhóm "${group.name}": ${aiErr.message}`, 'error');
                                    continue;
                                }
                            }

                            const openingLine = extractOpeningLine(uniqueContent);
                            if (openingLine) usedOpenings.push(openingLine);
                            usedNormalizedBodies.add(normalizeForDupCheck(uniqueContent));
                        } else {
                            uniqueContent = formatSalesContent(existingVar?.content || content);
                        }

                        if (stopPostingRef.current) break;

                        let postResult = { success: false };

                        if (isSimulated) {
                            addLog('info', `🧪 [Mô phỏng] Đang đăng lên: ${group.name} (${uniqueContent.length} ký tự, ${uniqueImages.length} ảnh)`);
                            await sleep(600);
                            if (stopPostingRef.current) break;
                            postResult = { success: true };
                            addLog('success', `✅ Đăng bài OK: ${group.name} (Mô phỏng)`, group.url || `https://www.facebook.com/groups/${group.id}`);
                        } else {
                            // 2. Send Post Command to Chrome Extension
                            window.postMessage({
                                type: 'POST_TO_GROUP',
                                groupId: String(group.id),
                                groupUrl: group.url || `https://www.facebook.com/groups/${group.id}`,
                                content: uniqueContent,
                                images: uniqueImages,
                                postMode: postMode
                            }, '*');

                            addLog('info', `📤 Đang đăng lên: ${group.name} (${uniqueContent.length} ký tự, ${uniqueImages.length} ảnh)`);

                            // 3. Wait for actual POST_SUCCESS or POST_ERROR response
                            try {
                                postResult = await waitForPostResult(group.id, 180000);
                            } catch (e) {
                                addLog('error', `⏰ Timeout đăng nhóm ${group.name}`);
                            }
                        }

                        if (stopPostingRef.current) break;

                        if (postResult.success) {
                            successCount++;
                        }

                        // Strict Progress: Only reach 100% if ALL posts succeed
                        setProgress(Math.round((successCount / total) * 100));

                        // 4. Countdown AFTER post result (before next group)
                        if (i < total - 1 && !stopPostingRef.current) {
                            try {
                                const savedMin = isSimulated ? 1 : (Number(storage.get('fb_delay_min', 60)) || 10);
                                const savedMax = isSimulated ? 2 : (Number(storage.get('fb_delay_max', 120)) || 30);
                                const dMax = savedMax > savedMin ? savedMax : (savedMin + (isSimulated ? 1 : 30));

                                const delaySec = Math.floor(Math.random() * (dMax - savedMin + 1)) + savedMin;
                                setPostingCountdown({ current: delaySec, total: delaySec });
                                for (let s = delaySec; s > 0; s--) {
                                    if (stopPostingRef.current) break;
                                    setPostingCountdown({ current: s, total: delaySec });
                                    const statusMsg = postResult.success
                                        ? `✅ Đăng xong! Đợi ${s}s trước nhóm tiếp theo...`
                                        : `⏳ Đợi ${s}s trước nhóm tiếp theo...`;
                                    addLog('info', statusMsg);
                                    await sleep(1000);
                                }
                                setPostingCountdown(null);
                            } catch (e) {
                                console.error('Delay Error:', e);
                                setPostingCountdown(null);
                                await sleep(1000);
                            }
                        }
                    }

                    if (!stopPostingRef.current) {
                        addLog('success', `🎉 Hoàn tất chiến dịch: ${successCount}/${total} nhóm thành công.`);
                        showToast(`🎉 Hoàn tất: ${successCount}/${total} nhóm thành công!`, successCount === total ? 'success' : 'warning');
                    }
                } finally {
                    setPostingCountdown(null);
                    setIsPosting(false);
                }
            };

            const handleEnterPreviewMode = () => {
                setPreviewMode(true);
                storage.set('preview_mode', true);
                if (!googleUser) {
                    const guestUser = {
                        id: 'local_demo_user',
                        uid: 'local_demo_user',
                        sub: 'local_demo_user',
                        name: 'Khách trải nghiệm',
                        displayName: 'Khách trải nghiệm',
                        email: 'demo@autopost.local',
                        picture: '',
                        photoURL: '',
                        isFirebaseAuth: false
                    };
                    localStorage.setItem('autopost_local_user', JSON.stringify(guestUser));
                    storage.set('google_user', guestUser);
                    setGoogleUser(guestUser);
                    fetch('/api/users/sync', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: guestUser.uid,
                            email: guestUser.email,
                            displayName: guestUser.displayName,
                            photoURL: ''
                        })
                    }).catch(() => {});
                }
                if (!fbUser) {
                    const demoFb = {
                        userName: 'Tài khoản Facebook (Xem trước)',
                        userId: 'preview_fb',
                        userAvatar: ''
                    };
                    setFbUser(demoFb);
                }
                showToast('🚀 Đã vào bảng điều khiển! Bạn có thể dùng thử ngay hoặc cài Extension để đăng thật.', 'info');
            };

            const currentSetupStep = (() => {
                if (!googleUser) return 0;
                if (!fbUser) return 1;
                return 2;
            })();

            const isFullySetup = previewMode || currentSetupStep === 2;

            if (!authInitialized) {
                return (
                    <div className="min-h-screen flex flex-col items-center justify-center bg-background-light dark:bg-background-dark transition-colors duration-300">
                        <div className="flex flex-col items-center gap-4">
                            <div className="relative flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-tr from-primary to-indigo-600 shadow-lg shadow-primary/20 animate-pulse">
                                <span className="material-symbols-outlined text-white text-[32px]">offline_share</span>
                            </div>
                            <h1 className="text-lg font-bold bg-gradient-to-r from-primary to-indigo-500 bg-clip-text text-transparent">
                                AutoPost Pro
                            </h1>
                            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mt-2" />
                        </div>
                    </div>
                );
            }

            return (
                <ThemeContext.Provider value={{ theme, setTheme }}>
                    <LanguageContext.Provider value={{ lang, setLang, t }}>
                        <AppContext.Provider value={{ showToast, addLog }}>
                            <div className="min-h-screen flex flex-col bg-background-light dark:bg-background-dark text-text-main font-display antialiased transition-colors duration-300 selection:bg-primary/20 selection:text-primary">
                                {(!previewMode && activePage !== 'subscription' && (!extensionStatus || !googleUser)) ? (
                                    <div className="flex-1 flex flex-col items-center justify-center">
                                        <SetupWizard
                                            t={t}
                                            extensionStatus={extensionStatus}
                                            googleUser={googleUser}
                                            onGoogleLogin={handleGoogleLogin}
                                            subscription={subscription}
                                            fbUser={fbUser}
                                            onFBConnect={() => window.postMessage({ type: 'OPEN_FACEBOOK' }, '*')}
                                            groups={groups}
                                            onScanGroups={handleScan}
                                            isScanningGroups={isScanningGroups}
                                            setActivePage={setActivePage}
                                            onEnterPreview={handleEnterPreviewMode}
                                        />
                                    </div>
                                ) : (
                                    <>
                                        <Header 
                                            extensionStatus={extensionStatus} 
                                            fbUser={fbUser} 
                                            setFbUser={setFbUser} 
                                            googleUser={googleUser} 
                                            onGoogleLogin={handleGoogleLogin} 
                                            onGoogleLogout={handleGoogleLogout} 
                                            subscription={subscription} 
                                            userRole={userRole} 
                                            setActivePage={setActivePage} 
                                            getSubscriptionTimeLeft={getSubscriptionTimeLeft}
                                            sidebarCollapsed={sidebarCollapsed}
                                            settings={settings}
                                        />
                                        <div className="flex flex-1">
                                            {/* Professional Collapsible Sidebar */}
                                            <aside className={`hidden lg:flex flex-col bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 fixed top-0 left-0 h-screen z-[60] transition-all duration-300 ease-out ${sidebarCollapsed ? 'w-14' : 'w-52'}`}>
                                                <div className={`h-16 flex items-center border-b border-gray-200 dark:border-slate-800 ${sidebarCollapsed ? 'justify-center px-2' : 'px-3 gap-2'}`}>
                                                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                                        {settings.logoUrl ? (
                                                            <img src={settings.logoUrl} className="w-full h-full object-cover" alt="Logo" />
                                                        ) : (
                                                            <span className="material-symbols-outlined text-primary text-xl">rocket_launch</span>
                                                        )}
                                                    </div>
                                                    {!sidebarCollapsed && (
                                                        <div className="overflow-hidden">
                                                            <span className="font-bold text-text-main dark:text-white text-sm block leading-tight">{settings.appName || 'AutoPost Pro'}</span>
                                                            <span className="text-[10px] text-text-secondary">Enterprise</span>
                                                        </div>
                                                    )}
                                                </div>
                                                <button onClick={() => { setSidebarCollapsed(prev => { storage.set('sidebar_collapsed', !prev); return !prev; }); }} className="absolute -right-3 top-4 w-6 h-6 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 dark:hover:bg-slate-700 transition-all z-10">
                                                    <span className={`material-symbols-outlined text-sm text-gray-500 transition-transform duration-300 ${sidebarCollapsed ? 'rotate-180' : ''}`}>chevron_left</span>
                                                </button>
                                                <nav className={`flex-1 py-3 space-y-1 ${sidebarCollapsed ? 'px-1.5' : 'px-2'}`}>
                                                    <a href="/" className={`w-full flex items-center rounded-lg text-left transition-all ${sidebarCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'} ${activePage === 'post' ? 'bg-primary text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`} title={t('nav_post')}>
                                                        <span className="material-symbols-outlined text-xl flex-shrink-0">edit_note</span>
                                                        {!sidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">{t('nav_post')}</span>}
                                                    </a>
                                                    <a href="/share" className={`w-full flex items-center rounded-lg text-left transition-all ${sidebarCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'} ${activePage === 'share' ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`} title={t('nav_share')}>
                                                        <span className="material-symbols-outlined text-xl flex-shrink-0">share</span>
                                                        {!sidebarCollapsed && <span className="font-medium text-sm whitespace-nowrap">{t('nav_share')}</span>}
                                                    </a>
                                                    <div className={`my-2 ${sidebarCollapsed ? 'mx-1' : 'mx-0'}`}><div className="border-t border-gray-200 dark:border-slate-700"></div></div>
                                                    <a href="/pricing" className={`w-full flex items-center rounded-lg text-left transition-all ${sidebarCollapsed ? 'justify-center p-2.5' : 'gap-3 px-3 py-2.5'} ${activePage === 'subscription' ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/20' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-slate-800'}`} title={t('nav_subscription')}>
                                                        <span className="material-symbols-outlined text-xl flex-shrink-0">workspace_premium</span>
                                                        {!sidebarCollapsed && (
                                                            <div className="flex flex-col">
                                                                <span className="font-medium text-sm whitespace-nowrap">{t('nav_subscription')}</span>
                                                                {subscription.plan !== 'free' && isSubscriptionActive() && (
                                                                    <span className={`text-[9px] font-bold uppercase tracking-wider ${activePage === 'subscription' ? 'text-white/70' : 'text-amber-500'}`}>{subscription.plan}</span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </a>
                                                </nav>
                                                <div className={`p-2 border-t border-gray-200 dark:border-slate-800 ${sidebarCollapsed ? 'flex flex-col items-center gap-1.5' : 'space-y-2'}`}>
                                                    <div className={`flex items-center justify-between gap-2 ${sidebarCollapsed ? 'justify-center' : ''}`}>
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${extensionStatus ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                                                            {!sidebarCollapsed && <span className="text-xs text-gray-500 truncate">{extensionStatus ? 'Extension Active' : 'Extension Not Found'}</span>}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={async () => {
                                                            try {
                                                                const { filename, kb } = await downloadExtensionZip('3.8');
                                                                showToast(`Đã tải ${filename} (${kb} KB)! Hãy gỡ bản cũ trong chrome://extensions rồi nạp thư mục fb-tool-ext-v3.8.`, 'success');
                                                            } catch (e) {
                                                                showToast(e?.message || 'Lỗi tải Extension v3.8', 'error');
                                                            }
                                                        }}
                                                        title="Tải bản cập nhật Extension v3.8 (đăng bài ngầm chắc chắn đủ chữ + ảnh, chống đăng bài trống chữ)"
                                                        className={`w-full flex items-center rounded-lg text-primary bg-primary/10 hover:bg-primary/20 transition-colors font-semibold ${sidebarCollapsed ? 'justify-center p-1.5' : 'justify-center gap-1.5 px-2 py-1.5 text-[11px]'}`}
                                                    >
                                                        <span className="material-symbols-outlined text-[15px]">download</span>
                                                        {!sidebarCollapsed && <span>Tải Extension v3.8</span>}
                                                    </button>
                                                    {!sidebarCollapsed && extensionStatus && installedExtVersion && (
                                                        <div className={`mt-1.5 px-2 py-1 rounded-md text-[10px] font-semibold flex items-center justify-between ${installedExtVersion === REQUIRED_EXT_VERSION && duplicateExtCount <= 1 ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400'}`}>
                                                            <span>Đang chạy: v{installedExtVersion}</span>
                                                            <span>{installedExtVersion === REQUIRED_EXT_VERSION && duplicateExtCount <= 1 ? 'Mới nhất' : 'Cần cập nhật'}</span>
                                                        </div>
                                                    )}
                                                    {fbUser && (
                                                        <div className={`mt-2 flex items-center justify-between gap-2 p-1.5 rounded-lg bg-gray-50 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-700/50 ${sidebarCollapsed ? 'justify-center' : ''}`}>
                                                            <div className="flex items-center gap-2 overflow-hidden">
                                                                {fbUser.userAvatar ? (
                                                                    <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-slate-700 bg-cover bg-center flex-shrink-0 border border-white dark:border-slate-600 shadow-sm" style={{ backgroundImage: `url(${fbUser.userAvatar})` }}></div>
                                                                ) : (
                                                                    <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 border border-white dark:border-slate-600 shadow-sm">
                                                                        {(fbUser.userName || fbUser.name || 'F').charAt(0).toUpperCase()}
                                                                    </div>
                                                                )}
                                                                {!sidebarCollapsed && <span className="text-[10px] font-bold text-gray-700 dark:text-gray-300 truncate">{fbUser.userName || fbUser.name || 'Facebook User'}</span>}
                                                            </div>
                                                            {!sidebarCollapsed && (
                                                                <button
                                                                    onClick={() => {
                                                                        setFbUser(null);
                                                                        setGroups([]);
                                                                        setSelectedGroups(new Set());
                                                                        storage.remove('fb_user_info');
                                                                        storage.remove('fb_groups');
                                                                        storage.remove('fb_selected_groups');
                                                                        showToast('Đã đăng xuất Facebook', 'info');
                                                                    }}
                                                                    className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded-md"
                                                                    title={t('logout')}
                                                                >
                                                                    <span className="material-symbols-outlined text-[14px]">logout</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </aside>

                                            {/* Main Content Area */}
                                            <main className={`flex-1 pt-5 pb-24 lg:py-8 px-3.5 ${sidebarCollapsed ? 'lg:ml-14' : 'lg:ml-52'} sm:px-6 lg:px-8 w-full min-w-0`}>

                                                {/* POST PAGE */}
                                                {activePage === 'post' && (
                                                    !isFullySetup ? (
                                                        <SetupWizard
                                                            t={t}
                                                            extensionStatus={extensionStatus}
                                                            googleUser={googleUser}
                                                            onGoogleLogin={handleGoogleLogin}
                                                            subscription={subscription}
                                                            fbUser={fbUser}
                                                            onFBConnect={() => window.postMessage({ type: 'OPEN_FACEBOOK' }, '*')}
                                                            groups={groups}
                                                            onScanGroups={handleScan}
                                                            isScanningGroups={isScanningGroups}
                                                            setActivePage={setActivePage}
                                                            onEnterPreview={handleEnterPreviewMode}
                                                        />
                                                    ) : (
                                                        <>
                                                            <div className="mb-8">
                                                                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-main dark:text-white mb-1.5">{t('nav_post')}</h1>
                                                                <p className="text-text-secondary text-sm">{t('campaign_desc')}</p>
                                                            </div>
                                                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
                                                                <div className="lg:col-span-8 flex flex-col gap-6">
                                                                    <ContentEditor
                                                                        content={content}
                                                                        onContentChange={setContent}
                                                                        onFormatContent={() => {
                                                                            if (!content || !content.trim()) return;
                                                                            const formatted = formatSalesContent(content);
                                                                            setContent(formatted);
                                                                            showToast('Đã tối ưu bố cục & tự động xuống dòng chuẩn Facebook!', 'success');
                                                                        }}
                                                                        images={images}
                                                                        onImagesChange={setImages}
                                                                        onTestAI={handleTestGemini}
                                                                        spinEnabled={spinEnabled}
                                                                        setSpinEnabled={setSpinEnabled}
                                                                        isRewriting={isRewriting}
                                                                        t={t}
                                                                        fbUser={fbUser}
                                                                        groups={groups}
                                                                        selectedGroups={selectedGroups}
                                                                        groupVariations={groupVariations}
                                                                        onRegenerateVariations={regenerateVariations}
                                                                        onRegenerateSingleGroup={regenerateSingleGroupVariation}
                                                                        isGeneratingVariations={isGeneratingVariations}
                                                                        writingStyle={writingStyle}
                                                                        setWritingStyle={setWritingStyle}
                                                                        selectedPage={selectedPage}
                                                                        setSelectedPage={setSelectedPage}
                                                                        fbPages={fbPages}
                                                                    />
                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                                        <SettingsDelay delayMin={safeDelayMin} setDelayMin={setSafeDelayMin} delayMax={safeDelayMax} setDelayMax={setSafeDelayMax} postingCountdown={postingCountdown} postMode={postMode} setPostMode={setPostMode} t={t} />
                                                                        <SettingsAI 
                                                                            model={model} 
                                                                            setModel={setModel} 
                                                                            writingStyle={writingStyle} 
                                                                            setWritingStyle={setWritingStyle} 
                                                                            customPrompt={customPrompt} 
                                                                            setCustomPrompt={setCustomPrompt} 
                                                                            defaultPrompt={defaultPrompt} 
                                                                            t={t} 
                                                                            addLog={addLog} 
                                                                            showToast={showToast} 
                                                                        />
                                                                    </div>
                                                                    <ProgressLog
                                                                        logs={logs}
                                                                        progress={progress}
                                                                        t={t}
                                                                        successItems={successItems}
                                                                        isCheckingStatus={isCheckingStatus}
                                                                        checkProgress={checkProgress}
                                                                        onCheckAllStatus={() => handleCheckPostStatuses(null)}
                                                                        onCheckSingleStatus={(id) => handleCheckPostStatuses([id])}
                                                                        onStopCheckStatus={handleStopCheckStatus}
                                                                        onClearSuccessItems={handleClearSuccessItems}
                                                                        collections={collections}
                                                                        onSaveLiveGroupsCollection={handleSaveLiveGroupsCollection}
                                                                        noTopMargin={true}
                                                                    />
                                                                </div>
                                                                <div className="lg:col-span-4 w-full min-w-0 lg:sticky lg:top-20 lg:self-start">
                                                                    <GroupsPanel
                                                                        fbUser={fbUser}
                                                                        selectedPage={selectedPage}
                                                                        groups={groups}
                                                                        selectedGroups={selectedGroups}
                                                                        onToggleGroup={(id) => {
                                                                            const newSet = new Set(selectedGroups);
                                                                            newSet.has(id) ? newSet.delete(id) : newSet.add(id);
                                                                            setSelectedGroups(newSet);
                                                                        }}
                                                                        setSelectedGroups={setSelectedGroups}
                                                                        onScan={handleScan}
                                                                        onStopScan={handleStopScan}
                                                                        onStartPost={handleStartPost}
                                                                        onStopPost={handleStopPost}
                                                                        isPosting={isPosting}
                                                                        extensionStatus={extensionStatus}
                                                                        onLoadDemoGroups={handleLoadDemoGroups}
                                                                        t={t}
                                                                        showToast={showToast}
                                                                        isScanningGroups={isScanningGroups}
                                                                        collections={collections}
                                                                        setCollections={setCollections}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </>
                                                    )
                                                )}

                                                {/* SHARE PAGE */}
                                                {activePage === 'share' && (
                                                    !isFullySetup ? (
                                                        <SetupWizard
                                                            t={t}
                                                            extensionStatus={extensionStatus}
                                                            googleUser={googleUser}
                                                            onGoogleLogin={handleGoogleLogin}
                                                            subscription={subscription}
                                                            fbUser={fbUser}
                                                            onFBConnect={() => window.postMessage({ type: 'OPEN_FACEBOOK' }, '*')}
                                                            groups={groups}
                                                            onScanGroups={handleScan}
                                                            isScanningGroups={isScanningGroups}
                                                            setActivePage={setActivePage}
                                                            onEnterPreview={handleEnterPreviewMode}
                                                        />
                                                    ) : (
                                                        <SharePage
                                                            fbUser={fbUser}
                                                            t={t}
                                                            fbPages={fbPages}
                                                            selectedPage={selectedPage}
                                                            setSelectedPage={setSelectedPage}
                                                            pageUrl={pageUrl}
                                                            setPageUrl={setPageUrl}
                                                            pagePosts={pagePosts}
                                                            selectedPosts={selectedPosts}
                                                            onTogglePost={(id) => {
                                                                const newSet = new Set(selectedPosts);
                                                                newSet.has(id) ? newSet.delete(id) : newSet.add(id);
                                                                setSelectedPosts(newSet);
                                                            }}
                                                            onToggleAllPosts={() => {
                                                                if (selectedPosts.size === pagePosts.length) {
                                                                    setSelectedPosts(new Set());
                                                                } else {
                                                                    setSelectedPosts(new Set(pagePosts.map(p => p.id)));
                                                                }
                                                            }}
                                                            groups={groups}
                                                            selectedGroups={selectedGroups}
                                                            onToggleGroup={(id) => {
                                                                const newSet = new Set(selectedGroups);
                                                                newSet.has(id) ? newSet.delete(id) : newSet.add(id);
                                                                setSelectedGroups(newSet);
                                                            }}
                                                            onToggleAll={() => {
                                                                if (selectedGroups.size === groups.length) {
                                                                    setSelectedGroups(new Set());
                                                                } else {
                                                                    setSelectedGroups(new Set(groups.map(g => g.id)));
                                                                }
                                                            }}
                                                            onFetchPages={handleFetchPages}
                                                            onGetCurrentPage={handleGetCurrentPage}
                                                            onAddManualPost={handleAddManualPostUrl}
                                                            onScan={handleScan}
                                                            onStopScan={handleStopScan}
                                                            onScanPagePosts={handleScanPagePosts}
                                                            onSharePosts={handleSharePosts}
                                                            onStopShare={handleStopShare}
                                                            shareCaption={shareCaption}
                                                            setShareCaption={setShareCaption}
                                                            spinEnabled={spinEnabled}
                                                            isFetchingPages={isFetchingPages}
                                                            isScanning={isScanning}
                                                            isSharing={isSharing}
                                                            installedExtVersion={installedExtVersion}
                                                            requiredExtVersion={REQUIRED_EXT_VERSION}
                                                            duplicateExtCount={duplicateExtCount}
                                                            shareCountdown={shareCountdown}
                                                            shareDelayMin={shareDelayMin}
                                                            setShareDelayMin={setShareDelayMin}
                                                            shareDelayMax={shareDelayMax}
                                                            setShareDelayMax={setShareDelayMax}
                                                            logs={logs}
                                                            progress={progress}
                                                            showToast={showToast}
                                                            isScanningGroups={isScanningGroups}
                                                            successItems={successItems}
                                                            isCheckingStatus={isCheckingStatus}
                                                            checkProgress={checkProgress}
                                                            onCheckAllStatus={() => handleCheckPostStatuses(null)}
                                                            onCheckSingleStatus={(id) => handleCheckPostStatuses([id])}
                                                            onStopCheckStatus={handleStopCheckStatus}
                                                            onClearSuccessItems={handleClearSuccessItems}
                                                            collections={collections}
                                                            onSaveLiveGroupsCollection={handleSaveLiveGroupsCollection}
                                                        />
                                                    )
                                                )}

                                                {/* SUBSCRIPTION PAGE */}
                                                {activePage === 'subscription' && (
                                                    <SubscriptionPage
                                                        t={t}
                                                        googleUser={googleUser}
                                                        subscription={subscription}
                                                        onGoogleLogin={handleGoogleLogin}
                                                        onGoogleLogout={handleGoogleLogout}
                                                        onSelectPlan={handleSelectPlan}
                                                        getSubscriptionDaysLeft={getSubscriptionDaysLeft}
                                                        isSubscriptionActive={isSubscriptionActive}
                                                    />
                                                )}
                                                {/* Payment Modal */}
                                                {showPaymentModal && (
                                                    <PaymentModal
                                                        t={t}
                                                        plan={selectedPlan}
                                                        subscription={subscription}
                                                        isSubscriptionActive={isSubscriptionActive}
                                                        onConfirm={handleConfirmPayment}
                                                        onClose={() => setShowPaymentModal(false)}
                                                        settings={settings}
                                                    />
                                                )}
                                            </main>
                                        </div>

                                        {/* Fixed Mobile Bottom Navigation Bar */}
                                        <nav aria-label="Điều hướng di động" className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-gray-200 dark:border-slate-800 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] pb-safe">
                                            <div className={`grid ${userRole === 'admin' ? 'grid-cols-4' : 'grid-cols-3'} max-w-lg mx-auto px-1.5 pt-1.5`}>
                                                <a href="/" className={`flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-xl text-[11px] font-semibold transition-all ${activePage === 'post' ? 'text-primary bg-primary/10 dark:bg-primary/20' : 'text-gray-500 dark:text-gray-400'}`}>
                                                    <span className="material-symbols-outlined text-[22px]">edit_note</span>
                                                    <span className="truncate max-w-full px-1">{t('nav_post')}</span>
                                                </a>
                                                <a href="/share" className={`flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-xl text-[11px] font-semibold transition-all ${activePage === 'share' ? 'text-purple-600 dark:text-purple-400 bg-purple-500/10' : 'text-gray-500 dark:text-gray-400'}`}>
                                                    <span className="material-symbols-outlined text-[22px]">share</span>
                                                    <span className="truncate max-w-full px-1">{t('nav_share')}</span>
                                                </a>
                                                <a href="/pricing" className={`flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-xl text-[11px] font-semibold transition-all ${activePage === 'subscription' ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10' : 'text-gray-500 dark:text-gray-400'}`}>
                                                    <span className="material-symbols-outlined text-[22px]">workspace_premium</span>
                                                    <span className="truncate max-w-full px-1">{t('nav_subscription')}</span>
                                                </a>
                                                {userRole === 'admin' && (
                                                    <a href="/admin" className="flex flex-col items-center justify-center gap-0.5 min-h-[52px] rounded-xl text-[11px] font-semibold text-gray-500 dark:text-gray-400 hover:text-primary transition-all">
                                                        <span className="material-symbols-outlined text-[22px]">shield</span>
                                                        <span className="truncate max-w-full px-1">Admin</span>
                                                    </a>
                                                )}
                                            </div>
                                        </nav>
                                    </>
                                )}
                                <ToastContainer toasts={toasts} removeToast={removeToast} />
                            </div>
                        </AppContext.Provider>
                    </LanguageContext.Provider>
                </ThemeContext.Provider>
            );
        }

        // ========================================
        // Components
        // ========================================

        function Header({ extensionStatus, fbUser, setFbUser, googleUser, onGoogleLogin, onGoogleLogout, subscription, userRole, setActivePage, getSubscriptionTimeLeft, sidebarCollapsed, settings = {} }) {
            const { theme, setTheme } = useContext(ThemeContext);
            const { lang, setLang, t } = useContext(LanguageContext);
            const { showToast } = useContext(AppContext);
            const [showUserDropdown, setShowUserDropdown] = useState(false);
            const dropdownRef = useRef(null);

            useEffect(() => {
                function handleClickOutside(event) {
                    if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                        setShowUserDropdown(false);
                    }
                }
                document.addEventListener("mousedown", handleClickOutside);
                return () => {
                    document.removeEventListener("mousedown", handleClickOutside);
                };
            }, [dropdownRef]);

            const isSubscriptionActive = () => {
                if (subscription.plan === 'free') return true;
                if (subscription.status === 'expired') return false;
                if (!subscription.expiresAt) return false;
                return new Date(subscription.expiresAt) > new Date();
            };

            return (
                <header className={`sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-border-light shadow-sm transition-all duration-300 ${sidebarCollapsed ? 'lg:pl-14' : 'lg:pl-52'}`}>
                    <div className="px-3.5 sm:px-6 lg:px-8">
                        <div className="flex justify-between h-14 sm:h-16 items-center gap-2">
                            {/* Left Side: Mobile Brand Mark */}
                            <a href="/" className="flex lg:hidden items-center gap-2 min-w-0">
                                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                                    {settings.logoUrl ? (
                                        <img src={settings.logoUrl} className="w-full h-full object-cover" alt="Logo" />
                                    ) : (
                                        <span className="material-symbols-outlined text-primary text-[19px]">rocket_launch</span>
                                    )}
                                </div>
                                <span className="font-bold text-text-main dark:text-white text-sm truncate">{settings.appName || 'AutoPost Pro'}</span>
                            </a>
                            <div className="hidden lg:flex items-center gap-2"></div>

                            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                                {/* Plan Badge & Real-time Countdown */}
                                {googleUser && (
                                    <div className="flex items-center gap-1.5 sm:gap-2">
                                        <a href="/pricing" className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider shadow-sm transition-all duration-300 ${
                                            subscription.plan === 'pro' 
                                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20' 
                                                : subscription.plan === 'enterprise' 
                                                    ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20' 
                                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                                        }`}>
                                            <span className="material-symbols-outlined text-[13px]" style={{fontVariationSettings: '"FILL" 1'}}>workspace_premium</span>
                                            <span>{(subscription.plan || 'free').toUpperCase()}</span>
                                        </a>

                                        {subscription.plan !== 'free' && (
                                            <div className="text-[10px] sm:text-[11px] font-semibold flex items-center gap-1 bg-slate-50 dark:bg-slate-800/40 px-2.5 py-1 rounded-full border border-slate-200/50 dark:border-slate-700/50 text-slate-500 dark:text-slate-400">
                                                <span className={`material-symbols-outlined text-[12px] ${isSubscriptionActive() ? 'text-primary animate-pulse' : 'text-rose-500'}`}>
                                                    {isSubscriptionActive() ? 'schedule' : 'error'}
                                                </span>
                                                <span className="hidden sm:inline">{isSubscriptionActive() ? 'Còn: ' : 'Trạng thái: '}</span>
                                                <strong className={isSubscriptionActive() ? 'text-slate-700 dark:text-slate-200' : 'text-rose-600 dark:text-rose-400 font-black'}>
                                                    {getSubscriptionTimeLeft().text}
                                                </strong>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Dark Mode Toggle */}
                                <label className="relative inline-flex items-center cursor-pointer select-none">
                                    <input type="checkbox" checked={theme === 'dark'} onChange={() => setTheme(theme === 'light' ? 'dark' : 'light')} className="sr-only peer" />
                                    <div className="w-14 h-7 bg-gray-200 rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-7 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-primary flex items-center justify-between px-1.5">
                                        <span className="material-symbols-outlined text-[14px] text-amber-500">light_mode</span>
                                        <span className="material-symbols-outlined text-[14px] text-white">dark_mode</span>
                                    </div>
                                </label>
                                
                                {/* Language Switcher */}
                                <div className="hidden sm:flex bg-gray-100 dark:bg-slate-800 rounded-lg p-0.5 border border-gray-200 dark:border-slate-700">
                                    <button onClick={() => setLang('vi')} className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${lang === 'vi' ? 'bg-white dark:bg-slate-600 shadow-sm text-primary' : 'text-gray-500 dark:text-gray-400'}`}>VI</button>
                                    <button onClick={() => setLang('en')} className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${lang === 'en' ? 'bg-white dark:bg-slate-600 shadow-sm text-primary' : 'text-gray-500 dark:text-gray-400'}`}>EN</button>
                                </div>

                                {/* Google Login / Avatar Dropdown */}
                                {googleUser ? (
                                    <div className="relative" ref={dropdownRef}>
                                        <button 
                                            onClick={() => setShowUserDropdown(!showUserDropdown)} 
                                            className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-700 transition-all focus:outline-none"
                                        >
                                            {(googleUser.picture || googleUser.photoURL) ? (
                                                <img src={googleUser.picture || googleUser.photoURL} className="w-6 h-6 rounded-full border border-white dark:border-slate-850 object-cover" alt="Avatar" />
                                            ) : (
                                                <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-primary to-indigo-600 text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0 border border-white dark:border-slate-700">
                                                    {(googleUser.name || googleUser.displayName || googleUser.email || 'U').charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            <span className="text-xs font-bold text-slate-750 dark:text-slate-200 hidden md:block">{googleUser.name || googleUser.displayName || googleUser.email}</span>
                                            <span className="material-symbols-outlined text-[16px] text-slate-400 dark:text-slate-500 transition-transform duration-200" style={{ transform: showUserDropdown ? 'rotate(180deg)' : 'none' }}>
                                                keyboard_arrow_down
                                            </span>
                                        </button>

                                        {showUserDropdown && (
                                            <div className="absolute right-0 mt-2 w-56 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl py-2 z-50 animate-slide-in">
                                                <div className="px-4 py-2 border-b border-slate-150 dark:border-slate-800">
                                                    <p className="text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-widest font-black">Tài khoản</p>
                                                    <p className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate mt-0.5">{googleUser.email}</p>
                                                </div>

                                                {/* Mobile Language Switcher inside menu */}
                                                <div className="sm:hidden flex items-center justify-between px-4 py-2 border-b border-slate-100 dark:border-slate-800">
                                                    <span className="text-xs font-semibold text-slate-500">Ngôn ngữ</span>
                                                    <div className="flex bg-gray-100 dark:bg-slate-800 rounded-lg p-0.5 border border-gray-200 dark:border-slate-700">
                                                        <button onClick={() => setLang('vi')} className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${lang === 'vi' ? 'bg-white dark:bg-slate-600 shadow-sm text-primary' : 'text-gray-500 dark:text-gray-400'}`}>VI</button>
                                                        <button onClick={() => setLang('en')} className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${lang === 'en' ? 'bg-white dark:bg-slate-600 shadow-sm text-primary' : 'text-gray-500 dark:text-gray-400'}`}>EN</button>
                                                    </div>
                                                </div>

                                                <a 
                                                    href="/pricing"
                                                    onClick={() => setShowUserDropdown(false)}
                                                    className="w-full flex items-center gap-2 px-4 py-3 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-left font-bold transition-all"
                                                >
                                                    <span className="material-symbols-outlined text-base text-slate-400">settings</span>
                                                    Cài đặt tài khoản
                                                </a>

                                                {userRole === 'admin' && (
                                                    <a 
                                                        href="/admin" 
                                                        className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20 text-left font-bold transition-all border-t border-slate-100 dark:border-slate-800"
                                                    >
                                                        <span className="material-symbols-outlined text-base text-blue-500">shield</span>
                                                        Trang quản trị (Admin)
                                                    </a>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={async () => {
                                                        setShowUserDropdown(false);
                                                        try {
                                                            const { filename, kb } = await downloadExtensionZip('3.8');
                                                            showToast(`Đã tải ${filename} (${kb} KB)! Hãy gỡ bản cũ trong chrome://extensions rồi nạp thư mục fb-tool-ext-v3.8.`, 'success');
                                                        } catch (e) {
                                                            showToast(e?.message || 'Lỗi tải Extension v3.8', 'error');
                                                        }
                                                    }}
                                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-primary hover:bg-primary/5 text-left font-bold transition-all"
                                                >
                                                    <span className="material-symbols-outlined text-base text-primary">extension</span>
                                                    Tải Extension v3.8 (.zip)
                                                </button>

                                                <button 
                                                    onClick={() => { onGoogleLogout(); setShowUserDropdown(false); }} 
                                                    className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50/50 dark:hover:bg-rose-950/20 text-left font-bold transition-all border-t border-slate-100 dark:border-slate-800"
                                                >
                                                    <span className="material-symbols-outlined text-base text-rose-500">logout</span>
                                                    Đăng xuất
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <button onClick={onGoogleLogin} className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors px-2">
                                        <span className="material-symbols-outlined text-xl">account_circle</span>
                                        <span className="text-xs font-bold hidden md:block">{t('sub_login_google')}</span>
                                    </button>
                                )}

                            </div>
                        </div>
                    </div>
                </header>
            );
        }


        function ContentEditor({ content, onContentChange, onFormatContent, images, onImagesChange, onTestAI, spinEnabled, setSpinEnabled, isRewriting, t, fbUser, groups = [], selectedGroups = new Set(), groupVariations = {}, onRegenerateVariations, onRegenerateSingleGroup, isGeneratingVariations = false, writingStyle = 'auto', setWritingStyle, selectedPage, setSelectedPage, fbPages = [] }) {
            const { showToast } = useContext(AppContext);
            const fileInputRef = useRef(null);
            const [showPreview, setShowPreview] = useState(false);
            const [expandedPreviews, setExpandedPreviews] = useState({});

            const handlePaste = (e) => {
                const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
                if (!items) return;
                
                let imagePasted = false;
                for (let i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf('image') !== -1) {
                        const file = items[i].getAsFile();
                        if (file) {
                            imagePasted = true;
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                                onImagesChange(prev => [
                                    ...prev,
                                    {
                                        id: Date.now() + '_' + Math.random().toString(36).substring(2, 9),
                                        data: ev.target.result
                                    }
                                ]);
                                showToast('📸 Đã dán ảnh thành công!', 'success');
                            };
                            reader.readAsDataURL(file);
                        }
                    }
                }
                
                if (imagePasted) {
                    e.preventDefault();
                }
            };

            // Reusable helper to determine poster name, avatar, and background style for Facebook previews
            const getPosterInfo = () => {
                if (selectedPage) {
                    return {
                        name: selectedPage.name,
                        avatar: selectedPage.image || selectedPage.picture,
                        initial: selectedPage.name ? selectedPage.name.charAt(0).toUpperCase() : 'P',
                        isPage: true
                    };
                }
                return {
                    name: fbUser?.userName || 'Facebook User',
                    avatar: fbUser?.userAvatar,
                    initial: fbUser?.userName ? fbUser.userName.charAt(0).toUpperCase() : 'F',
                    isPage: false
                };
            };

            // Realistic Facebook Image Layout Grid helper
            const renderFacebookImages = (imagesList) => {
                if (!imagesList || imagesList.length === 0) return null;
                const count = imagesList.length;

                if (count === 1) {
                    return (
                        <div className="px-3 pb-2">
                            <div className="rounded-lg overflow-hidden border border-gray-100 dark:border-slate-800/50 aspect-video">
                                <img src={imagesList[0].data} className="w-full h-full object-cover" />
                            </div>
                        </div>
                    );
                }

                if (count === 2) {
                    return (
                        <div className="grid grid-cols-2 gap-0.5 px-3 pb-2">
                            {imagesList.slice(0, 2).map((img, idx) => (
                                <div key={img.id} className="aspect-square overflow-hidden rounded-sm">
                                    <img src={img.data} className="w-full h-full object-cover" />
                                </div>
                            ))}
                        </div>
                    );
                }

                if (count === 3) {
                    return (
                        <div className="grid grid-cols-12 gap-0.5 px-3 pb-2">
                            <div className="col-span-8 aspect-square rounded-l-sm overflow-hidden">
                                <img src={imagesList[0].data} className="w-full h-full object-cover" />
                            </div>
                            <div className="col-span-4 grid grid-rows-2 gap-0.5">
                                {imagesList.slice(1, 3).map(img => (
                                    <div key={img.id} className="aspect-square overflow-hidden rounded-r-sm">
                                        <img src={img.data} className="w-full h-full object-cover" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                }

                // 4 or more images -> 2x2 grid
                return (
                    <div className="grid grid-cols-2 gap-0.5 px-3 pb-2">
                        {imagesList.slice(0, 4).map((img, idx) => (
                            <div key={img.id} className="relative aspect-square overflow-hidden rounded-sm">
                                <img src={img.data} className="w-full h-full object-cover" />
                                {idx === 3 && count > 4 && (
                                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-[13px] font-bold">
                                        +{count - 3}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                );
            };

            return (
                <div onPaste={handlePaste} className="bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 overflow-hidden group hover:shadow-soft transition-shadow duration-300">
                    <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-border-light flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 bg-gray-50/30 dark:bg-slate-800/50">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="p-1.5 bg-blue-50 dark:bg-blue-900/30 rounded-md text-primary flex-shrink-0">
                                <span className="material-symbols-outlined text-[20px]">edit_note</span>
                            </div>
                            <div className="min-w-0">
                                <h2 className="font-semibold text-base text-text-main dark:text-white leading-tight truncate">{t('editor_title')}</h2>
                                <p className="text-xs text-text-secondary mt-0.5 truncate">Nội dung bài viết chính</p>
                            </div>
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-2 flex-shrink-0">
                            <button
                                onClick={() => setShowPreview(!showPreview)}
                                className={`flex items-center justify-center gap-1.5 px-3.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${showPreview ? 'bg-primary text-white shadow-sm' : 'bg-gray-100 dark:bg-slate-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-slate-600'}`}
                            >
                                <span className="material-symbols-outlined text-[16px]">{showPreview ? 'visibility_off' : 'visibility'}</span>
                                {showPreview ? 'Ẩn xem trước' : 'Xem trước'}
                            </button>
                            <span className="text-xs font-mono font-medium text-text-secondary bg-gray-100 dark:bg-slate-700 px-2.5 py-1.5 sm:py-1 rounded-md border border-gray-200 dark:border-slate-600 whitespace-nowrap tabular-nums">{content.length} chars</span>
                        </div>
                    </div>
                    <div className="p-4 sm:p-6">
                        {/* Selector: Post identity (Cá nhân / Page) */}
                        {fbUser && (
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 p-3 bg-blue-50/20 dark:bg-slate-900/30 rounded-2xl border border-blue-100/50 dark:border-slate-700/50 text-xs">
                                <div className="flex items-center gap-2 text-text-secondary font-semibold">
                                    <span className="material-symbols-outlined text-[16px] text-primary">account_circle</span>
                                    <span>Đăng với tư cách:</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {/* Personal Profile Option */}
                                    <button
                                        onClick={() => setSelectedPage(null)}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-[11px] font-semibold transition-all ${!selectedPage ? 'bg-primary/10 text-primary border-primary/20 shadow-sm' : 'bg-white dark:bg-slate-900 text-text-secondary border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                                    >
                                        {fbUser.userAvatar ? (
                                            <div className="w-5 h-5 rounded-full overflow-hidden bg-blue-500 bg-cover bg-center flex-shrink-0" style={{ backgroundImage: `url(${fbUser.userAvatar})` }} />
                                        ) : (
                                            <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                                                {(fbUser.userName || fbUser.name || 'F').charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <span>{fbUser.userName || fbUser.name || 'Facebook User'} (Cá nhân)</span>
                                    </button>

                                    {/* Pages Dropdown */}
                                    {fbPages.length > 0 && (
                                        <div className="relative flex items-center">
                                            <select
                                                value={selectedPage ? selectedPage.id : ''}
                                                onChange={(e) => {
                                                    const pageId = e.target.value;
                                                    if (!pageId) {
                                                        setSelectedPage(null);
                                                    } else {
                                                        const page = fbPages.find(p => p.id === pageId);
                                                        setSelectedPage(page);
                                                    }
                                                }}
                                                className={`pl-8 pr-4 py-1.5 rounded-xl border text-[11px] font-semibold transition-all outline-none bg-white dark:bg-slate-900 text-text-secondary border-gray-200 dark:border-slate-700 cursor-pointer appearance-none ${selectedPage ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}
                                            >
                                                <option value="">-- Chọn Trang/Page để đăng --</option>
                                                {fbPages.map(p => (
                                                    <option key={p.id} value={p.id}>{p.name}</option>
                                                ))}
                                            </select>
                                            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-purple-500 pointer-events-none">flag</span>
                                            <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[14px] text-text-tertiary pointer-events-none">arrow_drop_down</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 p-1.5 bg-gray-50 dark:bg-slate-900/50 rounded-xl border border-border-light mb-3 shadow-sm">
                            <div className="flex flex-wrap items-center gap-1">
                                {['format_bold', 'format_italic', 'link', 'sentiment_satisfied', 'format_list_bulleted'].map((icon, i) => (
                                    <React.Fragment key={icon}>
                                        <button type="button" className="min-w-[38px] min-h-[38px] sm:min-w-0 sm:min-h-0 p-2 sm:p-1.5 flex items-center justify-center hover:bg-white dark:hover:bg-slate-700 hover:shadow-sm rounded-lg text-text-secondary hover:text-primary transition-all">
                                            <span className="material-symbols-outlined text-[19px] sm:text-[18px]">{icon}</span>
                                        </button>
                                        {i === 1 && <div className="w-px h-5 bg-gray-300 dark:bg-slate-700 mx-1 self-center"></div>}
                                    </React.Fragment>
                                ))}
                            </div>
                            {onFormatContent && (
                                <button
                                    type="button"
                                    onClick={onFormatContent}
                                    disabled={!content || !content.trim() || isRewriting}
                                    className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-bold transition-all disabled:opacity-40 whitespace-nowrap"
                                    title="Tự động tách dòng theo emoji, ngăn đoạn rõ ràng & tách cụm hashtag"
                                >
                                    <span className="material-symbols-outlined text-[16px]">auto_fix_high</span>
                                    <span>Tối ưu xuống dòng</span>
                                </button>
                            )}
                        </div>
                        <div className={`relative mb-5 ${isRewriting ? 'ai-rewriting-border' : ''}`}>
                            {isRewriting && (
                                <>
                                    <div className="absolute top-0 left-0 right-0 z-20 rounded-t-2xl overflow-hidden">
                                        <div className="ai-progress-bar"></div>
                                    </div>
                                    <div className="absolute top-3 right-3 z-30 bg-gradient-to-r from-violet-600 to-purple-600 text-white text-[10px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 shadow-md">
                                        <span className="material-symbols-outlined text-[14px] animate-spin">auto_awesome</span>
                                        Magic Write...
                                    </div>
                                </>
                            )}
                            <textarea
                                value={content}
                                onChange={(e) => onContentChange(e.target.value)}
                                className={`w-full min-h-[180px] p-4 text-sm leading-relaxed border-gray-200 dark:border-slate-600 rounded-2xl focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-y text-text-main dark:text-gray-100 placeholder:text-gray-400 bg-white dark:bg-slate-900 shadow-input dark:shadow-none ${isRewriting ? 'ai-textarea-glow' : ''}`}
                                placeholder={t('campaign_desc')}
                                readOnly={isRewriting}
                            />
                        </div>

                        {/* Facebook Post Previews - Dynamic per selected group */}
                        {showPreview && content.trim() && (() => {
                            const selectedGroupsList = groups.filter(g => selectedGroups.has(g.id));
                            const poster = getPosterInfo();
                            
                            if (selectedGroupsList.length === 0) {
                                const defaultGroupName = (groups && groups.length > 0) ? groups[0].name : "Đố Nhựa dùng một lần...";
                                const defaultGroupInitial = defaultGroupName.charAt(0).toUpperCase();

                                return (
                                    <div className="mb-4 fb-preview-card">
                                        <div className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                            <span className="material-symbols-outlined text-[13px]">groups</span>
                                            Xem trước bài đăng trên nhóm đã chọn (0)
                                        </div>
                                        
                                        <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden text-[12px] max-w-sm">
                                            <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-50 dark:border-slate-800">
                                                <div 
                                                    className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-white font-bold text-[11px] bg-cover bg-center shadow-sm" 
                                                    style={{ 
                                                        backgroundImage: poster.avatar ? `url(${poster.avatar})` : undefined,
                                                        backgroundColor: poster.isPage ? '#8b5cf6' : '#3b82f6'
                                                    }}
                                                >
                                                    {!poster.avatar && poster.initial}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1 text-[11px]">
                                                        <span className="font-semibold text-text-main dark:text-white truncate max-w-[120px]" title={poster.name}>{poster.name}</span>
                                                        <span className="text-text-tertiary">➔</span>
                                                        <span className="font-semibold text-primary truncate max-w-[120px] hover:underline cursor-pointer" title={defaultGroupName}>{defaultGroupName}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1 text-[9px] text-text-tertiary">Vừa xong · <span className="material-symbols-outlined text-[9px]">public</span></div>
                                                </div>
                                            </div>
                                            <div className="p-3">
                                                <div className="text-text-main dark:text-gray-200 whitespace-pre-wrap leading-snug" style={{ wordBreak: 'break-word' }}>
                                                    {(content.length > 150 ? content.substring(0, 150) + '... Xem thêm' : content).split('\n').map((line, idx, arr) => (
                                                        <React.Fragment key={idx}>
                                                            {line}
                                                            {idx < arr.length - 1 && <br />}
                                                        </React.Fragment>
                                                    ))}
                                                </div>
                                            </div>
                                            {renderFacebookImages(images)}
                                            <div className="px-3 py-1.5 border-t border-gray-100 dark:border-slate-700 flex justify-around text-text-tertiary bg-gray-50/50 dark:bg-slate-800/20">
                                                {['thumb_up', 'chat_bubble_outline', 'share'].map(icon => (
                                                    <span key={icon} className="material-symbols-outlined text-[14px]">{icon}</span>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                );
                            }

                            const displayLimit = 4;
                            const groupsToShow = selectedGroupsList.slice(0, displayLimit);
                            const remainingCount = selectedGroupsList.length - displayLimit;
                            const aiReadyCount = selectedGroupsList.filter(g => groupVariations[g.id]?.isAiRewritten && groupVariations[g.id]?.sourceContent === content).length;

                            return (
                                <div className="mb-4 fb-preview-card flex flex-col gap-3">
                                    <div className="flex flex-wrap justify-between items-center gap-2 text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="inline-flex items-center gap-1.5">
                                                <span className="material-symbols-outlined text-[14px]">groups</span>
                                                Xem trước nhóm đã chọn ({selectedGroupsList.length})
                                            </span>
                                            {spinEnabled && (
                                                <span className="normal-case tracking-normal text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800/60">
                                                    {aiReadyCount > 0 ? `Đã tạo ${aiReadyCount}/${selectedGroupsList.length} biến thể AI` : 'Tự tạo biến thể AI riêng khi đăng'}
                                                </span>
                                            )}
                                        </div>
                                        {spinEnabled && (
                                            <button 
                                                type="button"
                                                disabled={isGeneratingVariations}
                                                onClick={onRegenerateVariations}
                                                className="inline-flex items-center gap-1.5 text-[11px] normal-case tracking-normal text-white font-bold px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 rounded-lg shadow-sm transition-all active:scale-95"
                                                title="Dùng Gemini AI tạo ngay các biến thể nội dung khác biệt hoàn toàn cho từng nhóm"
                                            >
                                                <span className={`material-symbols-outlined text-[14px] ${isGeneratingVariations ? 'animate-spin' : ''}`}>
                                                    {isGeneratingVariations ? 'progress_activity' : 'auto_awesome'}
                                                </span>
                                                {isGeneratingVariations ? 'Đang tạo biến thể AI...' : 'Tạo biến thể AI chống spam'}
                                            </button>
                                        )}
                                    </div>
                                    
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {groupsToShow.map((g, idx) => {
                                            const variation = groupVariations[g.id] || { content, images, isRewriting: false, isAiRewritten: false, angleLabel: '' };
                                            const isExpanded = Boolean(expandedPreviews[g.id]);
                                            const displayText = isExpanded || variation.content.length <= 280
                                                ? variation.content
                                                : variation.content.substring(0, 280) + '...';
                                            return (
                                                <div key={g.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 shadow-sm overflow-hidden text-[12px] transition-all hover:border-primary/40 flex flex-col justify-between relative min-h-[210px]">
                                                    {variation.isRewriting && (
                                                        <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-[1.5px] z-10 flex flex-col items-center justify-center p-4 text-center">
                                                            <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-purple-600 mb-2 animate-bounce">
                                                                <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                                                            </div>
                                                            <div className="text-[11px] font-bold text-purple-600 dark:text-purple-400 animate-pulse">Gemini đang viết biến thể #{idx + 1}...</div>
                                                            <div className="w-20 h-1 bg-gray-100 dark:bg-slate-800 rounded-full mt-2 overflow-hidden">
                                                                <div className="h-full bg-purple-600 animate-pulse rounded-full" style={{ width: '75%' }}></div>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-100 dark:border-slate-800">
                                                            <div 
                                                                className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center text-white font-bold text-[11px] bg-cover bg-center shadow-sm" 
                                                                style={{ 
                                                                    backgroundImage: poster.avatar ? `url(${poster.avatar})` : undefined,
                                                                    backgroundColor: poster.isPage ? '#8b5cf6' : '#3b82f6'
                                                                }}
                                                            >
                                                                {!poster.avatar && poster.initial}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-center gap-1 text-[11px]">
                                                                    <span className="font-semibold text-text-main dark:text-white truncate max-w-[90px]" title={poster.name}>{poster.name}</span>
                                                                    <span className="text-text-tertiary">➔</span>
                                                                    <span className="font-semibold text-primary truncate flex-1 hover:underline cursor-pointer" title={g.name}>{g.name}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 text-[10px] text-text-tertiary mt-0.5">
                                                                    {variation.isAiRewritten ? (
                                                                        <span className="inline-flex items-center gap-1 text-purple-600 dark:text-purple-400 font-semibold truncate">
                                                                            <span className="material-symbols-outlined text-[12px]">verified</span>
                                                                            AI · {variation.angleLabel || `Biến thể #${idx + 1}`}
                                                                        </span>
                                                                    ) : (
                                                                        <span>{spinEnabled ? 'Sẽ tự động viết AI khi đăng' : 'Nội dung gốc'}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {spinEnabled && onRegenerateSingleGroup && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => onRegenerateSingleGroup(g.id)}
                                                                    disabled={variation.isRewriting}
                                                                    className="p-1.5 rounded-lg text-text-secondary hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-900/30 transition-colors flex-shrink-0"
                                                                    title="Viết lại biến thể AI khác cho riêng nhóm này"
                                                                >
                                                                    <span className="material-symbols-outlined text-[15px]">refresh</span>
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div className="p-3">
                                                            <div className="text-text-main dark:text-gray-200 whitespace-pre-wrap leading-relaxed text-[12px]" style={{ wordBreak: 'break-word' }}>
                                                                {displayText}
                                                            </div>
                                                            {variation.content.length > 280 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setExpandedPreviews(prev => ({ ...prev, [g.id]: !prev[g.id] }))}
                                                                    className="mt-1.5 text-[11px] font-semibold text-primary hover:underline"
                                                                >
                                                                    {isExpanded ? 'Thu gọn' : 'Xem đầy đủ'}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        {renderFacebookImages(variation.images)}
                                                        <div className="px-3 py-1.5 border-t border-gray-100 dark:border-slate-700 flex justify-around text-text-tertiary bg-gray-50/50 dark:bg-slate-800/20">
                                                            {['thumb_up', 'chat_bubble_outline', 'share'].map(icon => (
                                                                <span key={icon} className="material-symbols-outlined text-[14px]">{icon}</span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {remainingCount > 0 && (
                                        <div className="bg-blue-50/40 dark:bg-slate-900 border border-dashed border-blue-200 dark:border-slate-800 rounded-xl p-2.5 text-center text-xs text-text-secondary font-medium mt-1">
                                            ✨ Và thêm <span className="text-primary font-bold">{remainingCount} nhóm khác</span> đã chọn — mỗi nhóm sẽ tự động nhận 1 biến thể AI riêng biệt khi đăng
                                        </div>
                                    )}
                                </div>
                            );
                        })()}

                        <div className="mb-6">
                            <label className="block text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">{t('image_label')}</label>
                            <div
                                className="group/upload border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-3xl p-6 flex flex-col items-center justify-center text-center hover:bg-blue-50/30 dark:hover:bg-slate-800/30 hover:border-primary/40 transition-all cursor-pointer bg-gray-50/50 dark:bg-slate-900/30"
                                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                            >
                                <div className="bg-white dark:bg-slate-800 p-3 rounded-full shadow-sm mb-3 group-hover/upload:scale-110 transition-transform duration-300">
                                    <span className="material-symbols-outlined text-2xl text-primary/80">add_photo_alternate</span>
                                </div>
                                <p className="text-sm text-text-main dark:text-gray-200 font-medium">{t('drag_drop')}</p>
                                <p className="text-xs text-text-tertiary mt-1">SVG, PNG, JPG or GIF (max. 800x400px)</p>
                                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
                                    const files = Array.from(e.target.files || []);
                                    files.forEach(f => {
                                        const r = new FileReader();
                                        r.onload = (ev) => onImagesChange(p => [...p, { id: Date.now() + '_' + Math.random().toString(36).substring(2, 9), data: ev.target.result }]);
                                        r.readAsDataURL(f);
                                    });
                                    e.target.value = '';
                                }} />
                            </div>
                            {images.length > 0 && (
                                <div className="flex gap-4 mt-4 overflow-x-auto pb-3 pt-3 px-1">
                                    {images.map(img => (
                                        <div key={img.id} className="relative w-24 h-24 flex-shrink-0 group">
                                            <div className="w-full h-full rounded-xl overflow-hidden shadow-md border-2 border-gray-200 dark:border-slate-600 group-hover:border-primary transition-all">
                                                <img src={img.data} className="w-full h-full object-cover" />
                                            </div>
                                            <button
                                                onClick={() => onImagesChange(p => p.filter(i => i.id !== img.id))}
                                                className="absolute -top-2 -right-2 w-6 h-6 bg-white dark:bg-slate-700 text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all hover:bg-red-500 hover:text-white shadow-md border border-gray-200 dark:border-slate-600 z-10"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">close</span>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex flex-col gap-3 pt-5 border-t border-border-light">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <button
                                        type="button"
                                        onClick={onTestAI}
                                        disabled={isRewriting}
                                        className={`flex items-center gap-2 px-4 py-2.5 text-white text-xs font-bold rounded-xl shadow-md transition-all ${isRewriting ? 'bg-gradient-to-r from-violet-600 to-purple-600 cursor-not-allowed' : 'bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 hover:shadow-lg active:scale-95'}`}
                                    >
                                        {isRewriting ? (
                                            <>
                                                <span className="material-symbols-outlined text-[16px] animate-spin">auto_awesome</span>
                                                Đang tối ưu AI...
                                            </>
                                        ) : (
                                            <>
                                                <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                                                Tối ưu chuyên nghiệp (AI)
                                            </>
                                        )}
                                    </button>
                                    {setWritingStyle && (
                                        <select
                                            value={writingStyle}
                                            onChange={e => setWritingStyle(e.target.value)}
                                            aria-label="Phong cách viết AI"
                                            className="px-3 py-2.5 bg-gray-50 dark:bg-slate-900 border border-border-light dark:border-slate-700 rounded-xl text-xs font-semibold text-text-main dark:text-gray-200 outline-none focus:border-purple-500 cursor-pointer"
                                        >
                                            <option value="auto">Đa dạng chống spam (8 góc)</option>
                                            <option value="professional">Chuyên nghiệp &amp; Cao cấp</option>
                                            <option value="friendly">Thân thiện cộng đồng</option>
                                            <option value="promo">Chốt đơn &amp; Ưu đãi</option>
                                            <option value="concise">Ngắn gọn súc tích</option>
                                        </select>
                                    )}
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={spinEnabled}
                                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${spinEnabled ? 'bg-primary' : 'bg-gray-200 dark:bg-slate-600'}`}
                                        onClick={() => setSpinEnabled(!spinEnabled)}
                                    >
                                        <span
                                            aria-hidden="true"
                                            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${spinEnabled ? 'translate-x-5' : 'translate-x-0'}`}
                                        ></span>
                                    </button>
                                    <div className="text-sm">
                                        <span className="font-semibold text-text-main dark:text-gray-200 select-none block leading-tight">{t('spin_content')}</span>
                                        <p className="text-[11px] text-text-secondary mt-0.5">{t('spin_desc')}</p>
                                    </div>
                                </div>
                            </div>
                            {spinEnabled && (
                                <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-purple-50/70 dark:bg-purple-900/20 border border-purple-200/70 dark:border-purple-800/40 text-xs text-purple-900 dark:text-purple-200">
                                    <span className="material-symbols-outlined text-[16px] text-purple-600 dark:text-purple-400 mt-0.5 flex-shrink-0">verified_user</span>
                                    <span>
                                        <strong>Bảo vệ chống spam đang bật:</strong> Khi đăng nhiều nhóm, Gemini AI sẽ tự động viết <strong>mỗi nhóm 1 bài hoàn toàn khác biệt</strong> (đổi câu mở đầu, góc tiếp cận, cấu trúc &amp; xáo trộn ảnh) nhưng vẫn giữ nguyên 100% giá bán, địa chỉ và Hotline/Zalo.
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            );
        }





        // GroupsPanel - Simple groups list for Post page
        function GroupsPanel({ fbUser, selectedPage = null, groups, selectedGroups, onToggleGroup, setSelectedGroups, onScan, onStopScan, onStartPost, onStopPost, isPosting, extensionStatus, onLoadDemoGroups, t, showToast, isScanningGroups, collections, setCollections }) {
            const [searchTerm, setSearchTerm] = useState('');
            
            const [isCreatingCollection, setIsCreatingCollection] = useState(false);
            const [newCollectionName, setNewCollectionName] = useState('');
            const [deleteConfirmTarget, setDeleteConfirmTarget] = useState(null); // null or { id, name }

            // Save currently selected groups as a collection
            const handleSaveCollection = () => {
                if (selectedGroups.size === 0) {
                    showToast('Vui lòng chọn ít nhất 1 nhóm để tạo bộ sưu tập!', 'error');
                    return;
                }
                if (!newCollectionName.trim()) {
                    showToast('Vui lòng nhập tên bộ sưu tập!', 'error');
                    return;
                }
                
                const newCol = {
                    id: Date.now() + '_' + Math.random().toString(36).substring(2, 9),
                    name: newCollectionName.trim(),
                    groupIds: Array.from(selectedGroups)
                };

                const updated = [...collections, newCol];
                setCollections(updated);
                setNewCollectionName('');
                setIsCreatingCollection(false);
                showToast(`⭐ Đã lưu bộ sưu tập "${newCol.name}"!`, 'success');
            };

            // Apply collection selection
            const handleApplyCollection = (col) => {
                const targetKeys = new Set((col.groupIds || []).map(id => String(id)));
                const validGroupIds = groups
                    .filter(g => targetKeys.has(String(g.id)))
                    .map(g => g.id);
                if (validGroupIds.length === 0) {
                    showToast('Không có nhóm nào trong bộ sưu tập này tồn tại trong danh sách!', 'error');
                    return;
                }
                
                setSelectedGroups(new Set(validGroupIds));
                showToast(`⭐ Đã chọn ${validGroupIds.length} nhóm từ bộ sưu tập "${col.name}"!`, 'success');
            };

            // Delete collection
            const handleDeleteCollection = (e, colId, colName) => {
                e.stopPropagation();
                setDeleteConfirmTarget({ id: colId, name: colName });
            };
            
            // Hàm bỏ dấu tiếng Việt để tìm kiếm
            const removeAccents = (str) => {
                return str ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
            };
            
            const filteredGroups = groups.filter(g => 
                removeAccents(g.name.toLowerCase()).includes(removeAccents(searchTerm.toLowerCase()))
            );

            const isAllFilteredSelected = filteredGroups.length > 0 && filteredGroups.every(g => selectedGroups.has(g.id));

            const handleToggleAll = () => {
                const newSet = new Set(selectedGroups);
                if (isAllFilteredSelected) {
                    filteredGroups.forEach(g => newSet.delete(g.id));
                } else {
                    filteredGroups.forEach(g => newSet.add(g.id));
                }
                setSelectedGroups(newSet);
            };

            return (
                <div className="bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 flex flex-col h-[500px] sm:h-[560px] lg:h-[calc(100vh-6.5rem)] lg:max-h-[760px] lg:min-h-[500px] overflow-hidden">
                    <div className="p-4 border-b border-border-light bg-gray-50/30 dark:bg-slate-800/50">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-primary"><path d="M16.67 13.13C18.04 14.06 19 15.32 19 17v3h4v-3c0-2.18-3.57-3.47-6.33-3.87zM15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4c-.47 0-.91.1-1.33.24C14.5 5.27 15 6.58 15 8c0 1.42-.5 2.73-1.33 3.76.42.15.86.24 1.33.24zm-6 0c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                                <h2 className="font-semibold text-text-main dark:text-white">{t('groups_title')}</h2>
                            </div>
                            <span className="bg-gray-100 dark:bg-slate-700 text-text-secondary text-xs font-bold px-2 py-1 rounded-md">{groups.length}</span>
                        </div>
                        {isScanningGroups ? (
                            <button 
                                onClick={onStopScan} 
                                className="w-full font-semibold py-2.5 px-4 rounded-xl shadow-lg bg-rose-500 hover:bg-rose-600 text-white transition-all flex justify-center items-center gap-2 active:scale-95 animate-pulse"
                            >
                                <span className="material-symbols-outlined text-[18px] animate-spin">sync</span>
                                <span>Dừng quét nhóm</span>
                            </button>
                        ) : (
                            <button 
                                onClick={onScan} 
                                className="w-full font-semibold py-2.5 px-4 rounded-xl shadow-lg bg-primary hover:bg-primary-hover text-white transition-all flex justify-center items-center gap-2 active:scale-95"
                            >
                                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                                </svg>
                                <span>
                                    {!fbUser
                                        ? 'Kết nối Facebook'
                                        : selectedPage
                                            ? `Quét nhóm của Trang`
                                            : t('scan_groups')}
                                </span>
                            </button>
                        )}
                        {selectedPage && (
                            <p className="mt-2 text-[11px] text-purple-700 dark:text-purple-300 bg-purple-50/70 dark:bg-purple-900/20 border border-purple-200/60 dark:border-purple-800/40 rounded-lg px-2.5 py-1.5 leading-snug">
                                Đang chọn Trang <strong>{selectedPage.name}</strong>. Hãy chuyển sang tư cách Trang này trên tab Facebook trước khi bấm quét để lấy đúng các nhóm Trang đã tham gia.
                            </p>
                        )}
                        
                        {groups.length > 0 && (
                            <div className="mt-3 relative">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">search</span>
                                <input 
                                    type="text" 
                                    placeholder="Tìm kiếm nhóm..." 
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl py-2 pl-9 pr-4 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-text-main dark:text-gray-200 placeholder:text-gray-400 outline-none"
                                />
                            </div>
                        )}

                        {/* Favorite Collections Section */}
                        {groups.length > 0 && (
                            <div className="mt-3 border-t border-gray-100 dark:border-slate-700/50 pt-3">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[12px] text-amber-500">star</span>
                                        Bộ sưu tập nhóm ({collections.length})
                                    </span>
                                    
                                    {!isCreatingCollection && (
                                        <button 
                                            onClick={() => {
                                                if (selectedGroups.size === 0) {
                                                    showToast('Vui lòng tích chọn các nhóm ở dưới trước khi bấm lưu!', 'info');
                                                    return;
                                                }
                                                setIsCreatingCollection(true);
                                            }}
                                            className="text-[10px] font-bold text-primary hover:underline flex items-center gap-0.5"
                                        >
                                            <span className="material-symbols-outlined text-[10px]">add</span>
                                            Lưu nhóm đã chọn
                                        </button>
                                    )}
                                </div>

                                {isCreatingCollection && (
                                    <div className="flex items-center gap-1.5 mb-2 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-xl p-1.5">
                                        <input 
                                            type="text"
                                            placeholder="Tên bộ sưu tập..."
                                            value={newCollectionName}
                                            onChange={(e) => setNewCollectionName(e.target.value)}
                                            className="flex-1 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-2.5 py-1 text-[11px] outline-none focus:border-primary text-text-main dark:text-gray-200"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveCollection();
                                                if (e.key === 'Escape') setIsCreatingCollection(false);
                                            }}
                                        />
                                        <button 
                                            onClick={handleSaveCollection}
                                            className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg shadow-sm"
                                        >
                                            Lưu
                                        </button>
                                        <button 
                                            onClick={() => setIsCreatingCollection(false)}
                                            className="bg-gray-100 dark:bg-slate-700 text-text-secondary hover:bg-gray-200 text-[10px] font-bold px-2 py-1 rounded-lg"
                                        >
                                            Hủy
                                        </button>
                                    </div>
                                )}

                                <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar scrollbar-thin">
                                    {collections.length === 0 ? (
                                        <div className="text-[10px] text-text-tertiary italic py-1">
                                            Chưa có bộ sưu tập nào. Tích chọn nhóm bên dưới rồi bấm "Lưu nhóm đã chọn" để tạo!
                                        </div>
                                    ) : (
                                        collections.map(col => (
                                            <div 
                                                key={col.id}
                                                onClick={() => handleApplyCollection(col)}
                                                className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-amber-50/70 to-orange-50/70 dark:from-slate-800/80 dark:to-slate-800/80 hover:from-amber-100/70 hover:to-orange-100/70 dark:hover:from-slate-700/80 dark:hover:to-slate-700/80 border border-amber-200/50 dark:border-slate-700 rounded-full cursor-pointer text-[11px] font-semibold text-amber-800 dark:text-amber-400 hover:text-amber-900 transition-all shadow-sm flex-shrink-0 group/pill"
                                            >
                                                <span>⭐ {col.name} ({col.groupIds.length})</span>
                                                <button
                                                    onClick={(e) => handleDeleteCollection(e, col.id, col.name)}
                                                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-text-tertiary hover:bg-red-500 hover:text-white transition-colors"
                                                    title="Xóa bộ sưu tập này"
                                                >
                                                    <span className="material-symbols-outlined text-[10px]">close</span>
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {groups.length > 0 && (
                        <div className="px-4 py-2 flex justify-between items-center border-b border-border-light bg-gray-50/50 dark:bg-slate-800/30">
                            <label className="flex items-center gap-2 cursor-pointer group">
                                <input 
                                    type="checkbox" 
                                    checked={isAllFilteredSelected}
                                    onChange={handleToggleAll}
                                    className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
                                />
                                <span className="text-xs font-bold text-text-secondary group-hover:text-primary transition-colors">
                                    {isAllFilteredSelected ? 'Bỏ chọn các nhóm tìm được' : 'Chọn tất cả nhóm này'}
                                </span>
                            </label>
                            <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                                {selectedGroups.size} đã chọn
                            </span>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar bg-white dark:bg-slate-900">
                        {filteredGroups.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                                <span className="material-symbols-outlined text-4xl mb-2 opacity-50">search_off</span>
                                <p className="text-sm">Không tìm thấy nhóm nào</p>
                            </div>
                        ) : (
                            filteredGroups.map(g => (
                                <div key={g.id} onClick={() => onToggleGroup(g.id)} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${selectedGroups.has(g.id) ? 'bg-blue-50/60 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800' : 'border-transparent hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                                    <input type="checkbox" checked={selectedGroups.has(g.id)} onChange={() => { }} className="w-4 h-4 text-primary pointer-events-none" />
                                    <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-slate-700 flex items-center justify-center text-xs font-bold text-gray-500 flex-shrink-0 bg-cover bg-center" style={{ backgroundImage: g.image ? `url(${g.image})` : undefined }}>
                                        {!g.image && (g.name || 'GR').substring(0, 2).toUpperCase()}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-medium text-text-main dark:text-gray-200 truncate">{g.name}</h4>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="p-4 border-t border-border-light bg-gray-50/80 dark:bg-slate-800/80 space-y-3">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-text-secondary">{t('selected')}</span>
                            <span className="font-bold text-primary">{selectedGroups.size} groups</span>
                        </div>
                        {isPosting ? (
                            <button
                                onClick={onStopPost}
                                className="w-full font-semibold py-3 px-4 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white active:scale-95"
                            >
                                <span className="material-symbols-outlined text-[18px]">stop_circle</span>
                                <span>{t('stop')}</span>
                            </button>
                        ) : (
                            <button 
                                onClick={groups.length === 0 || isScanningGroups ? () => showToast(isScanningGroups ? 'Vui lòng chờ quét xong danh sách nhóm' : 'Vui lòng Quét nhóm trước khi thực hiện chức năng này', 'error') : onStartPost} 
                                className={`w-full font-semibold py-3 px-4 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 ${groups.length === 0 || isScanningGroups ? 'bg-gray-400 text-white cursor-not-allowed opacity-70' : 'bg-primary hover:bg-primary-hover text-white'}`}
                            >
                                <span>{t('start_post')}</span>
                                <span className="material-symbols-outlined text-[18px]">send</span>
                            </button>
                        )}
                    </div>

                    {/* Modern Custom Delete Confirmation Modal */}
                    {deleteConfirmTarget && (
                        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
                            <div className="bg-white dark:bg-slate-800 rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-gray-100 dark:border-slate-700/50 transform scale-100 transition-all duration-300">
                                <div className="flex flex-col items-center text-center">
                                    <div className="bg-red-50 dark:bg-red-950/30 text-red-500 rounded-full w-12 h-12 flex items-center justify-center mb-4 shadow-sm">
                                        <span className="material-symbols-outlined text-[24px]">delete_forever</span>
                                    </div>
                                    
                                    <h3 className="font-bold text-lg text-text-main dark:text-white mb-2">Xóa bộ sưu tập?</h3>
                                    
                                    <p className="text-sm text-text-secondary dark:text-gray-300 mb-6 leading-relaxed">
                                        Bạn có chắc chắn muốn xóa bộ sưu tập <span className="font-bold text-red-500">"{deleteConfirmTarget.name}"</span>?
                                        <br />
                                        Hành động này không thể khôi phục lại.
                                    </p>
                                    
                                    <div className="flex gap-3 w-full">
                                        <button 
                                            onClick={() => setDeleteConfirmTarget(null)}
                                            className="flex-1 py-2.5 px-4 bg-gray-100 dark:bg-slate-700 text-text-secondary hover:bg-gray-200 dark:hover:bg-slate-600 rounded-xl font-semibold text-xs transition-all outline-none"
                                        >
                                            Hủy bỏ
                                        </button>
                                        <button 
                                            onClick={() => {
                                                const updated = collections.filter(c => c.id !== deleteConfirmTarget.id);
                                                setCollections(updated);
                                                showToast(`Đã xóa bộ sưu tập "${deleteConfirmTarget.name}"`, 'info');
                                                setDeleteConfirmTarget(null);
                                            }}
                                            className="flex-1 py-2.5 px-4 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold text-xs shadow-lg shadow-red-500/20 hover:shadow-red-500/30 transition-all active:scale-95 outline-none"
                                        >
                                            Đồng ý xóa
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

        // SharePage - Full page for sharing posts from Facebook Pages
        function SharePage({
            fbUser, t, fbPages, selectedPage, setSelectedPage, pageUrl, setPageUrl,
            pagePosts, selectedPosts, onTogglePost, onToggleAllPosts,
            groups, selectedGroups, onToggleGroup, onToggleAll,
            onFetchPages, onGetCurrentPage, onAddManualPost, onScan, onStopScan,
            onScanPagePosts, onSharePosts, onStopShare,
            shareCaption, setShareCaption, spinEnabled,
            isFetchingPages, isScanning, isSharing,
            installedExtVersion, requiredExtVersion, duplicateExtCount,
            shareCountdown, shareDelayMin, setShareDelayMin, shareDelayMax, setShareDelayMax,
            logs, progress, showToast, isScanningGroups,
            successItems, isCheckingStatus, checkProgress, onCheckAllStatus, onCheckSingleStatus, onStopCheckStatus, onClearSuccessItems,
            collections = [], onSaveLiveGroupsCollection
        }) {
            const [manualPostUrl, setManualPostUrl] = useState('');
            const [pageSearch, setPageSearch] = useState('');

            const filteredPages = fbPages.filter(p =>
                !pageSearch.trim() || String(p.name || '').toLowerCase().includes(pageSearch.trim().toLowerCase())
            );

            const handleManualSubmit = () => {
                if (onAddManualPost && onAddManualPost(manualPostUrl)) {
                    setManualPostUrl('');
                }
            };

            const isOutdatedExt = Boolean(installedExtVersion && requiredExtVersion && installedExtVersion !== requiredExtVersion);
            const hasDuplicateExt = duplicateExtCount > 1;

            return (
                <>
                    <div className="mb-6 sm:mb-8">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-main dark:text-white mb-1.5">{t('nav_share')}</h1>
                        <p className="text-text-secondary text-sm">{t('nav_share_desc')}</p>
                    </div>

                    {(isOutdatedExt || hasDuplicateExt) && (
                        <div className="mb-5 p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start gap-2.5 text-xs sm:text-sm text-rose-700 dark:text-rose-300">
                                <span className="material-symbols-outlined text-[20px] shrink-0 mt-0.5">warning</span>
                                <div>
                                    {hasDuplicateExt ? (
                                        <p className="font-bold">Phát hiện {duplicateExtCount} bản Extension đang cùng bật trong Chrome!</p>
                                    ) : (
                                        <p className="font-bold">Chrome vẫn đang chạy Extension bản cũ (v{installedExtVersion}) — cần cập nhật lên v{requiredExtVersion}!</p>
                                    )}
                                    <p className="text-xs opacity-90 mt-0.5">
                                        Bản cũ có thể gây bấm nhầm chia sẻ lên trang cá nhân. Hãy mở <code className="px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-900/50 font-mono">chrome://extensions</code>, <strong>xóa toàn bộ bản cũ</strong> rồi nạp thư mục <strong>fb-tool-ext-v{requiredExtVersion}</strong> và F5 lại trang.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6 items-start">
                        {/* Step 1: Select/Enter Page */}
                        <div className="bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 p-4 sm:p-5">
                            <div className="flex items-center justify-between gap-2 mb-4">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-6 h-6 rounded-full bg-purple-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                                    <h3 className="font-semibold text-text-main dark:text-white truncate">{t('select_page')}</h3>
                                </div>
                                {fbPages.length > 0 && (
                                    <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 text-xs font-semibold px-2 py-0.5 rounded-full shrink-0">
                                        {fbPages.length} Pages
                                    </span>
                                )}
                            </div>

                            {/* Fetch Pages Button */}
                            <button
                                type="button"
                                onClick={onFetchPages}
                                disabled={isFetchingPages}
                                className={`w-full font-semibold py-2.5 px-4 rounded-xl border transition-all flex justify-center items-center gap-2 mb-2.5 text-sm ${isFetchingPages ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 border-gray-200 dark:border-slate-700 cursor-not-allowed' : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'}`}
                            >
                                <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24">
                                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                                </svg>
                                <span>{!fbUser ? 'Kết nối Facebook' : t('fetch_pages')}</span>
                                {isFetchingPages && <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>}
                            </button>

                            <button
                                type="button"
                                onClick={onGetCurrentPage}
                                disabled={isFetchingPages || isScanning}
                                className={`w-full font-semibold py-2.5 px-4 rounded-xl border transition-all flex justify-center items-center gap-2 mb-1.5 text-sm ${isFetchingPages || isScanning ? 'bg-gray-100 dark:bg-slate-800 text-gray-400 border-gray-200 dark:border-slate-700 cursor-not-allowed' : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40'}`}
                            >
                                <span className="material-symbols-outlined text-[18px]">tab</span>
                                <span>Lấy Page đang mở</span>
                            </button>
                            <p className="text-[11px] text-text-tertiary mb-3">Mở tab Fanpage trên Chrome hoặc chuyển sang tư cách Page rồi bấm.</p>

                            {/* Pages List with Search when > 4 pages */}
                            {fbPages.length > 0 && (
                                <div className="mb-3">
                                    {fbPages.length > 4 && (
                                        <div className="relative mb-2">
                                            <span className="material-symbols-outlined text-[16px] text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
                                            <input
                                                type="text"
                                                value={pageSearch}
                                                onChange={(e) => setPageSearch(e.target.value)}
                                                placeholder={`Tìm trong ${fbPages.length} Pages...`}
                                                className="w-full pl-8 pr-3 py-1.5 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                            />
                                        </div>
                                    )}
                                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                                        {filteredPages.map(p => (
                                            <div key={p.id} onClick={() => { setSelectedPage(p); setPageUrl(p.url || `https://www.facebook.com/profile.php?id=${p.id}`); }} className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer transition-colors ${(selectedPage && selectedPage.id === p.id) ? 'bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-700' : 'hover:bg-gray-100 dark:hover:bg-slate-700 border border-transparent'}`}>
                                                {p.image ? (
                                                    <div className="w-8 h-8 rounded-lg bg-gray-200 dark:bg-slate-600 shrink-0 bg-cover bg-center" style={{ backgroundImage: `url(${p.image})` }}></div>
                                                ) : (
                                                    <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-600 dark:text-purple-300 shrink-0 flex items-center justify-center font-bold text-xs">
                                                        {(p.name || 'P').charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                                <span className="text-sm font-medium text-text-main dark:text-gray-200 truncate">{p.name}</span>
                                            </div>
                                        ))}
                                        {filteredPages.length === 0 && (
                                            <p className="text-xs text-center text-text-tertiary py-3">Không tìm thấy Page phù hợp.</p>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="text-xs text-text-tertiary text-center my-2">{t('or_enter_url')}</div>

                            {/* Manual URL Input */}
                            <input
                                type="text"
                                value={pageUrl}
                                onChange={(e) => setPageUrl(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && pageUrl.trim() && !isScanning) onScanPagePosts(); }}
                                placeholder={t('page_url_placeholder')}
                                className="w-full px-3 py-2.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-sm focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 mb-1.5"
                            />
                            <p className="text-[11px] text-text-tertiary mb-3">Hỗ trợ link Fanpage hoặc dán trực tiếp link bài viết / Reels.</p>

                            <button
                                type="button"
                                onClick={onScanPagePosts}
                                disabled={isScanning || !pageUrl.trim()}
                                className={`w-full font-semibold py-2.5 px-4 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 text-sm ${!pageUrl.trim() || isScanning ? 'bg-gray-400 text-white cursor-not-allowed opacity-70' : 'bg-purple-500 hover:bg-purple-600 text-white'}`}
                            >
                                {isScanning ? (
                                    <><span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span><span>{t('scanning_posts')}</span></>
                                ) : (
                                    <><span className="material-symbols-outlined text-[18px]">manage_search</span><span>{t('scan_page_posts')}</span></>
                                )}
                            </button>
                        </div>

                        {/* Step 2: Select Posts */}
                        <div className="bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 p-4 sm:p-5 flex flex-col min-h-[340px] lg:h-[510px]">
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-6 h-6 rounded-full bg-pink-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                                    <h3 className="font-semibold text-text-main dark:text-white truncate">{t('page_posts_title')}</h3>
                                    {pagePosts.length > 0 && <span className="bg-pink-100 dark:bg-pink-900/30 text-pink-600 dark:text-pink-300 text-xs px-2 py-0.5 rounded-full shrink-0">{selectedPosts.size}/{pagePosts.length}</span>}
                                </div>
                                {pagePosts.length > 0 && onToggleAllPosts && (
                                    <button
                                        type="button"
                                        onClick={onToggleAllPosts}
                                        className="text-[11px] font-semibold text-pink-600 dark:text-pink-400 hover:underline shrink-0"
                                    >
                                        {selectedPosts.size === pagePosts.length ? 'Bỏ chọn' : 'Chọn hết'}
                                    </button>
                                )}
                            </div>

                            {/* Quick Direct Post Link Input */}
                            <div className="flex items-center gap-1.5 mb-3">
                                <input
                                    type="text"
                                    value={manualPostUrl}
                                    onChange={(e) => setManualPostUrl(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
                                    placeholder="Hoặc dán trực tiếp link bài viết/Reel..."
                                    className="flex-1 min-w-0 px-3 py-2 bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl text-xs focus:ring-2 focus:ring-pink-500/20 focus:border-pink-500"
                                />
                                <button
                                    type="button"
                                    onClick={handleManualSubmit}
                                    disabled={!manualPostUrl.trim()}
                                    title="Thêm link bài viết để chia sẻ ngay"
                                    className="px-3 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:bg-gray-300 dark:disabled:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1 shrink-0 transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[16px]">add_link</span>
                                    <span>Thêm</span>
                                </button>
                            </div>

                            <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                                {pagePosts.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400 py-8 text-center px-3">
                                        <span className="material-symbols-outlined text-3xl mb-2 opacity-50">article</span>
                                        <p className="text-sm font-medium">{t('no_posts_found')}</p>
                                        <p className="text-xs text-text-tertiary mt-1">Chọn Page ở Bước 1 để quét, hoặc dán link bài viết vào ô phía trên.</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {pagePosts.map(p => (
                                            <div key={p.id} onClick={() => onTogglePost(p.id)} className={`relative group rounded-xl cursor-pointer overflow-hidden border transition-all ${selectedPosts.has(p.id) ? 'ring-2 ring-pink-500 border-pink-500 bg-pink-50 dark:bg-pink-900/20' : 'border-gray-200 dark:border-slate-700 hover:border-pink-300 dark:hover:border-pink-700 hover:shadow-md'}`}>
                                                {/* Selection Indicator */}
                                                <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selectedPosts.has(p.id) ? 'bg-pink-500 border-pink-500' : 'bg-white/80 border-gray-400'}`}>
                                                    {selectedPosts.has(p.id) && <span className="material-symbols-outlined text-white text-[14px] font-bold">check</span>}
                                                </div>

                                                {/* External link preview */}
                                                {p.url && (
                                                    <a
                                                        href={p.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        onClick={(e) => e.stopPropagation()}
                                                        title="Mở bài viết gốc"
                                                        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-black/50 hover:bg-black/75 text-white flex items-center justify-center transition-colors"
                                                    >
                                                        <span className="material-symbols-outlined text-[13px]">open_in_new</span>
                                                    </a>
                                                )}

                                                {/* Media Thumbnail */}
                                                <div className="aspect-video bg-gray-100 dark:bg-slate-700 w-full relative">
                                                    {p.media ? (
                                                        <>
                                                            {p.type === 'video' ? (
                                                                <video src={p.media} className="w-full h-full object-cover" muted />
                                                            ) : (
                                                                <img src={p.media} className="w-full h-full object-cover" loading="lazy" />
                                                            )}
                                                            {p.type === 'video' && (
                                                                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                                                    <span className="material-symbols-outlined text-white text-3xl opacity-80">play_circle</span>
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <div className="flex items-center justify-center h-full text-gray-300">
                                                            <span className="material-symbols-outlined text-4xl">{p.type === 'video' ? 'play_circle' : 'text_fields'}</span>
                                                        </div>
                                                    )}
                                                    {/* Time Badge */}
                                                    {p.time && <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded backdrop-blur-sm">{p.time}</span>}
                                                </div>

                                                {/* Text Content + Source URL */}
                                                <div className="p-2.5">
                                                    <p className="text-xs text-text-main dark:text-gray-200 line-clamp-2 leading-relaxed min-h-[2.5em]">{p.text || '(Không có nội dung)'}</p>
                                                    {p.url && (
                                                        <p className="text-[10px] text-text-tertiary truncate mt-1 font-mono" title={p.url}>
                                                            {p.url.replace(/^https?:\/\/(www\.)?facebook\.com\//i, '')}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Step 3: Select Groups & Share */}
                        <div className="bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 p-4 sm:p-5 flex flex-col min-h-[360px] lg:h-[510px]">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                                    <h3 className="font-semibold text-text-main dark:text-white">{t('groups_title')}</h3>
                                </div>
                                {isScanningGroups ? (
                                    <button type="button" onClick={onStopScan} className="text-xs text-red-500 hover:underline flex items-center gap-1 min-h-[36px] px-2 font-semibold">
                                        <span className="material-symbols-outlined text-[15px] animate-spin">progress_activity</span>Dừng quét
                                    </button>
                                ) : (
                                    <button type="button" onClick={onScan} className="text-xs text-primary hover:underline flex items-center gap-1 min-h-[36px] px-2 font-semibold">
                                        <span className="material-symbols-outlined text-[15px]">refresh</span>{t('scan_groups')}
                                    </button>
                                )}
                            </div>

                            {groups.length > 0 && (
                                <div className="mb-2.5 p-2 rounded-xl bg-gray-50 dark:bg-slate-900/50 border border-gray-100 dark:border-slate-700 flex justify-between items-center">
                                    <label className="flex items-center gap-2 cursor-pointer group">
                                        <input 
                                            type="checkbox" 
                                            checked={groups.length > 0 && selectedGroups.size === groups.length}
                                            onChange={onToggleAll}
                                            className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                                        />
                                        <span className="text-[11px] font-bold text-text-secondary group-hover:text-blue-500 transition-colors">
                                            {selectedGroups.size === groups.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả nhóm'}
                                        </span>
                                    </label>
                                    <span className="text-[11px] font-semibold text-blue-600 dark:text-blue-400">{selectedGroups.size}/{groups.length}</span>
                                </div>
                            )}

                            <div className="flex-1 overflow-y-auto space-y-1 min-h-[120px] pr-0.5">
                                {groups.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400 py-6 text-center">
                                        <span className="material-symbols-outlined text-3xl mb-2 opacity-50">groups</span>
                                        <p className="text-sm font-medium mb-2">Chưa có danh sách nhóm</p>
                                        <button
                                            type="button"
                                            onClick={onScan}
                                            disabled={isScanningGroups}
                                            className="px-3.5 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 text-xs font-semibold hover:bg-blue-100 transition-colors"
                                        >
                                            Quét nhóm ngay
                                        </button>
                                    </div>
                                ) : (
                                    groups.map(g => (
                                        <div key={g.id} onClick={() => onToggleGroup(g.id)} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${selectedGroups.has(g.id) ? 'bg-blue-50 dark:bg-blue-900/20' : 'hover:bg-gray-50 dark:hover:bg-slate-800'}`}>
                                            <input type="checkbox" checked={selectedGroups.has(g.id)} onChange={() => { }} className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                                            <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-slate-700 flex-shrink-0 bg-cover bg-center" style={{ backgroundImage: g.image ? `url(${g.image})` : undefined }}></div>
                                            <span className="text-xs text-text-main dark:text-gray-200 truncate">{g.name}</span>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* Pure Native Share Footer + Delay & Live Countdown */}
                            <div className="pt-2.5 border-t border-border-light mt-2.5">
                                <div className="flex items-center justify-between gap-2 mb-2 text-[11px] text-text-secondary">
                                    <span className="flex items-center gap-1 font-medium">
                                        <span className="material-symbols-outlined text-[14px] text-purple-500">timer</span>
                                        Nghỉ giữa mỗi nhóm:
                                    </span>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            min="3"
                                            max="300"
                                            value={shareDelayMin}
                                            onChange={(e) => setShareDelayMin(Math.max(3, parseInt(e.target.value, 10) || 3))}
                                            disabled={isSharing}
                                            className="w-12 px-1.5 py-0.5 text-center text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-text-main dark:text-white"
                                        />
                                        <span className="text-text-tertiary">–</span>
                                        <input
                                            type="number"
                                            min="3"
                                            max="600"
                                            value={shareDelayMax}
                                            onChange={(e) => setShareDelayMax(Math.max(shareDelayMin || 3, parseInt(e.target.value, 10) || 10))}
                                            disabled={isSharing}
                                            className="w-12 px-1.5 py-0.5 text-center text-xs font-semibold rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-text-main dark:text-white"
                                        />
                                        <span className="text-text-tertiary">giây</span>
                                    </div>
                                </div>

                                {shareCountdown && shareCountdown.current > 0 && (
                                    <div className="mb-2.5 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60">
                                        <div className="flex items-center justify-between gap-2 text-xs font-bold text-amber-700 dark:text-amber-300 mb-1">
                                            <span className="flex items-center gap-1.5 truncate">
                                                <span className="material-symbols-outlined text-[15px] animate-pulse">hourglass_top</span>
                                                <span className="truncate">Tiếp theo: {shareCountdown.nextGroupName || 'Nhóm kế tiếp'}</span>
                                            </span>
                                            <span className="font-mono text-sm shrink-0 text-amber-800 dark:text-amber-200">{shareCountdown.current}s</span>
                                        </div>
                                        <div className="w-full h-1.5 bg-amber-200/70 dark:bg-amber-900/50 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-amber-500 rounded-full transition-all duration-1000 ease-linear"
                                                style={{ width: `${Math.max(4, Math.round((shareCountdown.current / Math.max(1, shareCountdown.total)) * 100))}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                <p className="text-[11px] text-text-tertiary mb-2 leading-relaxed">
                                    Chia sẻ trực tiếp bài gốc từ Page vào nhóm (không chèn chữ hay link thô — giữ nguyên ảnh & nội dung bài gốc).
                                </p>
                                <div className="flex justify-between text-xs text-text-secondary mb-2">
                                    <span>{selectedPosts.size} bài • {selectedGroups.size} nhóm</span>
                                    {selectedPosts.size > 0 && selectedGroups.size > 0 && (
                                        <span className="font-semibold text-purple-600 dark:text-purple-400">Tổng {selectedPosts.size * selectedGroups.size} lượt</span>
                                    )}
                                </div>
                                {isSharing ? (
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            disabled
                                            className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 opacity-90 text-white font-semibold py-2.5 px-3 rounded-xl shadow-lg flex justify-center items-center gap-2 text-sm"
                                        >
                                            <span className="material-symbols-outlined text-[18px] animate-spin">progress_activity</span>
                                            <span>{shareCountdown && shareCountdown.current > 0 ? `Chờ ${shareCountdown.current}s...` : t('sharing')}</span>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={onStopShare}
                                            className="px-3.5 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-semibold shadow-lg flex items-center gap-1 text-sm shrink-0 transition-colors"
                                        >
                                            <span className="material-symbols-outlined text-[18px]">stop_circle</span>
                                            <span>Dừng</span>
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={onSharePosts}
                                        disabled={selectedPosts.size === 0 || selectedGroups.size === 0}
                                        className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 disabled:from-gray-400 disabled:to-gray-400 text-white font-semibold py-3 px-4 rounded-xl shadow-lg transition-all flex justify-center items-center gap-2 text-sm"
                                    >
                                        <span>{t('share_selected')}</span>
                                        <span className="material-symbols-outlined text-[18px]">share</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                    <ProgressLog
                        logs={logs}
                        progress={progress}
                        t={t}
                        successItems={successItems}
                        isCheckingStatus={isCheckingStatus}
                        checkProgress={checkProgress}
                        onCheckAllStatus={onCheckAllStatus}
                        onCheckSingleStatus={onCheckSingleStatus}
                        onStopCheckStatus={onStopCheckStatus}
                        onClearSuccessItems={onClearSuccessItems}
                        collections={collections}
                        onSaveLiveGroupsCollection={onSaveLiveGroupsCollection}
                    />
                </>
            );
        }
        function SetupWizard({
            t,
            extensionStatus,
            googleUser,
            onGoogleLogin,
            subscription,
            fbUser,
            onFBConnect,
            groups,
            onScanGroups,
            isScanningGroups,
            setActivePage,
            onEnterPreview
        }) {
            const { showToast } = useContext(AppContext) || {};
            const [isRechecking, setIsRechecking] = useState(false);
            const [isDownloading, setIsDownloading] = useState(false);
            const [downloadError, setDownloadError] = useState('');
            const [downloadSuccess, setDownloadSuccess] = useState('');
            const [showGuide, setShowGuide] = useState(false);
            const [recheckFailed, setRecheckFailed] = useState(false);
            const [copiedExtUrl, setCopiedExtUrl] = useState(false);

            useEffect(() => {
                const params = new URLSearchParams(window.location.search);
                if (params.get('recheck') === '1') {
                    // Clean query parameter without triggering another reload
                    params.delete('recheck');
                    const cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
                    window.history.replaceState({}, '', cleanUrl);
                    const timer = setTimeout(() => {
                        if (!document.documentElement?.dataset?.fbToolInstalled && !storage.get('extension_status', false)) {
                            setRecheckFailed(true);
                            setShowGuide(true);
                        }
                    }, 900);
                    return () => clearTimeout(timer);
                }
            }, []);

            const steps = [
                { id: 'login', title: t('step_login'), icon: 'person', done: !!googleUser },
                { id: 'extension', title: t('step_extension'), icon: 'extension', done: !!extensionStatus },
                { id: 'facebook', title: t('step_facebook'), icon: 'link', done: !!fbUser },
            ];

            const currentIdx = steps.findIndex(s => !s.done);
            const activeStep = currentIdx === -1 ? steps.length : currentIdx;

            const handleRecheck = () => {
                setIsRechecking(true);
                setRecheckFailed(false);
                window.postMessage({ type: 'CHECK_EXTENSION' }, '*');

                setTimeout(() => {
                    if (document.documentElement?.dataset?.fbToolInstalled || storage.get('extension_status', false)) {
                        setIsRechecking(false);
                        return;
                    }
                    // Chrome does not inject newly loaded extensions into already-open tabs until reload
                    const url = new URL(window.location.href);
                    if (url.searchParams.get('recheck') !== '1') {
                        url.searchParams.set('recheck', '1');
                        window.location.href = url.toString();
                    } else {
                        setIsRechecking(false);
                        setRecheckFailed(true);
                        setShowGuide(true);
                    }
                }, 650);
            };

            const copyChromeExtUrl = () => {
                const target = 'chrome://extensions';
                const done = () => {
                    setCopiedExtUrl(true);
                    setTimeout(() => setCopiedExtUrl(false), 2000);
                };
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(target).then(done).catch(done);
                } else {
                    done();
                }
            };

            // Smart verified ZIP download: prevents Chrome/AI Studio iframe or Vercel 500 text from corrupting .zip
            const handleDownloadExtension = async () => {
                if (isDownloading) return;
                setIsDownloading(true);
                setDownloadError('');
                setDownloadSuccess('');

                try {
                    const { filename, kb } = await downloadExtensionZip('3.8');
                    const successMsg = `Đã tải ${filename} hợp lệ (${kb} KB). Giải nén thư mục fb-tool-ext-v3.8 rồi cài vào chrome://extensions.`;
                    setDownloadSuccess(successMsg);
                    if (showToast) {
                        showToast(successMsg, 'success');
                    }
                } catch (err) {
                    const msg = (err && err.message) ? err.message : 'Không thể tải gói Extension hợp lệ. Vui lòng thử lại.';
                    setDownloadError(msg);
                    if (showToast) showToast(msg, 'error');
                } finally {
                    setIsDownloading(false);
                }
            };

            return (
                <div className="flex flex-col items-center justify-center min-h-[80dvh] animate-fade-in px-3.5 sm:px-4 py-6 sm:py-10 w-full">
                    <div className="w-full max-w-2xl bg-white dark:bg-slate-800 rounded-3xl sm:rounded-[32px] p-5 sm:p-8 md:p-12 shadow-card ring-1 ring-border-light/50 relative overflow-hidden">
                        {/* Decorative background */}
                        <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/5 rounded-full blur-3xl"></div>
                        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-purple-500/5 rounded-full blur-3xl"></div>

                        <div className="relative z-10">
                            <div className="text-center mb-6 sm:mb-10">
                                <h1 className="text-2xl sm:text-3xl font-black text-text-main dark:text-white mb-2">{t('onboarding_title')}</h1>
                                <p className="text-sm sm:text-base text-text-secondary">{t('onboarding_subtitle')}</p>
                            </div>

                            <div className="space-y-3 sm:space-y-4 mb-6 sm:mb-10">
                                {steps.map((step, idx) => (
                                    <div key={step.id} className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${idx === activeStep ? 'border-primary bg-primary/5 shadow-sm' : step.done ? 'border-emerald-100 dark:border-emerald-900/30 bg-emerald-50/30 dark:bg-emerald-900/10' : 'border-gray-100 dark:border-slate-700 opacity-60'}`}>
                                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${step.done ? 'bg-emerald-500 text-white' : idx === activeStep ? 'bg-primary text-white shadow-lg shadow-primary/30' : 'bg-gray-100 dark:bg-slate-700 text-gray-400'}`}>
                                            <span className="material-symbols-outlined">{step.done ? 'check' : step.icon}</span>
                                        </div>
                                        <div className="flex-1">
                                            <h3 className={`font-bold ${idx === activeStep ? 'text-primary' : step.done ? 'text-emerald-600 dark:text-emerald-400' : 'text-text-tertiary'}`}>{step.title}</h3>
                                            <p className="text-xs text-text-tertiary">
                                                {step.done ? t('toast_success') : idx === activeStep ? 'Cần thực hiện ngay' : 'Đang chờ...'}
                                            </p>
                                        </div>
                                        {idx === activeStep && (
                                            <div className="animate-bounce-h">
                                                <span className="material-symbols-outlined text-primary">arrow_forward</span>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <div className="flex flex-col items-center gap-4">
                                {/* Extension Download */}
                                {activeStep < steps.length && steps[activeStep].id === 'extension' && (
                                    <div className="w-full">
                                        {window.location.protocol === 'file:' && (
                                            <div className="mb-4 p-4 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 rounded-2xl animate-fade-in">
                                                <div className="flex items-start gap-3">
                                                    <span className="material-symbols-outlined text-amber-600 shrink-0 mt-0.5">warning</span>
                                                    <div>
                                                        <h4 className="font-bold text-amber-800 dark:text-amber-400 text-sm mb-1">
                                                            Lưu ý khi mở ứng dụng từ tệp cục bộ (file://)
                                                        </h4>
                                                        <div className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed space-y-1.5">
                                                            <p>Để Extension có thể nhận diện được ứng dụng khi chạy bằng tệp cục bộ, bạn cần thực hiện:</p>
                                                            <div className="pl-2 space-y-1 font-medium">
                                                                <div>1. Mở trang quản lý tiện ích: <code className="bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded font-mono text-[11px] select-all">chrome://extensions</code></div>
                                                                <div>2. Tìm thẻ của extension <strong>FB Multi-Post Tool</strong> và nhấn vào nút <strong>Chi tiết (Details)</strong>.</div>
                                                                <div>3. Tìm và bật chức năng <strong>"Cho phép truy cập vào các URL của tệp" (Allow access to file URLs)</strong>.</div>
                                                                <div>4. Tải lại trang này (F5) và nhấn <strong>Kiểm tra lại</strong>.</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 rounded-2xl p-6 border border-indigo-100 dark:border-indigo-800/50 mb-4">
                                            <div className="flex items-start gap-4 mb-5">
                                                <div className="w-14 h-14 bg-gradient-to-br from-primary to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/30 shrink-0">
                                                    <span className="material-symbols-outlined text-white text-[28px]">extension</span>
                                                </div>
                                                <div>
                                                    <h3 className="text-lg font-bold text-text-main dark:text-white mb-1">{t('ext_download_title')}</h3>
                                                    <p className="text-sm text-text-secondary leading-relaxed">{t('ext_download_desc')}</p>
                                                </div>
                                            </div>

                                            <div className="flex flex-col sm:flex-row gap-3">
                                                <button
                                                    type="button"
                                                    onClick={handleDownloadExtension}
                                                    disabled={isDownloading}
                                                    className="flex-1 flex items-center justify-center gap-2 px-4 sm:px-6 py-3.5 sm:py-4 bg-gradient-to-r from-primary to-indigo-600 text-white rounded-xl font-bold shadow-xl shadow-primary/30 hover:from-primary-hover hover:to-indigo-700 transition-all active:scale-95 disabled:opacity-60 text-sm sm:text-base whitespace-nowrap"
                                                >
                                                    <span className={`material-symbols-outlined text-[20px] shrink-0 ${isDownloading ? 'animate-spin' : ''}`}>
                                                        {isDownloading ? 'progress_activity' : 'download'}
                                                    </span>
                                                    <span>{isDownloading ? 'Đang kiểm tra & tải...' : t('ext_download_btn')}</span>
                                                    {!isDownloading && (
                                                        <span className="text-[11px] font-mono bg-white/20 px-1.5 py-0.5 rounded shrink-0">v3.8</span>
                                                    )}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleRecheck}
                                                    disabled={isRechecking}
                                                    className="flex items-center justify-center gap-2 px-4 sm:px-6 py-3.5 sm:py-4 bg-white dark:bg-slate-900 border-2 border-primary/30 text-primary rounded-xl font-bold hover:bg-primary/5 transition-all active:scale-95 disabled:opacity-50 text-sm sm:text-base whitespace-nowrap"
                                                >
                                                    <span className={`material-symbols-outlined text-[20px] shrink-0 ${isRechecking ? 'animate-spin' : ''}`}>
                                                        {isRechecking ? 'progress_activity' : 'refresh'}
                                                    </span>
                                                    {isRechecking ? t('ext_download_checking') : t('ext_download_recheck')}
                                                </button>
                                            </div>

                                            {downloadSuccess && (
                                                <div className="mt-4 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-xs text-emerald-800 dark:text-emerald-300 flex items-start gap-2 animate-fade-in">
                                                    <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">check_circle</span>
                                                    <span>{downloadSuccess}</span>
                                                </div>
                                            )}

                                            {downloadError && (
                                                <div className="mt-4 p-3.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 text-xs text-red-700 dark:text-red-300 flex items-start gap-2 animate-fade-in">
                                                    <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
                                                    <span>{downloadError}</span>
                                                </div>
                                            )}

                                            {recheckFailed && (
                                                <div className="mt-4 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 text-xs text-amber-900 dark:text-amber-200 space-y-2 animate-fade-in">
                                                    <div className="flex items-center gap-2 font-bold">
                                                        <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-[18px]">info</span>
                                                        <span>Chưa nhận diện được Extension trên trang này</span>
                                                    </div>
                                                    <ul className="list-disc pl-5 space-y-1 text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                                                        <li>File <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">.zip</code> tải về máy chưa tự cài — bạn cần <strong>giải nén</strong>, mở <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 rounded">chrome://extensions</code>, bật <strong>Chế độ nhà phát triển</strong> và chọn <strong>Tải tiện ích đã giải nén</strong>.</li>
                                                        <li>Nếu trước đó đã cài bản cũ (<strong>v2.0</strong>), hãy tải lại bản <strong>v2.1</strong> mới nhất (đã hỗ trợ khung xem trước &amp; mọi tên miền Vercel), giải nén đè rồi bấm nút <strong>Tải lại (↻)</strong> trên thẻ Extension.</li>
                                                    </ul>
                                                </div>
                                            )}
                                        </div>

                                        {/* Installation Guide */}
                                        <button
                                            onClick={() => setShowGuide(!showGuide)}
                                            className="w-full flex items-center justify-between px-4 py-3 text-sm text-primary font-semibold hover:bg-primary/5 rounded-xl transition-all"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-[18px]">help</span>
                                                {t('ext_guide_title')}
                                            </div>
                                            <span className={`material-symbols-outlined text-[18px] transition-transform ${showGuide ? 'rotate-180' : ''}`}>expand_more</span>
                                        </button>

                                        {showGuide && (
                                            <div className="bg-white dark:bg-slate-900 rounded-xl p-5 border border-border-light dark:border-slate-700 mt-2 space-y-3 animate-fade-in">
                                                {[t('ext_guide_step1'), t('ext_guide_step2'), t('ext_guide_step3'), t('ext_guide_step4'), t('ext_guide_step5'), t('ext_guide_step6')].map((step, i) => (
                                                    <div key={i} className="flex items-start gap-3">
                                                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                                                            {i + 1}
                                                        </div>
                                                        <p className="text-sm text-text-main dark:text-gray-300 pt-1">{step}</p>
                                                    </div>
                                                ))}
                                                <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                                    <div className="flex items-start gap-2">
                                                        <span className="material-symbols-outlined text-amber-600 text-[16px] mt-0.5">warning</span>
                                                        <p className="text-xs text-amber-800 dark:text-amber-300">Chrome không cho phép mở trực tiếp link nội bộ. Hãy sao chép <code className="bg-amber-100 dark:bg-amber-800/30 px-1.5 py-0.5 rounded font-mono text-[11px]">chrome://extensions</code> và dán vào thanh địa chỉ.</p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={copyChromeExtUrl}
                                                        className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1"
                                                    >
                                                        <span className="material-symbols-outlined text-[14px]">{copiedExtUrl ? 'check' : 'content_copy'}</span>
                                                        {copiedExtUrl ? 'Đã chép' : 'Sao chép'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Google Login */}
                                {activeStep < steps.length && steps[activeStep].id === 'login' && (
                                    <button onClick={onGoogleLogin} className="w-full md:w-auto px-5 sm:px-8 py-3.5 sm:py-4 min-h-[48px] bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-text-main dark:text-white rounded-2xl font-bold shadow-lg hover:shadow-xl hover:bg-gray-50 dark:hover:bg-slate-800 transition-all flex items-center justify-center gap-3 sm:gap-4 active:scale-95 group">
                                        <div className="w-7 h-7 sm:w-8 sm:h-8 bg-white rounded-full flex items-center justify-center shadow-sm border border-gray-100 p-1.5 flex-shrink-0">
                                            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-full h-full" />
                                        </div>
                                        <span className="text-sm sm:text-lg whitespace-nowrap">{t('sub_login_google')}</span>
                                        <span className="material-symbols-outlined text-gray-400 group-hover:text-primary transition-colors flex-shrink-0">arrow_forward</span>
                                    </button>
                                )}

                                {/* Facebook Connect */}
                                {activeStep < steps.length && steps[activeStep].id === 'facebook' && (
                                    <button onClick={onFBConnect} className="w-full md:w-auto px-5 sm:px-8 py-3.5 sm:py-4 min-h-[48px] bg-[#1877F2] text-white rounded-2xl font-bold shadow-xl shadow-blue-500/30 hover:bg-[#166fe5] hover:shadow-blue-500/40 transition-all flex items-center justify-center gap-3 sm:gap-4 active:scale-95 group">
                                        <div className="w-7 h-7 sm:w-8 sm:h-8 bg-white/20 rounded-full flex items-center justify-center p-1.5 flex-shrink-0">
                                            <span className="material-symbols-outlined text-white">link</span>
                                        </div>
                                        <span className="text-sm sm:text-lg whitespace-nowrap">{t('btn_connect_fb')}</span>
                                        <span className="material-symbols-outlined text-white/50 group-hover:text-white transition-colors flex-shrink-0">arrow_forward</span>
                                    </button>
                                )}

                                {/* All steps complete */}
                                {activeStep === steps.length && (
                                    <div className="text-center py-4 w-full">
                                        <p className="font-bold text-emerald-600 mb-4 text-lg">🎉 {t('step_done')}!</p>
                                        <button onClick={() => setActivePage('post')} className="w-full sm:w-auto px-8 sm:px-10 py-3.5 sm:py-4 min-h-[48px] bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl font-bold shadow-xl shadow-emerald-500/30 hover:from-emerald-600 hover:to-teal-700 transition-all active:scale-95 flex items-center justify-center gap-3 mx-auto">
                                            <span className="material-symbols-outlined">rocket_launch</span>
                                            {t('btn_start_now')}
                                        </button>
                                    </div>
                                )}

                                {/* Preview / Bypass option when testing or configuring without Extension */}
                                {onEnterPreview && activeStep < steps.length && (
                                    <div className="w-full pt-4 mt-2 border-t border-gray-100 dark:border-slate-700/80 flex flex-col sm:flex-row items-center justify-between gap-3">
                                        <p className="text-xs text-text-secondary text-center sm:text-left leading-relaxed">
                                            Chưa cài Extension? Bạn vẫn có thể vào giao diện để soạn bài, dùng AI Gemini &amp; kiểm thử.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={onEnterPreview}
                                            className="w-full sm:w-auto shrink-0 px-5 py-3 sm:py-2.5 min-h-[44px] sm:min-h-0 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-text-main dark:text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5"
                                        >
                                            <span className="material-symbols-outlined text-[16px]">dashboard</span>
                                            Vào bảng điều khiển ngay
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        function SubscriptionPage({ t, googleUser, subscription, onGoogleLogin, onGoogleLogout, onSelectPlan, getSubscriptionDaysLeft, isSubscriptionActive }) {
            const plans = [
                { id: 'free', name: t('sub_free'), price: '0đ', features: t('sub_features_free').split('|'), color: 'bg-slate-500' },
                { id: 'pro', name: t('sub_pro'), price: '199.000đ', features: t('sub_features_pro').split('|'), color: 'bg-primary', popular: true },
                { id: 'enterprise', name: t('sub_enterprise'), price: '499.000đ', features: t('sub_features_ent').split('|'), color: 'bg-purple-600' }
            ];

            return (
                <div className="animate-fade-in">
                    <div className="mb-8 text-center">
                        <h1 className="text-3xl font-bold text-text-main dark:text-white mb-2">{t('sub_title')}</h1>
                        <p className="text-text-secondary">{t('sub_desc')}</p>
                    </div>

                    {!googleUser ? (
                        <div className="max-w-md mx-auto bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-card ring-1 ring-border-light/50 text-center mb-12">
                            <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                <span className="material-symbols-outlined text-3xl text-primary">account_circle</span>
                            </div>
                            <h2 className="text-xl font-bold text-text-main dark:text-white mb-2">{t('sub_login_google')}</h2>
                            <p className="text-text-secondary mb-6">{t('sub_login_google_desc')}</p>
                            <button onClick={onGoogleLogin} className="w-full flex items-center justify-center gap-2 bg-white dark:bg-slate-900 border border-gray-300 dark:border-slate-600 py-3 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-slate-800 transition-all shadow-sm">
                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" />
                                <span>{t('sub_login_google')}</span>
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-12">
                            {(() => {
                                const activeVisualPlan = isSubscriptionActive() ? subscription.plan : 'free';
                                return plans.map(plan => (
                                    <div key={plan.id} className={`relative bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-card ring-1 ring-border-light/50 flex flex-col transition-all hover:shadow-soft hover:scale-[1.02] ${plan.popular ? 'ring-2 ring-primary shadow-glow' : ''}`}>
                                        {plan.popular && (
                                            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-white text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full shadow-lg">Most Popular</span>
                                        )}
                                        <div className="mb-6">
                                            <h3 className="text-xl font-bold text-text-main dark:text-white mb-1">{plan.name}</h3>
                                            <div className="flex items-baseline gap-1">
                                                <span className="text-3xl font-black text-text-main dark:text-white">{plan.price}</span>
                                                <span className="text-text-secondary text-sm">/{t('sub_month')}</span>
                                            </div>
                                        </div>
                                        <ul className="space-y-4 mb-8 flex-1">
                                            {plan.features.map((feature, i) => (
                                                <li key={i} className="flex items-start gap-3 text-sm text-text-secondary">
                                                    <span className="material-symbols-outlined text-emerald-500 text-[18px]">check_circle</span>
                                                    <span>{feature}</span>
                                                </li>
                                            ))}
                                        </ul>
                                        {activeVisualPlan === plan.id ? (
                                            <button disabled className="w-full py-3 rounded-xl font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 flex items-center justify-center gap-2">
                                                <span className="material-symbols-outlined text-[18px]">verified</span>
                                                {t('sub_current_plan')}
                                            </button>
                                        ) : (
                                            <button onClick={() => onSelectPlan(plan.id)} className={`w-full py-3 rounded-xl font-bold text-white transition-all shadow-lg active:scale-95 ${plan.color}`}>
                                                {plan.id === 'enterprise' ? t('sub_contact') : t('sub_upgrade')}
                                            </button>
                                        )}
                                    </div>
                                ));
                            })()}
                        </div>
                    )}

                    {googleUser && subscription.plan !== 'free' && (
                        <div className="bg-white dark:bg-slate-800 rounded-3xl p-8 shadow-card ring-1 ring-border-light/50 mb-12">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8">
                                <div>
                                    <h2 className="text-2xl font-bold text-text-main dark:text-white mb-1">{t('sub_plan_info')}</h2>
                                    <div className="flex items-center gap-3">
                                        <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${isSubscriptionActive() ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                                            {isSubscriptionActive() ? t('sub_active') : t('sub_expired')}
                                        </span>
                                        <span className="text-text-secondary text-sm">{t('sub_expire_date')}: <b>{new Date(subscription.expiresAt).toLocaleDateString('vi-VN')}</b></span>
                                    </div>
                                </div>
                                <button onClick={() => onSelectPlan(subscription.plan)} className="px-6 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-bold shadow-lg shadow-amber-500/20 transition-all active:scale-95">
                                    {t('sub_renew')}
                                </button>
                            </div>

                            <div className="border-t border-border-light pt-8">
                                <h3 className="text-lg font-bold text-text-main dark:text-white mb-4">{t('sub_history')}</h3>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left text-sm">
                                        <thead>
                                            <tr className="text-text-secondary uppercase text-[10px] tracking-widest border-b border-border-light">
                                                <th className="pb-3 px-2">ID</th>
                                                <th className="pb-3 px-2">Gói</th>
                                                <th className="pb-3 px-2">Thời gian</th>
                                                <th className="pb-3 px-2">Ngày</th>
                                                <th className="pb-3 px-2 text-right">Trạng thái</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border-light/50">
                                            {(subscription.history && subscription.history.length > 0) ? subscription.history.map(item => (
                                                <tr key={item.id} className="text-text-main dark:text-gray-300">
                                                    <td className="py-4 px-2 font-mono text-xs">{item.id}</td>
                                                    <td className="py-4 px-2 font-bold uppercase">{item.plan}</td>
                                                    <td className="py-4 px-2">{item.months} {t('sub_month')}</td>
                                                    <td className="py-4 px-2">{new Date(item.date).toLocaleDateString('vi-VN')}</td>
                                                    <td className="py-4 px-2 text-right">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${item.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                                            {item.status === 'approved' ? t('sub_approved') : t('sub_pending')}
                                                        </span>
                                                    </td>
                                                </tr>
                                            )) : (
                                                <tr>
                                                    <td colSpan="5" className="py-8 text-center text-text-tertiary italic">{t('sub_no_history')}</td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {googleUser && (
                        <div className="flex justify-center">
                            <button onClick={onGoogleLogout} className="flex items-center justify-center gap-2 min-h-[44px] px-5 py-2.5 rounded-xl text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-600 font-medium transition-colors">
                                <span className="material-symbols-outlined">logout</span>
                                {t('sub_logout_google')}
                            </button>
                        </div>
                    )}
                </div>
            );
        }

        function PaymentModal({ t, plan, subscription, isSubscriptionActive, onConfirm, onClose, settings }) {
            const [months, setMonths] = React.useState(1);
            const price = plan === 'pro' ? 199000 : 499000;
            const total = price * months;

            const getFriendlyBankName = (code) => {
                const map = {
                    vietcombank: 'Vietcombank (VCB)',
                    mbbank: 'MB Bank',
                    techcombank: 'Techcombank',
                    vietinbank: 'VietinBank',
                    bidv: 'BIDV',
                    acb: 'ACB',
                    agribank: 'Agribank',
                    vpbank: 'VPBank',
                    tpbank: 'TPBank',
                    sacombank: 'Sacombank',
                    vib: 'VIB',
                    shb: 'SHB',
                    hdbank: 'HDBank',
                    msb: 'MSB',
                    ocb: 'OCB'
                };
                return map[code] || code || 'Ngân hàng';
            };

            const txContent = React.useMemo(() => `AUTOP_${(plan && plan.toUpperCase())}_${Date.now().toString().slice(-6)}`, [plan]);
            const qrSrc = React.useMemo(() => {
                const baseTemplate = settings.qrTemplate || `https://img.vietqr.io/image/${settings.bankName || 'mbbank'}-${settings.bankNo || ''}-compact.png`;
                const connector = baseTemplate.includes('?') ? '&' : '?';
                return `${baseTemplate}${connector}amount=${total}&addInfo=${txContent}&accountName=${encodeURIComponent(settings.bankUser || '')}`;
            }, [settings, total, txContent]);

            return (
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={onClose}></div>
                    <div className="relative w-full max-w-lg max-h-[92dvh] overflow-y-auto bg-white dark:bg-slate-800 rounded-t-3xl sm:rounded-[32px] shadow-2xl animate-scale-in pb-safe">
                        <div className="p-5 sm:p-8">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold text-text-main dark:text-white">{t('sub_upgrade')} {plan && plan.toUpperCase()}</h2>
                                <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-full transition-colors">
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl p-6 border border-blue-100 dark:border-blue-800 mb-6">
                                <div className="flex justify-between items-center mb-4">
                                    <span className="text-text-secondary font-medium">Số tháng gia hạn</span>
                                    <div className="flex items-center gap-4 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-xl shadow-sm border border-border-light">
                                        <button onClick={() => setMonths(m => Math.max(1, m - 1))} className="text-primary hover:bg-blue-50 dark:hover:bg-slate-800 w-8 h-8 rounded-lg flex items-center justify-center font-bold">-</button>
                                        <span className="font-black text-text-main dark:text-white w-4 text-center">{months}</span>
                                        <button onClick={() => setMonths(m => m + 1)} className="text-primary hover:bg-blue-50 dark:hover:bg-slate-800 w-8 h-8 rounded-lg flex items-center justify-center font-bold">+</button>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center pt-4 border-t border-blue-100 dark:border-blue-800">
                                    <span className="text-text-secondary font-medium">Tổng cộng</span>
                                    <span className="text-2xl font-black text-primary">{total.toLocaleString('vi-VN')}đ</span>
                                </div>
                            </div>

                            <div className="space-y-4 mb-8">
                                <h3 className="font-bold text-text-main dark:text-white flex items-center gap-2">
                                    <span className="material-symbols-outlined text-primary">payments</span>
                                    {t('sub_payment_method')}
                                </h3>
                                <div className="p-5 bg-gray-50 dark:bg-slate-900/50 rounded-2xl border border-border-light">
                                    <div className="flex flex-col sm:flex-row items-center gap-4 mb-4">
                                        <div className="w-28 h-28 bg-white rounded-xl shadow-sm flex items-center justify-center p-1 border border-gray-100 flex-shrink-0">
                                            <img src={qrSrc} className="w-full h-full object-contain" alt="VietQR Code" />
                                        </div>
                                        <div className="text-center sm:text-left">
                                            <p className="text-[10px] text-text-tertiary uppercase tracking-widest font-bold">{getFriendlyBankName(settings.bankName)}</p>
                                            <p className="text-sm font-black text-text-main dark:text-white">{settings.bankUser || 'CHỦ TÀI KHOẢN'}</p>
                                            <p className="text-sm font-black text-primary">{settings.bankNo || 'SỐ TÀI KHOẢN'}</p>
                                        </div>
                                    </div>
                                    <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-border-light text-[11px] text-text-secondary">
                                        <p className="font-bold text-text-main dark:text-white mb-1">Nội dung chuyển khoản:</p>
                                        <p className="font-mono bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded border border-yellow-100 dark:border-yellow-800/50 select-all text-center font-bold text-sm tracking-wide text-primary">
                                            {txContent}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <button onClick={() => onConfirm(months)} className="w-full py-4 bg-primary hover:bg-primary-hover text-white rounded-2xl font-bold shadow-xl shadow-primary/20 transition-all active:scale-95">
                                {t('sub_confirm_payment')}
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        function ProgressLog({
            logs,
            progress,
            t,
            successItems = [],
            isCheckingStatus = false,
            checkProgress = null,
            onCheckAllStatus,
            onCheckSingleStatus,
            onStopCheckStatus,
            onClearSuccessItems,
            collections = [],
            onSaveLiveGroupsCollection,
            noTopMargin = false
        }) {
            const { showToast } = useContext(AppContext) || {};
            const logContainerRef = React.useRef(null);
            const [statusFilter, setStatusFilter] = useState('all');
            const [copiedItemId, setCopiedItemId] = useState(null);
            const [copiedAll, setCopiedAll] = useState(false);
            const [isSavingLiveCol, setIsSavingLiveCol] = useState(false);
            const [saveMode, setSaveMode] = useState('new'); // 'new' | 'merge'
            const [liveColName, setLiveColName] = useState('');
            const [mergeTargetId, setMergeTargetId] = useState('');

            const counts = useMemo(() => {
                let live = 0, pending = 0, removed = 0;
                const liveGroupKeys = new Set();
                for (const it of successItems) {
                    if (it.status === 'live') {
                        live++;
                        const key = String(it.groupId || it.groupName || it.id || '').trim();
                        if (key) liveGroupKeys.add(key);
                    }
                    else if (it.status === 'pending') pending++;
                    else if (it.status === 'removed') removed++;
                }
                return { all: successItems.length, live, liveUniqueGroups: liveGroupKeys.size, pending, removed };
            }, [successItems]);

            const openSaveLiveCollection = () => {
                if (counts.liveUniqueGroups === 0) {
                    if (showToast) {
                        showToast('Chưa có nhóm nào hiển thị ngay (không cần duyệt). Hãy chờ tự động kiểm tra hoặc bấm "Kiểm tra duyệt / gỡ" trước!', 'info');
                    }
                    return;
                }
                const now = new Date();
                const dateTag = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
                setLiveColName(`Nhóm không duyệt (${dateTag})`);
                setSaveMode('new');
                if (collections.length > 0 && !mergeTargetId) {
                    setMergeTargetId(collections[0].id);
                }
                setIsSavingLiveCol((prev) => !prev);
            };

            const confirmSaveLiveCollection = () => {
                if (!onSaveLiveGroupsCollection) return;
                if (saveMode === 'merge') {
                    const targetId = mergeTargetId || (collections[0] ? collections[0].id : '');
                    if (!targetId) {
                        if (showToast) showToast('Vui lòng chọn bộ sưu tập cần gộp!', 'error');
                        return;
                    }
                    const res = onSaveLiveGroupsCollection({ mergeCollectionId: targetId });
                    if (res && res.ok) setIsSavingLiveCol(false);
                    return;
                }
                if (!liveColName.trim()) {
                    if (showToast) showToast('Vui lòng nhập tên bộ sưu tập!', 'error');
                    return;
                }
                const res = onSaveLiveGroupsCollection({ name: liveColName.trim() });
                if (res && res.ok) {
                    setIsSavingLiveCol(false);
                    setLiveColName('');
                }
            };

            const filteredItems = useMemo(() => {
                if (statusFilter === 'all') return successItems;
                return successItems.filter(it => it.status === statusFilter);
            }, [successItems, statusFilter]);

            const getStatusLabelVi = (st) => {
                if (st === 'live') return 'Đang hiển thị';
                if (st === 'pending') return 'Chờ QTV duyệt';
                if (st === 'removed') return 'Bị gỡ / Từ chối';
                if (st === 'checking') return 'Đang kiểm tra';
                if (st === 'unknown') return 'Chưa xác định';
                return 'Chưa kiểm tra';
            };

            const sanitizeLink = (link) =>
                link ? String(link).trim().replace(/\\\//g, '/').replace(/([^:]\/)\/+/g, '$1') : '';

            const copyTextReliable = async (text) => {
                try {
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(text);
                        return true;
                    }
                } catch (_) {}
                try {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    const ok = document.execCommand('copy');
                    document.body.removeChild(ta);
                    return ok;
                } catch (_) {
                    return false;
                }
            };

            const handleCopySingleLink = async (itemId, link) => {
                if (!link) return;
                const ok = await copyTextReliable(link);
                if (ok) {
                    setCopiedItemId(itemId);
                    setTimeout(() => setCopiedItemId((prev) => (prev === itemId ? null : prev)), 1800);
                    if (showToast) showToast('Đã sao chép link bài viết!', 'success');
                } else if (showToast) {
                    showToast('Không thể sao chép tự động, vui lòng bôi đen link để copy.', 'error');
                }
            };

            const handleCopyFilteredList = async () => {
                const list = filteredItems.length > 0 ? filteredItems : successItems;
                if (list.length === 0) return;
                const lines = list.map((it, idx) => {
                    const lnk = sanitizeLink(it.link) || '(Chưa có link)';
                    return `${idx + 1}. ${it.groupName} | ${getStatusLabelVi(it.status)} | ${lnk}`;
                });
                const ok = await copyTextReliable(lines.join('\n'));
                if (ok) {
                    setCopiedAll(true);
                    setTimeout(() => setCopiedAll(false), 1800);
                    if (showToast) showToast(`Đã sao chép ${list.length} nhóm kèm link!`, 'success');
                } else if (showToast) {
                    showToast('Không thể sao chép danh sách.', 'error');
                }
            };

            const handleExportCsv = () => {
                const list = filteredItems.length > 0 ? filteredItems : successItems;
                if (list.length === 0) return;
                const csvCell = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
                const header = ['STT', 'Tên nhóm', 'Link bài viết', 'Trạng thái', 'Chi tiết', 'Thời gian đăng', 'Kiểm tra lúc'];
                const rows = list.map((it, idx) => [
                    idx + 1,
                    it.groupName || '',
                    sanitizeLink(it.link),
                    getStatusLabelVi(it.status),
                    it.statusDetail || '',
                    it.time || '',
                    it.checkedAt || ''
                ]);
                const csvContent = '\uFEFF' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
                const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const now = new Date();
                const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
                const suffix = statusFilter === 'live' ? '-hien-thi' : statusFilter === 'pending' ? '-cho-duyet' : statusFilter === 'removed' ? '-bi-go' : '';
                const a = document.createElement('a');
                a.href = url;
                a.download = `ket-qua-dang-nhom${suffix}-${stamp}.csv`;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                if (showToast) showToast(`Đã xuất file kết quả ${list.length} nhóm kèm link (.csv)!`, 'success');
            };

            // Auto-scroll activity logs to bottom when new logs arrive
            React.useEffect(() => {
                if (logContainerRef.current) {
                    logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                }
            }, [logs]);

            return (
                <div className={`${noTopMargin ? '' : 'mt-6 sm:mt-8 '}bg-card-light dark:bg-slate-800 rounded-3xl shadow-card ring-1 ring-border-light/50 overflow-hidden`}>
                    <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-border-light flex flex-wrap justify-between items-center gap-2 bg-gray-50/30 dark:bg-slate-800/50">
                        <div className="flex items-center gap-3">
                            <div className="p-1.5 bg-slate-100 dark:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300">
                                <span className="material-symbols-outlined text-[20px]">terminal</span>
                            </div>
                            <h2 className="font-semibold text-base text-text-main dark:text-white">{t('progress_title')}</h2>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            {counts.all > 0 && (
                                <div className="flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1.5 rounded-full border border-emerald-200 dark:border-emerald-800 shadow-sm">
                                    <span className="material-symbols-outlined text-[14px] text-emerald-600 dark:text-emerald-400">check_circle</span>
                                    <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">{counts.all}</span>
                                    <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">thành công</span>
                                </div>
                            )}
                            <div className="flex items-center gap-2 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-full border border-gray-200 dark:border-slate-700 shadow-sm">
                                <span className="text-xs font-medium text-text-secondary">Tiến độ:</span>
                                <span className="text-xs font-bold text-primary">{progress}%</span>
                            </div>
                        </div>
                    </div>
                    <div className="p-6">
                        <div className="w-full bg-gray-100 dark:bg-slate-700 rounded-full h-2 mb-6 overflow-hidden border border-gray-200 dark:border-slate-600 inner-shadow">
                            <div className="bg-primary h-2 rounded-full relative overflow-hidden shadow-glow transition-all duration-300" style={{ width: `${Math.max(progress, 2)}%` }}>
                                <div className="absolute inset-0 bg-white/30 w-full h-full animate-[shimmer_2s_infinite] -skew-x-12"></div>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                            {/* Left Column: Successful Posts / Shares + Real Approval / Removal Status Checker */}
                            <div className="flex flex-col">
                                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                                    <div className="p-1 bg-emerald-100 dark:bg-emerald-900/30 rounded-md">
                                        <span className="material-symbols-outlined text-[16px] text-emerald-600 dark:text-emerald-400">link</span>
                                    </div>
                                    <h3 className="text-sm font-semibold text-text-main dark:text-white">Bài thành công &amp; Link</h3>
                                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                                        {counts.all > 0 && onSaveLiveGroupsCollection && (
                                            <button
                                                type="button"
                                                onClick={openSaveLiveCollection}
                                                title={counts.liveUniqueGroups > 0
                                                    ? `Lưu ${counts.liveUniqueGroups} nhóm đăng thành công, không cần QTV duyệt vào Bộ sưu tập nhóm`
                                                    : 'Chạy kiểm tra trạng thái để lọc các nhóm hiển thị ngay (không cần duyệt) rồi lưu thành bộ sưu tập'}
                                                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${counts.liveUniqueGroups > 0
                                                    ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                                                    : 'bg-amber-50 dark:bg-amber-950/30 text-amber-600/70 dark:text-amber-400/70 border border-amber-200/70 dark:border-amber-800/50'}`}
                                            >
                                                <span className="material-symbols-outlined text-[14px]">star</span>
                                                <span>Lưu BST không duyệt{counts.liveUniqueGroups > 0 ? ` (${counts.liveUniqueGroups})` : ''}</span>
                                            </button>
                                        )}
                                        {counts.all > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleCopyFilteredList}
                                                disabled={filteredItems.length === 0}
                                                title="Sao chép danh sách tên nhóm kèm link theo bộ lọc đang chọn"
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/70 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold disabled:opacity-40 transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">{copiedAll ? 'check' : 'content_copy'}</span>
                                                <span>{copiedAll ? 'Đã chép' : 'Chép DS'}</span>
                                            </button>
                                        )}
                                        {counts.all > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleExportCsv}
                                                disabled={filteredItems.length === 0}
                                                title="Xuất file Excel/CSV danh sách các nhóm đăng thành công kèm link và trạng thái"
                                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-semibold disabled:opacity-40 transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[14px]">download</span>
                                                <span>Xuất kết quả</span>
                                            </button>
                                        )}
                                        {counts.all > 0 && (
                                            isCheckingStatus ? (
                                                <button
                                                    type="button"
                                                    onClick={onStopCheckStatus}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[11px] font-semibold transition-colors"
                                                >
                                                    <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                                                    <span>{checkProgress ? `${checkProgress.done}/${checkProgress.total}` : '...'} · Dừng</span>
                                                </button>
                                            ) : (
                                                <button
                                                    type="button"
                                                    onClick={onCheckAllStatus}
                                                    title="Dùng Facebook của bạn kiểm tra từng link xem đang hiển thị, chờ QTV duyệt hay đã bị gỡ"
                                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-semibold transition-colors"
                                                >
                                                    <span className="material-symbols-outlined text-[14px]">fact_check</span>
                                                    <span>Kiểm tra duyệt / gỡ</span>
                                                </button>
                                            )
                                        )}
                                        {counts.all > 0 && !isCheckingStatus && onClearSuccessItems && (
                                            <button
                                                type="button"
                                                onClick={onClearSuccessItems}
                                                title="Xóa danh sách đã lưu"
                                                className="p-1 rounded-lg text-text-tertiary hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                            >
                                                <span className="material-symbols-outlined text-[15px]">delete_sweep</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {isSavingLiveCol && counts.liveUniqueGroups > 0 && (
                                    <div className="mb-2.5 p-2.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 space-y-2">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1">
                                                <span className="material-symbols-outlined text-[14px] text-amber-500">star</span>
                                                Lưu {counts.liveUniqueGroups} nhóm đăng thành công, không cần duyệt
                                            </span>
                                            {collections.length > 0 && (
                                                <div className="inline-flex rounded-lg bg-white/80 dark:bg-slate-800 p-0.5 border border-amber-200/80 dark:border-slate-700 text-[10px] font-semibold">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSaveMode('new')}
                                                        className={`px-2 py-0.5 rounded-md transition-colors ${saveMode === 'new' ? 'bg-amber-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                                                    >
                                                        Tạo mới
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setSaveMode('merge');
                                                            if (!mergeTargetId && collections[0]) setMergeTargetId(collections[0].id);
                                                        }}
                                                        className={`px-2 py-0.5 rounded-md transition-colors ${saveMode === 'merge' ? 'bg-amber-500 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                                                    >
                                                        Gộp vào BST có sẵn
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {saveMode === 'merge' && collections.length > 0 ? (
                                                <select
                                                    value={mergeTargetId || collections[0].id}
                                                    onChange={(e) => setMergeTargetId(e.target.value)}
                                                    className="flex-1 min-w-[160px] bg-white dark:bg-slate-900 border border-amber-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-amber-500 text-text-main dark:text-gray-200"
                                                >
                                                    {collections.map((col) => (
                                                        <option key={col.id} value={col.id}>
                                                            ⭐ {col.name} ({(col.groupIds || []).length} nhóm)
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <input
                                                    type="text"
                                                    value={liveColName}
                                                    onChange={(e) => setLiveColName(e.target.value)}
                                                    placeholder="Nhập tên bộ sưu tập (VD: Nhóm không duyệt)..."
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') confirmSaveLiveCollection();
                                                        if (e.key === 'Escape') setIsSavingLiveCol(false);
                                                    }}
                                                    className="flex-1 min-w-[160px] bg-white dark:bg-slate-900 border border-amber-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-amber-500 text-text-main dark:text-gray-200"
                                                />
                                            )}
                                            <button
                                                type="button"
                                                onClick={confirmSaveLiveCollection}
                                                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-sm transition-colors"
                                            >
                                                {saveMode === 'merge' ? 'Gộp nhóm' : 'Lưu bộ sưu tập'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setIsSavingLiveCol(false)}
                                                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-text-secondary text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors"
                                            >
                                                Hủy
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {counts.all > 0 && (
                                    <div className="flex flex-wrap items-center gap-1.5 mb-2.5 text-[11px]">
                                        <button
                                            type="button"
                                            onClick={() => setStatusFilter('all')}
                                            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${statusFilter === 'all' ? 'bg-slate-800 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                                        >
                                            Tất cả ({counts.all})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStatusFilter('live')}
                                            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${statusFilter === 'live' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/60'}`}
                                        >
                                            Hiển thị ({counts.live})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStatusFilter('pending')}
                                            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${statusFilter === 'pending' ? 'bg-amber-500 text-white' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-950/60'}`}
                                        >
                                            Chờ duyệt ({counts.pending})
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStatusFilter('removed')}
                                            className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${statusFilter === 'removed' ? 'bg-rose-600 text-white' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-950/60'}`}
                                        >
                                            Bị gỡ ({counts.removed})
                                        </button>
                                    </div>
                                )}

                                <div className="bg-gradient-to-b from-emerald-50/60 to-white dark:from-slate-900 dark:to-slate-900/80 rounded-xl p-3.5 h-64 overflow-y-auto border border-emerald-100 dark:border-slate-700/80 custom-scrollbar">
                                    {filteredItems.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-text-tertiary">
                                            <span className="material-symbols-outlined text-[32px] mb-2 opacity-40">hourglass_empty</span>
                                            <span className="text-xs font-medium">
                                                {counts.all === 0 ? 'Chưa có bài thành công' : 'Không có bài nào ở trạng thái này'}
                                            </span>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col gap-2">
                                            {filteredItems.map((item) => {
                                                const cleanLink = sanitizeLink(item.link);
                                                const st = item.status || 'unchecked';
                                                const isLive = st === 'live';
                                                const isPending = st === 'pending';
                                                const isRemoved = st === 'removed';
                                                const isChecking = st === 'checking';
                                                const isUnknown = st === 'unknown';

                                                const cardBorder = isRemoved
                                                    ? 'border-rose-300 dark:border-rose-800/80 bg-rose-50/40 dark:bg-rose-950/20'
                                                    : isPending
                                                        ? 'border-amber-300 dark:border-amber-800/70 bg-amber-50/40 dark:bg-amber-950/20'
                                                        : isLive
                                                            ? 'border-emerald-300 dark:border-emerald-800/70 bg-white dark:bg-slate-800'
                                                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800';

                                                const iconBg = isRemoved
                                                    ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400'
                                                    : isPending
                                                        ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
                                                        : isChecking
                                                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400'
                                                            : isUnknown
                                                                ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                                                                : 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400';

                                                const iconName = isRemoved
                                                    ? 'block'
                                                    : isPending
                                                        ? 'hourglass_top'
                                                        : isChecking
                                                            ? 'progress_activity'
                                                            : isUnknown
                                                                ? 'help'
                                                                : 'check';

                                                const badgeText = isRemoved
                                                    ? 'Bị gỡ / Từ chối'
                                                    : isPending
                                                        ? 'Chờ QTV duyệt'
                                                        : isLive
                                                            ? 'Đang hiển thị'
                                                            : isChecking
                                                                ? 'Đang kiểm tra...'
                                                                : isUnknown
                                                                    ? 'Chưa xác định'
                                                                    : 'Chưa kiểm tra';

                                                const badgeClass = isRemoved
                                                    ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-700 dark:text-rose-300'
                                                    : isPending
                                                        ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'
                                                        : isLive
                                                            ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                                                            : isChecking
                                                                ? 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                                                                : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300';

                                                const isCopied = copiedItemId === item.id;

                                                return (
                                                    <div key={item.id} className={`group flex items-start gap-2.5 px-3 py-2.5 rounded-lg border transition-all ${cardBorder}`}>
                                                        <div className={`flex-shrink-0 w-7 h-7 mt-0.5 rounded-full flex items-center justify-center ${iconBg}`}>
                                                            <span className={`material-symbols-outlined text-[14px] ${isChecking ? 'animate-spin' : ''}`}>{iconName}</span>
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <p className="text-xs font-semibold text-text-main dark:text-gray-100 truncate max-w-[200px] sm:max-w-[240px]">{item.groupName}</p>
                                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeClass}`}>{badgeText}</span>
                                                            </div>
                                                            {cleanLink ? (
                                                                <a href={cleanLink} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-primary hover:underline truncate mt-0.5">
                                                                    {cleanLink}
                                                                </a>
                                                            ) : (
                                                                <p className="text-[10px] text-gray-400 truncate mt-0.5">Không có link trực tiếp</p>
                                                            )}
                                                            {(item.statusDetail || item.checkedAt) && (
                                                                <p className={`text-[10px] mt-0.5 truncate ${isRemoved ? 'text-rose-600 dark:text-rose-400' : isPending ? 'text-amber-600 dark:text-amber-400' : 'text-text-tertiary'}`}>
                                                                    {item.statusDetail}{item.checkedAt ? ` · ${item.checkedAt}` : ''}
                                                                </p>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            {cleanLink && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCopySingleLink(item.id, cleanLink)}
                                                                    title={isCopied ? 'Đã sao chép link' : 'Sao chép link bài viết'}
                                                                    className={`p-1 rounded-md transition-colors ${isCopied ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' : 'text-text-tertiary hover:text-primary hover:bg-primary/10'}`}
                                                                >
                                                                    <span className="material-symbols-outlined text-[15px]">{isCopied ? 'check' : 'content_copy'}</span>
                                                                </button>
                                                            )}
                                                            {cleanLink && onCheckSingleStatus && (
                                                                <button
                                                                    type="button"
                                                                    disabled={isCheckingStatus || isChecking}
                                                                    onClick={() => onCheckSingleStatus(item.id)}
                                                                    title="Kiểm tra lại trạng thái bài này"
                                                                    className="p-1 rounded-md text-text-tertiary hover:text-primary hover:bg-primary/10 disabled:opacity-40 transition-colors"
                                                                >
                                                                    <span className={`material-symbols-outlined text-[15px] ${isChecking ? 'animate-spin' : ''}`}>refresh</span>
                                                                </button>
                                                            )}
                                                            {cleanLink && (
                                                                <a
                                                                    href={cleanLink}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    title="Mở bài viết trên Facebook"
                                                                    className="p-1 rounded-md text-text-tertiary hover:text-primary hover:bg-primary/10 transition-colors"
                                                                >
                                                                    <span className="material-symbols-outlined text-[15px]">open_in_new</span>
                                                                </a>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                                {counts.all > 0 && counts.live === 0 && counts.pending === 0 && counts.removed === 0 && (
                                    <p className="mt-1.5 text-[11px] text-text-tertiary">
                                        Mẹo: Bấm <strong>Kiểm tra duyệt / gỡ</strong> sau vài phút để xem bài nào đã hiển thị, đang chờ QTV duyệt hay đã bị gỡ.
                                    </p>
                                )}
                            </div>
                            {/* Right Column: Full Activity Log */}
                            <div className="flex flex-col">
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="p-1 bg-slate-100 dark:bg-slate-700 rounded-md">
                                        <span className="material-symbols-outlined text-[16px] text-slate-500 dark:text-slate-400">terminal</span>
                                    </div>
                                    <h3 className="text-sm font-semibold text-text-main dark:text-white">Nhật ký hoạt động</h3>
                                    <span className="ml-auto text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-full">{logs.length} dòng</span>
                                </div>
                                <div ref={logContainerRef} className="bg-[#1e293b] rounded-xl p-4 h-56 overflow-y-auto font-mono text-xs shadow-inner border border-slate-700 custom-scrollbar">
                                    <div className="flex flex-col gap-2">
                                        {logs.length === 0 ? (
                                            <div className="flex items-start gap-3 text-slate-400 opacity-60 hover:bg-white/5 p-1 rounded transition-colors">
                                                <span className="text-slate-600 min-w-[60px] select-none text-[11px]">--:--:--</span>
                                                <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">hourglass_empty</span>
                                                <span className="leading-relaxed italic">System Ready...</span>
                                            </div>
                                        ) : (
                                            logs.map((log, i) => (
                                                <div key={i} className={`flex items-start gap-2 p-1 rounded transition-colors hover:bg-white/5 ${log.type === 'error' ? 'text-red-400/90' : log.type === 'success' ? 'text-emerald-400/90' : log.type === 'warning' ? 'text-amber-400/90' : 'text-blue-400/90'}`}>
                                                    <span className="text-slate-500 min-w-[60px] select-none text-[11px] flex-shrink-0">{log.time}</span>
                                                    <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0">{log.type === 'success' ? 'check_circle' : log.type === 'error' ? 'error' : log.type === 'warning' ? 'warning' : 'info'}</span>
                                                    <span className="leading-relaxed break-all">{log.message}</span>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }


        function ToastItem({ toast, removeToast }) {
            const removeRef = useRef(removeToast);
            removeRef.current = removeToast;

            useEffect(() => {
                const duration = typeof toast.duration === 'number' && toast.duration > 0 ? toast.duration : 3000;
                const timer = setTimeout(() => {
                    removeRef.current(toast.id);
                }, duration + 150);
                return () => clearTimeout(timer);
            }, [toast.id, toast.duration]);

            const getToastStyles = (type) => {
                switch (type) {
                    case 'success':
                        return {
                            bg: 'bg-gradient-to-r from-emerald-500 to-teal-500',
                            icon: 'check_circle',
                            iconBg: 'bg-white/20'
                        };
                    case 'error':
                        return {
                            bg: 'bg-gradient-to-r from-red-500 to-rose-500',
                            icon: 'error',
                            iconBg: 'bg-white/20'
                        };
                    case 'warning':
                        return {
                            bg: 'bg-gradient-to-r from-amber-500 to-orange-500',
                            icon: 'warning',
                            iconBg: 'bg-white/20'
                        };
                    default:
                        return {
                            bg: 'bg-gradient-to-r from-blue-500 to-indigo-500',
                            icon: 'info',
                            iconBg: 'bg-white/20'
                        };
                }
            };

            const styles = getToastStyles(toast.type);

            return (
                <div
                    className={`relative flex items-center gap-3 px-4 py-4 rounded-3xl shadow-2xl text-white overflow-hidden transform transition-all duration-300 hover:scale-[1.02] hover:shadow-3xl animate-slide-in-right ${styles.bg}`}
                >
                    {/* Glow effect */}
                    <div className="absolute inset-0 bg-white/10 backdrop-blur-sm"></div>

                    {/* Icon */}
                    <div className={`relative z-10 flex items-center justify-center w-10 h-10 rounded-2xl ${styles.iconBg}`}>
                        <span className="material-symbols-outlined text-[24px] filled">{styles.icon}</span>
                    </div>

                    {/* Content */}
                    <div className="relative z-10 flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white/90 truncate">{toast.message}</p>
                    </div>

                    {/* Close button */}
                    <button
                        type="button"
                        onClick={() => removeToast(toast.id)}
                        className="relative z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>

                    {/* Progress bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                        <div className="h-full bg-white/60 rounded-full animate-shrink"></div>
                    </div>
                </div>
            );
        }

        function ToastContainer({ toasts, removeToast }) {
            return (
                <div className="fixed bottom-20 left-3.5 right-3.5 sm:left-auto sm:right-6 lg:bottom-6 z-[70] flex flex-col gap-3 sm:max-w-sm">
                    {toasts.map(toast => (
                        <ToastItem key={toast.id} toast={toast} removeToast={removeToast} />
                    ))}
                </div>
            );
        }



        ReactDOM.createRoot(document.getElementById('root')).render(<App />);
