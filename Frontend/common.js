/* ==========================================================================
   ThaiPBS Center — common.js (ใช้ร่วมกันทุกหน้า)
   - เรียก API ของ Backend (จัดการ timeout / error / response ที่ไม่ใช่ JSON)
   - สถานะการเข้าสู่ระบบ ตามผลลัพธ์ของ POST /api/login { user: { user_id, name, role } }
   - ตรวจสิทธิ์ตาม role: relative (ญาติ) / admin (เจ้าหน้าที่)
   - ตัวช่วยแสดงผล: escape HTML, วันที่ พ.ศ., badge สถานะ, กล่อง loading / error / empty, toast
   ========================================================================== */
(function (global) {
    'use strict';

    // ------------------------------------------------------------------
    // 1) ที่อยู่ Backend
    //    - เปิดผ่าน Express (node server.js) → ใช้ origin เดียวกัน
    //    - เปิดไฟล์ตรง (file://) หรือผ่าน VS Code Live Server (พอร์ต 5500) → ชี้ไปที่ localhost:5000
    //    - ต้องการชี้ที่อื่น: localStorage.setItem('apiBaseOverride', 'https://...')
    // ------------------------------------------------------------------
    function resolveApiBase() {
        try {
            const override = localStorage.getItem('apiBaseOverride');
            if (override) return override.replace(/\/+$/, '');
        } catch (_) { /* ignore */ }
        const loc = global.location;
        if (loc.protocol === 'file:') return 'http://localhost:5000';
        if (['5500', '5501', '5502'].includes(loc.port)) return `${loc.protocol}//${loc.hostname}:5000`;
        return loc.origin;
    }
    const API_BASE = resolveApiBase();

    class ApiError extends Error {
        constructor(message, status, data, kind) {
            super(message);
            this.name = 'ApiError';
            this.status = status || 0;      // 0 = ติดต่อเซิร์ฟเวอร์ไม่ได้ / timeout
            this.data = data || null;       // body ที่ Backend ส่งกลับมา (ถ้าเป็น JSON)
            this.kind = kind || 'http';     // 'http' | 'network' | 'timeout'
        }
    }

    function defaultErrorMessage(status) {
        if (status === 400) return 'ข้อมูลที่ส่งไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';
        if (status === 401) return 'ไม่ได้รับอนุญาต กรุณาเข้าสู่ระบบอีกครั้ง';
        if (status === 403) return 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้';
        if (status === 404) return 'ไม่พบข้อมูล หรือ Backend ยังไม่มี API นี้ (404)';
        if (status === 409) return 'ข้อมูลซ้ำกับที่มีอยู่ในระบบ';
        if (status === 413) return 'ไฟล์มีขนาดใหญ่เกินไป';
        if (status === 429) return 'มีการเรียกใช้งานถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
        if (status >= 500) return `เซิร์ฟเวอร์เกิดข้อผิดพลาด (${status}) กรุณาลองใหม่ภายหลัง`;
        return `เกิดข้อผิดพลาด (${status})`;
    }

    /**
     * เรียก API: App.api('/cases', { query: { search: 'สมชาย' } })
     * - json: object → ส่งเป็น application/json
     * - body: FormData → ส่งเป็น multipart/form-data (ไฟล์)
     * คืนค่า body ที่เป็น JSON เมื่อสำเร็จ หรือ throw ApiError เมื่อไม่สำเร็จ
     */
    async function api(path, options) {
        const opts = options || {};
        const method = opts.method || (opts.json !== undefined || opts.body ? 'POST' : 'GET');
        let url = `${API_BASE}/api${path}`;

        if (opts.query) {
            const qs = new URLSearchParams();
            Object.entries(opts.query).forEach(([k, v]) => {
                if (v !== undefined && v !== null && String(v).trim() !== '') qs.set(k, String(v).trim());
            });
            const s = qs.toString();
            if (s) url += (url.includes('?') ? '&' : '?') + s;
        }

        const headers = { Accept: 'application/json' };
        let body = opts.body;
        if (opts.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(opts.json);
        }

        const controller = new AbortController();
        const timeoutMs = opts.timeout || 20000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        let res;
        try {
            res = await fetch(url, { method, headers, body, signal: controller.signal });
        } catch (err) {
            clearTimeout(timer);
            if (err && err.name === 'AbortError') {
                throw new ApiError('เซิร์ฟเวอร์ตอบสนองช้าเกินไป กรุณาลองใหม่อีกครั้ง', 0, null, 'timeout');
            }
            throw new ApiError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาตรวจสอบว่า Backend เปิดอยู่ แล้วลองใหม่อีกครั้ง', 0, null, 'network');
        }
        clearTimeout(timer);

        const text = await res.text().catch(() => '');
        let data = null;
        if (text) {
            try { data = JSON.parse(text); } catch (_) { data = null; }
        }

        if (!res.ok || (data && data.success === false)) {
            const message = (data && data.message) || defaultErrorMessage(res.status);
            throw new ApiError(message, res.status, data, 'http');
        }
        return data;
    }

    // ------------------------------------------------------------------
    // 2) สถานะการเข้าสู่ระบบ
    //    Backend ยังไม่มี token/session → เก็บข้อมูลผู้ใช้ที่ได้จาก /api/login ไว้ฝั่งเบราว์เซอร์
    //    และหมดอายุอัตโนมัติ (SESSION_HOURS)
    // ------------------------------------------------------------------
    const AUTH_KEY = 'thaipbs.auth';
    const SESSION_HOURS = 8;
    const ROLES = {
        admin: { label: 'เจ้าหน้าที่', icon: 'fa-user-shield' },
        relative: { label: 'ญาติผู้สูญหาย', icon: 'fa-people-roof' },
    };

    // หน้าที่แต่ละ role เข้าได้ (ใช้ตรวจ ?next= ตอน login)
    const PAGE_ROLES = {
        'Homepage.html': ['admin', 'relative'],
        'track.html': ['admin', 'relative'],
        'case-detail.html': ['admin', 'relative'],
        'add-clue.html': ['admin', 'relative'],
        'add-case.html': ['admin'],
        'dashboard.html': ['admin'],
    };
    const HOME_PAGE = 'Homepage.html';

    function storage() {
        try { return global.localStorage; } catch (_) { return null; }
    }

    function getSession() {
        const ls = storage();
        if (!ls) return null;
        try {
            const raw = ls.getItem(AUTH_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            if (!s || s.user_id === undefined || s.user_id === null || !ROLES[s.role]) return null;
            if (s.expiresAt && Date.now() > s.expiresAt) {
                clearSession();
                return null;
            }
            return s;
        } catch (_) {
            return null;
        }
    }

    function saveSession(user) {
        const s = {
            user_id: user.user_id,
            name: user.name || '',
            role: user.role,
            loginAt: Date.now(),
            expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
        };
        const ls = storage();
        if (ls) {
            ls.setItem(AUTH_KEY, JSON.stringify(s));
            // คีย์เดิมที่หน้าเก่าเคยใช้ (คงไว้เผื่อโค้ดส่วนอื่นอ่าน)
            ls.setItem('userId', String(s.user_id));
            ls.setItem('userRole', s.role);
            ls.setItem('userName', s.name);
        }
        return s;
    }

    function clearSession() {
        const ls = storage();
        if (!ls) return;
        [AUTH_KEY, 'userId', 'userRole', 'userName'].forEach(k => ls.removeItem(k));
    }

    function currentPage() {
        const last = global.location.pathname.split('/').pop();
        return last || 'login.html';
    }

    function isAllowed(page, role) {
        const roles = PAGE_ROLES[page];
        return !!roles && roles.includes(role);
    }

    // ป้องกัน open redirect: รับเฉพาะชื่อไฟล์ .html ภายในเว็บนี้
    function safeNext(next, role) {
        if (!next || !/^[A-Za-z0-9_-]+\.html(\?[^#<>"']*)?$/.test(next)) return null;
        const page = next.split('?')[0];
        return isAllowed(page, role) ? next : null;
    }

    /**
     * เรียกใน <head> ของทุกหน้าที่ต้องเข้าสู่ระบบ
     *   App.guardPage(['admin'])              → เฉพาะเจ้าหน้าที่
     *   App.guardPage(['admin', 'relative'])  → ทั้งสองแบบ
     */
    function guardPage(allowedRoles) {
        const ls = storage();
        const hadSession = !!(ls && ls.getItem(AUTH_KEY));
        const session = getSession();
        const here = currentPage() + global.location.search;
        if (!session) {
            global.location.replace(`login.html?next=${encodeURIComponent(here)}${hadSession ? '&expired=1' : ''}`);
            return null;
        }
        if (allowedRoles && !allowedRoles.includes(session.role)) {
            global.location.replace(`${HOME_PAGE}?denied=1`);
            return null;
        }
        return session;
    }

    function logout() {
        clearSession();
        global.location.href = 'login.html?logout=1';
    }

    // เติมชื่อผู้ใช้ / ซ่อนเมนูที่ role นี้ใช้ไม่ได้ / ผูกปุ่มออกจากระบบ
    function applySessionUi() {
        const session = getSession();
        document.querySelectorAll('[data-logout]').forEach(el => {
            el.addEventListener('click', (e) => { e.preventDefault(); logout(); });
        });
        if (!session) return;
        const roleInfo = ROLES[session.role];
        document.querySelectorAll('[data-auth-name]').forEach(el => {
            el.textContent = session.name || roleInfo.label;
        });
        document.querySelectorAll('[data-auth-role-label]').forEach(el => {
            el.textContent = roleInfo.label;
        });
        document.querySelectorAll('[data-role-only]').forEach(el => {
            const roles = el.getAttribute('data-role-only').split(',').map(r => r.trim());
            if (!roles.includes(session.role)) el.remove();
        });
        document.body.setAttribute('data-user-role', session.role);
    }

    // ------------------------------------------------------------------
    // 3) ตัวช่วยแสดงผล
    // ------------------------------------------------------------------
    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function textOr(value, fallback) {
        if (value === null || value === undefined) return fallback === undefined ? '-' : fallback;
        const s = String(value).trim();
        if (s === '' || s.toLowerCase() === 'null' || s === 'ไม่ระบุ') return fallback === undefined ? '-' : fallback;
        return s;
    }

    // แปลงค่าวันที่จาก SQL (ISO string) เป็น Date โดยไม่ให้ timezone ทำให้วันเลื่อน
    function toDate(value) {
        if (!value) return null;
        if (value instanceof Date) return isNaN(value) ? null : value;
        const s = String(value);
        const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z?)?$/);
        if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3]);
        const d = new Date(s);
        return isNaN(d) ? null : d;
    }

    // วันที่แบบไทย พ.ศ. เช่น "5 ก.ค. 2569" / "5 กรกฎาคม 2569"
    function formatThaiDate(value, opts) {
        const o = opts || {};
        const d = toDate(value);
        if (!d) return o.fallback === undefined ? '-' : o.fallback;
        const options = { year: 'numeric', month: o.month || 'short', day: 'numeric' };
        if (o.withTime) { options.hour = '2-digit'; options.minute = '2-digit'; }
        let s = d.toLocaleDateString('th-TH', options);
        if (o.withTime) s += ' น.';
        return s;
    }

    // คอลัมน์ TIME ของ SQL Server จะมาเป็น "1970-01-01T14:30:00.000Z"
    function formatTime(value) {
        if (!value) return '';
        const m = String(value).match(/(?:T|^)(\d{2}):(\d{2})/);
        return m ? `${m[1]}:${m[2]} น.` : '';
    }

    function thaiYear(value) {
        const d = toDate(value);
        return d ? d.getFullYear() + 543 : null;
    }

    const PLACEHOLDER_IMG = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><rect width="120" height="120" fill="#e9ecef"/>' +
        '<circle cx="60" cy="46" r="22" fill="#adb5bd"/><path d="M18 112c4-26 22-38 42-38s38 12 42 38z" fill="#adb5bd"/></svg>'
    );

    function imageUrl(url) {
        const s = textOr(url, '');
        if (!s) return PLACEHOLDER_IMG;
        if (/^(https?:|data:|blob:)/i.test(s)) return s;
        return `${API_BASE}/${s.replace(/^\/+/, '')}`;
    }

    // ใส่ใน <img onerror> เพื่อเปลี่ยนเป็นภาพแทนเมื่อโหลดรูปไม่ได้
    function imgFallbackAttr() {
        return `onerror="this.onerror=null;this.src=App.PLACEHOLDER_IMG;"`;
    }

    // สถานะเคส 7 สถานะ (ตรงกับ CASE_STATUSES ใน Backend/route/missing.route.js)
    const CASE_STATUS = {
        RECEIVED: 'รับแจ้งเหตุ',
        REVIEWING: 'กำลังตรวจสอบข้อมูล',
        SEARCHING: 'กำลังค้นหา - ประกาศโพสต์หา',
        FOUND_SAFE: 'พบเจอ - ปลอดภัย',
        FOUND_DEAD: 'พบเจอ - เสียชีวิต',
        RESUMED: 'กลับมาค้นหาอีกครั้ง',
        CLOSED: 'ปิดเคส',
    };
    const CLOSED_STATUSES = [CASE_STATUS.FOUND_SAFE, CASE_STATUS.FOUND_DEAD, CASE_STATUS.CLOSED];
    const STATUS_STYLE = {
        [CASE_STATUS.RECEIVED]: { cls: 'bg-secondary', icon: 'fa-inbox' },
        [CASE_STATUS.REVIEWING]: { cls: 'bg-info text-dark', icon: 'fa-magnifying-glass-chart' },
        [CASE_STATUS.SEARCHING]: { cls: 'bg-warning text-dark', icon: 'fa-bullhorn' },
        [CASE_STATUS.FOUND_SAFE]: { cls: 'bg-success', icon: 'fa-circle-check' },
        [CASE_STATUS.FOUND_DEAD]: { cls: 'bg-dark', icon: 'fa-ribbon' },
        [CASE_STATUS.RESUMED]: { cls: 'bg-warning text-dark', icon: 'fa-rotate-right' },
        [CASE_STATUS.CLOSED]: { cls: 'bg-secondary', icon: 'fa-folder-closed' },
    };

    function isClosedStatus(status) {
        return CLOSED_STATUSES.includes(status);
    }

    function statusBadge(status, extraCls) {
        const s = textOr(status, 'ไม่ระบุสถานะ');
        const st = STATUS_STYLE[s] || { cls: 'bg-light text-dark border', icon: 'fa-circle-question' };
        return `<span class="badge ${st.cls} ${extraCls || ''}"><i class="fa-solid ${st.icon} me-1"></i>${escapeHtml(s)}</span>`;
    }

    function priorityBadge(priority, extraCls) {
        const p = textOr(priority, 'ปกติ');
        let cls = 'bg-light text-dark border';
        if (p === 'เร่งด่วนมาก' || p === 'high') cls = 'bg-danger';
        else if (p === 'เร่งด่วน' || p === 'medium') cls = 'bg-warning text-dark';
        return `<span class="badge ${cls} ${extraCls || ''}">${escapeHtml(p)}</span>`;
    }

    function priorityRank(priority) {
        if (priority === 'เร่งด่วนมาก' || priority === 'high') return 0;
        if (priority === 'เร่งด่วน' || priority === 'medium') return 1;
        return 2;
    }

    // case_missing_reason ถูกบันทึกเป็น "1. ถูกลักพาตัว, 2. พลัดหลงออกจากบ้าน"
    function parseCauses(text) {
        const s = textOr(text, '');
        if (!s) return [];
        return s.split(',')
            .map(part => part.replace(/^\s*\d+\.\s*/, '').trim())
            .filter(Boolean);
    }

    function fullName(title, name) {
        const n = textOr(name, '');
        if (!n) return 'ไม่ระบุชื่อ';
        const t = textOr(title, '');
        return t ? `${t} ${n}` : n;
    }

    // กล่องสถานะ loading / error / empty — ใช้ได้ทั้งใน div และ <tbody> (ระบุ colspan)
    function renderState(container, type, message, opts) {
        if (!container) return;
        const o = opts || {};
        const icons = {
            loading: '<span class="spinner-border spinner-border-sm text-primary me-2" role="status" aria-hidden="true"></span>',
            error: '<i class="fa-solid fa-triangle-exclamation text-danger me-2"></i>',
            empty: '<i class="fa-regular fa-folder-open me-2"></i>',
        };
        const defaults = {
            loading: 'กำลังโหลดข้อมูล...',
            error: 'ไม่สามารถโหลดข้อมูลได้',
            empty: 'ไม่พบข้อมูล',
        };
        const retryId = 'retry-' + Math.random().toString(36).slice(2, 8);
        const retryBtn = (type === 'error' && o.onRetry)
            ? `<div class="mt-2"><button type="button" class="btn btn-sm btn-outline-primary" id="${retryId}"><i class="fa-solid fa-rotate-right me-1"></i> ลองใหม่</button></div>`
            : '';
        const inner = `<div class="state-box state-${type} ${type === 'error' ? 'text-danger' : 'text-body-secondary'}" role="${type === 'error' ? 'alert' : 'status'}">
                ${icons[type] || ''}<span>${escapeHtml(message || defaults[type])}</span>${retryBtn}
            </div>`;
        if (o.colspan) container.innerHTML = `<tr><td colspan="${o.colspan}" class="py-4">${inner}</td></tr>`;
        else if (o.col) container.innerHTML = `<div class="col-12">${inner}</div>`;
        else container.innerHTML = inner;
        if (retryBtn) {
            const btn = document.getElementById(retryId);
            if (btn) btn.addEventListener('click', o.onRetry);
        }
    }

    // ข้อความแจ้งเตือนมุมจอ (สำเร็จ / ผิดพลาด)
    function toast(message, type) {
        let host = document.getElementById('appToastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'appToastHost';
            host.className = 'toast-container position-fixed top-0 end-0 p-3';
            host.style.zIndex = '1080';
            document.body.appendChild(host);
        }
        const t = type || 'success';
        const cls = { success: 'text-bg-success', danger: 'text-bg-danger', warning: 'text-bg-warning', info: 'text-bg-primary' }[t] || 'text-bg-primary';
        const icon = { success: 'fa-circle-check', danger: 'fa-triangle-exclamation', warning: 'fa-circle-exclamation', info: 'fa-circle-info' }[t] || 'fa-circle-info';
        const el = document.createElement('div');
        el.className = `toast align-items-center border-0 ${cls}`;
        el.setAttribute('role', t === 'danger' ? 'alert' : 'status');
        el.innerHTML = `<div class="d-flex"><div class="toast-body"><i class="fa-solid ${icon} me-2"></i>${escapeHtml(message)}</div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="ปิด"></button></div>`;
        host.appendChild(el);
        if (global.bootstrap && global.bootstrap.Toast) {
            const inst = global.bootstrap.Toast.getOrCreateInstance(el, { delay: 4500 });
            el.addEventListener('hidden.bs.toast', () => el.remove());
            inst.show();
        } else {
            el.classList.add('show');
            setTimeout(() => el.remove(), 4500);
        }
    }

    function debounce(fn, ms) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), ms);
        };
    }

    // ------------------------------------------------------------------
    // 4) รูปแบบข้อมูลที่ใช้ร่วมกัน (เบอร์โทร / เลขบัตรประชาชน)
    // ------------------------------------------------------------------
    // ตรงกับ normalizeThaiPhone ใน Backend/route/auth.js: 0[689]X-XXX-XXXX
    const PHONE_PATTERN = /^0[689]\d-\d{3}-\d{4}$/;

    function formatPhoneInput(value) {
        const v = String(value || '').replace(/\D/g, '').substring(0, 10);
        if (v.length > 6) return `${v.substring(0, 3)}-${v.substring(3, 6)}-${v.substring(6)}`;
        if (v.length > 3) return `${v.substring(0, 3)}-${v.substring(3)}`;
        return v;
    }

    function formatThaiIdInput(value) {
        const v = String(value || '').replace(/\D/g, '').substring(0, 13);
        const m = v.match(/^(\d{0,1})(\d{0,4})(\d{0,5})(\d{0,2})(\d{0,1})$/);
        return m ? [m[1], m[2], m[3], m[4], m[5]].filter(Boolean).join('-') : v;
    }

    function digitsOnly(value) {
        return String(value || '').replace(/\D/g, '');
    }

    // ทำให้ช่อง input จัดรูปแบบอัตโนมัติขณะพิมพ์ โดยไม่ให้เคอร์เซอร์กระโดดไปท้ายสุด
    function attachFormatter(input, formatter) {
        if (!input) return;
        input.addEventListener('input', () => {
            const before = input.value;
            const caret = input.selectionStart;
            const digitsBeforeCaret = digitsOnly(before.slice(0, caret)).length;
            const after = formatter(before);
            if (after === before) return;
            input.value = after;
            let pos = 0, seen = 0;
            while (pos < after.length && seen < digitsBeforeCaret) {
                if (/\d/.test(after[pos])) seen++;
                pos++;
            }
            try { input.setSelectionRange(pos, pos); } catch (_) { /* type ที่ไม่รองรับ */ }
        });
    }

    document.addEventListener('DOMContentLoaded', applySessionUi);

    global.App = {
        API_BASE,
        ApiError,
        api,
        // auth
        ROLES, PAGE_ROLES, HOME_PAGE,
        getSession, saveSession, clearSession, guardPage, logout, isAllowed, safeNext,
        // ui
        escapeHtml, textOr, toDate, formatThaiDate, formatTime, thaiYear,
        PLACEHOLDER_IMG, imageUrl, imgFallbackAttr,
        CASE_STATUS, CLOSED_STATUSES, isClosedStatus, statusBadge, priorityBadge, priorityRank,
        parseCauses, fullName, renderState, toast, debounce,
        // formats
        PHONE_PATTERN, formatPhoneInput, formatThaiIdInput, digitsOnly, attachFormatter,
    };
})(window);
