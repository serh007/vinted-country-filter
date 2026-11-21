// ==UserScript==
// @name         Vinted Country Badge & Filter
// @namespace    https://github.com/
// @version      1.4.0
// @description  Displays seller country badges and full item titles on Vinted cards, and lets you filter items by country across all Vinted domains (React Fiber + /api/v2/users, no captcha or login required)
// @license      MIT
// @match        https://www.vinted.lt/*
// @match        https://www.vinted.pl/*
// @match        https://www.vinted.fr/*
// @match        https://www.vinted.de/*
// @match        https://www.vinted.nl/*
// @match        https://www.vinted.be/*
// @match        https://www.vinted.es/*
// @match        https://www.vinted.it/*
// @match        https://www.vinted.pt/*
// @match        https://www.vinted.at/*
// @match        https://www.vinted.lu/*
// @match        https://www.vinted.se/*
// @match        https://www.vinted.dk/*
// @match        https://www.vinted.fi/*
// @match        https://www.vinted.cz/*
// @match        https://www.vinted.sk/*
// @match        https://www.vinted.hu/*
// @match        https://www.vinted.ro/*
// @match        https://www.vinted.bg/*
// @match        https://www.vinted.hr/*
// @match        https://www.vinted.si/*
// @match        https://www.vinted.gr/*
// @match        https://www.vinted.ie/*
// @match        https://www.vinted.co.uk/*
// @match        https://www.vinted.com/*
// @match        https://www.vinted.com.au/*
// @grant        none
// @run-at       document-end
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // Skip non-UI internal paths
    if (location.pathname.startsWith('/api/') || location.pathname.startsWith('/cdn-cgi/')) {
        return;
    }

    /* =========================
       Configuration
    ========================== */
    const CONFIG = {
        // UI & country name locale: 'en' (English), 'lt' (Lithuanian), 'uk' (Ukrainian), or 'auto' (site language)
        DISPLAY_LOCALE: 'en',
        // Show full item title on cards (enabled by default; can be toggled in the settings popover)
        SHOW_FULL_TITLE: true,
        // Also display seller city on item badges (e.g. "Lithuania · Vilnius")
        SHOW_CITY: false,
        // Use 2-letter ISO code instead of full country name on badges (true -> "LT", false -> "Lithuania")
        SHORT_CODE: false,
        // Highlight sellers from the current Vinted domain's local country in green
        HIGHLIGHT_LOCAL: true,
        // Show compact bottom country filter bar
        SHOW_FILTER_BAR: true,
        // 'auto' picks regional countries for the current domain, or pass an explicit array like ['LT', 'LV', 'EE']
        DEFAULT_FILTER_COUNTRIES: 'auto',
        // Gentle mode: 1 request at a time to minimize rate-limit (429) hits
        CONCURRENCY: 1,
        // Base delay between requests (ms)
        REQUEST_DELAY_MS: 800,
        // Random jitter added to delay (0..N ms) for natural pacing (800-1200 ms)
        REQUEST_JITTER_MS: 400,
        // Preload cards slightly before they enter the viewport (when filter is off)
        VIEWPORT_MARGIN: '300px 0px',
        // Number of days to cache a seller's country in localStorage
        CACHE_TTL_DAYS: 14,
        // Maximum number of sellers kept in the localStorage LRU cache
        CACHE_MAX_USERS: 5000,
    };

    function detectLocalCountryIso() {
        const host = location.hostname.toLowerCase();
        if (host.endsWith('.co.uk')) return 'GB';
        if (host.endsWith('.com.au')) return 'AU';
        if (host.endsWith('.com')) return 'US';
        const parts = host.split('.');
        const tld = parts[parts.length - 1] || '';
        return tld.length === 2 ? tld.toUpperCase() : '';
    }

    function getDefaultFilterCountries(localIso) {
        if (Array.isArray(CONFIG.DEFAULT_FILTER_COUNTRIES)) {
            return CONFIG.DEFAULT_FILTER_COUNTRIES;
        }
        const clusters = [
            ['LT', 'LV', 'EE', 'PL', 'FI', 'SE', 'DK'],
            ['FR', 'BE', 'NL', 'DE', 'IT', 'ES', 'PT', 'AT', 'LU'],
            ['CZ', 'SK', 'PL', 'HU', 'RO', 'BG', 'HR', 'SI', 'GR'],
            ['GB', 'IE'],
        ];
        const match = clusters.find((group) => group.includes(localIso));
        if (match) return match;
        return localIso ? [localIso] : [];
    }

    const LOCAL_COUNTRY_ISO = detectLocalCountryIso();
    const DEFAULT_COUNTRIES = getDefaultFilterCountries(LOCAL_COUNTRY_ISO);
    const CACHE_STORAGE_KEY = 'vlt_seller_country_cache_v1';
    const FILTER_STORAGE_KEY = 'vlt_country_filter_state_v1';
    const CACHE_TTL_MS = CONFIG.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
    const CARD_LINK_SELECTOR = 'a[data-testid$="--overlay-link"][href*="/items/"], a[class*="new-item-box__overlay"][href*="/items/"]';

    /* =========================
       Inline SVG flags (render consistently on Windows, Linux, and macOS)
    ========================== */
    const SVG_FLAGS = {
        LT: '<rect width="18" height="4" fill="#FDB913"/><rect y="4" width="18" height="4" fill="#006A44"/><rect y="8" width="18" height="4" fill="#C1272D"/>',
        LV: '<rect width="18" height="12" fill="#9E3039"/><rect y="4.8" width="18" height="2.4" fill="#FFF"/>',
        EE: '<rect width="18" height="4" fill="#0072CE"/><rect y="4" width="18" height="4" fill="#111"/><rect y="8" width="18" height="4" fill="#FFF"/>',
        PL: '<rect width="18" height="6" fill="#FFF"/><rect y="6" width="18" height="6" fill="#DC143C"/>',
        FI: '<rect width="18" height="12" fill="#FFF"/><rect x="5" width="3.2" height="12" fill="#003580"/><rect y="4.4" width="18" height="3.2" fill="#003580"/>',
        SE: '<rect width="18" height="12" fill="#006AA7"/><rect x="5" width="2.8" height="12" fill="#FECC02"/><rect y="4.6" width="18" height="2.8" fill="#FECC02"/>',
        DK: '<rect width="18" height="12" fill="#C8102E"/><rect x="5" width="2.4" height="12" fill="#FFF"/><rect y="4.8" width="18" height="2.4" fill="#FFF"/>',
        NO: '<rect width="18" height="12" fill="#BA0C2F"/><rect x="4.5" width="3.6" height="12" fill="#FFF"/><rect y="4.2" width="18" height="3.6" fill="#FFF"/><rect x="5.4" width="1.8" height="12" fill="#00205B"/><rect y="5.1" width="18" height="1.8" fill="#00205B"/>',
        DE: '<rect width="18" height="4" fill="#111"/><rect y="4" width="18" height="4" fill="#DD0000"/><rect y="8" width="18" height="4" fill="#FFCE00"/>',
        FR: '<rect width="6" height="12" fill="#002395"/><rect x="6" width="6" height="12" fill="#FFF"/><rect x="12" width="6" height="12" fill="#ED2939"/>',
        NL: '<rect width="18" height="4" fill="#AE1C28"/><rect y="4" width="18" height="4" fill="#FFF"/><rect y="8" width="18" height="4" fill="#21468B"/>',
        BE: '<rect width="6" height="12" fill="#111"/><rect x="6" width="6" height="12" fill="#FDDA24"/><rect x="12" width="6" height="12" fill="#EF3340"/>',
        LU: '<rect width="18" height="4" fill="#ED2939"/><rect y="4" width="18" height="4" fill="#FFF"/><rect y="8" width="18" height="4" fill="#00A1DE"/>',
        IT: '<rect width="6" height="12" fill="#009246"/><rect x="6" width="6" height="12" fill="#FFF"/><rect x="12" width="6" height="12" fill="#CE2B37"/>',
        ES: '<rect width="18" height="12" fill="#AA151B"/><rect y="3" width="18" height="6" fill="#F1BF00"/>',
        PT: '<rect width="7" height="12" fill="#006600"/><rect x="7" width="11" height="12" fill="#FF0000"/>',
        AT: '<rect width="18" height="4" fill="#ED2939"/><rect y="4" width="18" height="4" fill="#FFF"/><rect y="8" width="18" height="4" fill="#ED2939"/>',
        CZ: '<rect width="18" height="6" fill="#FFF"/><rect y="6" width="18" height="6" fill="#D7141A"/><polygon points="0,0 8.5,6 0,12" fill="#11457E"/>',
        SK: '<rect width="18" height="4" fill="#FFF"/><rect y="4" width="18" height="4" fill="#0B4EA2"/><rect y="8" width="18" height="4" fill="#EE1C25"/>',
        HU: '<rect width="18" height="4" fill="#CE2939"/><rect y="4" width="18" height="4" fill="#FFF"/><rect y="8" width="18" height="4" fill="#477050"/>',
        RO: '<rect width="6" height="12" fill="#002B7F"/><rect x="6" width="6" height="12" fill="#FCD116"/><rect x="12" width="6" height="12" fill="#CE1126"/>',
        BG: '<rect width="18" height="4" fill="#FFF"/><rect y="4" width="18" height="4" fill="#00966E"/><rect y="8" width="18" height="4" fill="#D62612"/>',
        IE: '<rect width="6" height="12" fill="#169B62"/><rect x="6" width="6" height="12" fill="#FFF"/><rect x="12" width="6" height="12" fill="#FF883E"/>',
        UA: '<rect width="18" height="6" fill="#005BBB"/><rect y="6" width="18" height="6" fill="#FFD500"/>',
        HR: '<rect width="18" height="4" fill="#FF0000"/><rect y="4" width="18" height="4" fill="#FFF"/><rect y="8" width="18" height="4" fill="#171796"/>',
        SI: '<rect width="18" height="4" fill="#FFF"/><rect y="4" width="18" height="4" fill="#005CE6"/><rect y="8" width="18" height="4" fill="#ED1C24"/>',
        GR: '<rect width="18" height="12" fill="#0D5EAF"/><rect y="1.4" width="18" height="1.3" fill="#FFF"/><rect y="4.1" width="18" height="1.3" fill="#FFF"/><rect y="6.8" width="18" height="1.3" fill="#FFF"/><rect y="9.5" width="18" height="1.3" fill="#FFF"/><rect width="7" height="6.8" fill="#0D5EAF"/><rect x="2.8" width="1.4" height="6.8" fill="#FFF"/><rect y="2.7" width="7" height="1.4" fill="#FFF"/>',
        GB: '<rect width="18" height="12" fill="#012169"/><path d="M0,0 L18,12 M18,0 L0,12" stroke="#FFF" stroke-width="2.2"/><path d="M0,0 L18,12 M18,0 L0,12" stroke="#C8102E" stroke-width="1"/><path d="M9,0 V12 M0,6 H18" stroke="#FFF" stroke-width="3.6"/><path d="M9,0 V12 M0,6 H18" stroke="#C8102E" stroke-width="2"/>',
        US: '<rect width="18" height="12" fill="#B22234"/><rect y="1.7" width="18" height="1.7" fill="#FFF"/><rect y="5.1" width="18" height="1.7" fill="#FFF"/><rect y="8.5" width="18" height="1.7" fill="#FFF"/><rect width="8" height="6.8" fill="#3C3B6E"/>',
        AU: '<rect width="18" height="12" fill="#00008B"/><path d="M0,0 L8,6 M8,0 L0,6" stroke="#FFF" stroke-width="1.2"/><path d="M4,0 V6 M0,3 H8" stroke="#FFF" stroke-width="1.8"/><path d="M4,0 V6 M0,3 H8" stroke="#FF0000" stroke-width="1"/><circle cx="13.5" cy="4" r="1" fill="#FFF"/><circle cx="11.5" cy="8" r="0.9" fill="#FFF"/><circle cx="15" cy="8.5" r="0.9" fill="#FFF"/>',
    };

    function isoToEmoji(iso) {
        if (!iso || iso.length !== 2) return '🌍';
        const code = iso.toUpperCase();
        return String.fromCodePoint(
            0x1F1E6 + code.charCodeAt(0) - 65,
            0x1F1E6 + code.charCodeAt(1) - 65
        );
    }

    function createFlagNode(iso) {
        const code = (iso || '').toUpperCase();
        const shapes = SVG_FLAGS[code];
        if (shapes) {
            const wrap = document.createElement('span');
            wrap.className = 'vlt-flag-wrap';
            wrap.innerHTML = `<svg viewBox="0 0 18 12" width="15" height="10" aria-hidden="true">${shapes}</svg>`;
            return wrap;
        }
        const emoji = document.createElement('span');
        emoji.className = 'vlt-flag-emoji';
        emoji.textContent = isoToEmoji(code);
        return emoji;
    }

    let cachedRegionFormatter = null;
    let cachedRegionLocale = null;

    function getTargetLocale() {
        return CONFIG.DISPLAY_LOCALE === 'auto'
            ? (document.documentElement.lang || 'lt-LT')
            : CONFIG.DISPLAY_LOCALE;
    }

    function getCountryLabel(iso, fallbackTitle, forceFullName = false) {
        const code = (iso || '').toUpperCase();
        if (!forceFullName && CONFIG.SHORT_CODE && code) {
            return code;
        }
        if (code && typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function') {
            const targetLocale = getTargetLocale();
            if (cachedRegionLocale !== targetLocale) {
                try {
                    cachedRegionFormatter = new Intl.DisplayNames([targetLocale], { type: 'region' });
                    cachedRegionLocale = targetLocale;
                } catch {
                    cachedRegionFormatter = null;
                }
            }
            if (cachedRegionFormatter) {
                try {
                    const localized = cachedRegionFormatter.of(code);
                    if (localized && localized !== code) {
                        return localized;
                    }
                } catch {
                    // fallback below
                }
            }
        }
        return fallbackTitle || code || '?';
    }

    function getUiStrings() {
        const lang = getTargetLocale().toLowerCase();
        if (lang.startsWith('uk')) {
            return {
                all: 'Усі',
                modeHide: 'Приховувати інші країни',
                modeDim: 'Затемнювати інші країни',
                collapse: 'Згорнути панель',
                expand: 'Фільтр країн',
                multiHint: 'Клік — тільки ця країна · Ctrl+клік — кілька країн',
                settings: 'Налаштування',
                showFullTitle: 'Показувати повну назву товару',
                showCity: 'Показувати місто продавця',
            };
        }
        if (lang.startsWith('en')) {
            return {
                all: 'All',
                modeHide: 'Hide non-matching items',
                modeDim: 'Dim non-matching items',
                collapse: 'Minimize bar',
                expand: 'Country filter',
                multiHint: 'Click — only this country · Ctrl+click — multiple countries',
                settings: 'Settings',
                showFullTitle: 'Show full item title',
                showCity: 'Show seller city on badges',
            };
        }
        return {
            all: 'Visos',
            modeHide: 'Slėpti kitas šalis',
            modeDim: 'Pritemdyti kitas šalis',
            collapse: 'Sutraukti juostą',
            expand: 'Šalies filtras',
            multiHint: 'Paspaudimas — tik ši šalis · Ctrl+paspaudimas — kelios šalys',
            settings: 'Nustatymai',
            showFullTitle: 'Rodyti visą prekės pavadinimą',
            showCity: 'Rodyti pardavėjo miestą',
        };
    }

    /* =========================
       Filter & display state (persisted across pages)
    ========================== */
    const filterState = {
        selected: new Set(), // empty = show all countries
        mode: 'hide',        // 'hide' (remove from grid) | 'dim' (fade out)
        collapsed: false,
        showFullTitle: CONFIG.SHOW_FULL_TITLE,
        showCity: CONFIG.SHOW_CITY,
    };

    function loadFilterState() {
        try {
            const raw = localStorage.getItem(FILTER_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed.selected)) {
                parsed.selected.forEach((c) => {
                    if (typeof c === 'string' && c.length === 2) {
                        filterState.selected.add(c.toUpperCase());
                    }
                });
            }
            if (parsed.mode === 'hide' || parsed.mode === 'dim') {
                filterState.mode = parsed.mode;
            }
            if (typeof parsed.collapsed === 'boolean') {
                filterState.collapsed = parsed.collapsed;
            }
            if (typeof parsed.showFullTitle === 'boolean') {
                filterState.showFullTitle = parsed.showFullTitle;
            }
            if (typeof parsed.showCity === 'boolean') {
                filterState.showCity = parsed.showCity;
            }
        } catch {
            // Ignore corrupted state
        }
    }

    function saveFilterState() {
        try {
            localStorage.setItem(
                FILTER_STORAGE_KEY,
                JSON.stringify({
                    selected: Array.from(filterState.selected),
                    mode: filterState.mode,
                    collapsed: filterState.collapsed,
                    showFullTitle: filterState.showFullTitle,
                    showCity: filterState.showCity,
                })
            );
        } catch {
            // Ignore storage quota errors
        }
    }

    function isFilterActive() {
        return filterState.selected.size > 0;
    }

    /* =========================
       Compact seller LRU cache in localStorage
       Entry format: [iso, fallbackName, city, savedAtUnixSec]
    ========================== */
    const sellerCache = new Map();
    const deadSellers = new Set(); // 404/deleted sellers for this session
    let saveTimer = null;

    function loadCache() {
        try {
            const raw = localStorage.getItem(CACHE_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            const cutoffSec = Math.floor((Date.now() - CACHE_TTL_MS) / 1000);
            for (const [uid, entry] of Object.entries(parsed)) {
                if (!Array.isArray(entry) || entry.length < 4) continue;
                const [iso, name, city, ts] = entry;
                if (typeof ts !== 'number' || ts < cutoffSec || !iso) continue;
                sellerCache.set(uid, { iso, name: name || '', city: city || '', ts });
            }
        } catch {
            // Ignore corrupted cache
        }
    }

    function scheduleCacheSave() {
        if (saveTimer) return;
        saveTimer = setTimeout(flushCache, 1500);
    }

    function flushCache() {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        try {
            while (sellerCache.size > CONFIG.CACHE_MAX_USERS) {
                const oldestKey = sellerCache.keys().next().value;
                sellerCache.delete(oldestKey);
            }
            const obj = {};
            for (const [uid, v] of sellerCache.entries()) {
                obj[uid] = [v.iso, v.name, v.city, v.ts];
            }
            localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
        } catch {
            try {
                const keep = Math.floor(sellerCache.size / 2);
                while (sellerCache.size > keep) {
                    const oldestKey = sellerCache.keys().next().value;
                    sellerCache.delete(oldestKey);
                }
                const obj = {};
                for (const [uid, v] of sellerCache.entries()) {
                    obj[uid] = [v.iso, v.name, v.city, v.ts];
                }
                localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(obj));
            } catch {
                // Fall back to in-memory cache only
            }
        }
    }

    function cacheGet(uid) {
        const val = sellerCache.get(uid);
        if (!val) return null;
        const nowSec = Math.floor(Date.now() / 1000);
        if ((nowSec - val.ts) * 1000 > CACHE_TTL_MS) {
            sellerCache.delete(uid);
            return null;
        }
        // LRU: move entry to the end of the Map
        sellerCache.delete(uid);
        sellerCache.set(uid, val);
        return val;
    }

    function cacheSet(uid, data) {
        sellerCache.delete(uid);
        sellerCache.set(uid, {
            iso: data.iso,
            name: data.name || '',
            city: data.city || '',
            ts: Math.floor(Date.now() / 1000),
        });
        scheduleCacheSave();
    }

    /* =========================
       Badge & filter bar styles
    ========================== */
    function injectStyles() {
        if (document.getElementById('vlt-country-badge-styles')) return;
        const style = document.createElement('style');
        style.id = 'vlt-country-badge-styles';
        style.textContent = `
            .vlt-country-badge {
                position: absolute;
                top: 8px;
                left: 8px;
                z-index: 4;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                max-width: calc(100% - 16px);
                padding: 3px 7px;
                border-radius: 6px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif;
                font-size: 11px;
                font-weight: 600;
                line-height: 1.25;
                letter-spacing: 0.01em;
                color: #ffffff;
                background: rgba(18, 22, 29, 0.78);
                border: 1px solid rgba(255, 255, 255, 0.16);
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                pointer-events: none;
                user-select: none;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                animation: vltBadgeFadeIn 0.16s ease-out;
            }
            .vlt-country-badge--local {
                background: rgba(17, 118, 69, 0.88);
                border-color: rgba(255, 255, 255, 0.24);
            }
            .vlt-flag-wrap {
                display: inline-flex;
                align-items: center;
                flex-shrink: 0;
                border-radius: 2px;
                overflow: hidden;
                box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.28);
            }
            .vlt-flag-wrap svg {
                display: block;
            }
            .vlt-flag-emoji {
                font-size: 12px;
                line-height: 1;
                flex-shrink: 0;
            }
            .vlt-country-text {
                overflow: hidden;
                text-overflow: ellipsis;
            }
            @keyframes vltBadgeFadeIn {
                from { opacity: 0; transform: translateY(-2px); }
                to   { opacity: 1; transform: translateY(0); }
            }

            /* Card filter states */
            .vlt-filtered-hide {
                display: none !important;
            }
            .vlt-filtered-dim {
                opacity: 0.14 !important;
                filter: grayscale(100%) !important;
                transition: opacity 0.2s ease, filter 0.2s ease;
            }
            .vlt-filtered-pending {
                opacity: 0.45;
                transition: opacity 0.2s ease;
            }

            /* Compact floating bottom filter bar (mounted outside React DOM) */
            #vlt-filter-bar {
                position: fixed;
                bottom: 16px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 99990;
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                justify-content: center;
                gap: 6px;
                max-width: calc(100vw - 24px);
                padding: 7px 10px;
                border-radius: 999px;
                background: rgba(255, 255, 255, 0.94);
                border: 1px solid rgba(0, 119, 130, 0.28);
                box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16), 0 1px 3px rgba(0, 0, 0, 0.08);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif;
                font-size: 12px;
                color: #1a202c;
                user-select: none;
            }
            #vlt-filter-bar.vlt-bar-hidden {
                display: none !important;
            }
            #vlt-filter-bar.vlt-bar-collapsed {
                left: auto;
                right: 16px;
                transform: none;
                padding: 6px 10px;
            }
            .vlt-chip {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                height: 28px;
                padding: 0 10px;
                border-radius: 999px;
                border: 1px solid rgba(0, 0, 0, 0.12);
                background: #ffffff;
                color: #24292f;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
                white-space: nowrap;
            }
            .vlt-chip:hover {
                border-color: #007782;
                background: #f0f9fa;
            }
            .vlt-chip:active {
                transform: scale(0.97);
            }
            .vlt-chip.vlt-chip-active {
                background: #007782;
                border-color: #007782;
                color: #ffffff;
            }
            .vlt-chip.vlt-chip-active.vlt-chip-local {
                background: #117645;
                border-color: #117645;
            }
            .vlt-chip-count {
                font-size: 11px;
                font-weight: 600;
                opacity: 0.72;
            }
            .vlt-chip.vlt-chip-active .vlt-chip-count {
                opacity: 0.92;
            }
            .vlt-bar-divider {
                width: 1px;
                height: 18px;
                background: rgba(0, 0, 0, 0.12);
                margin: 0 2px;
            }
            .vlt-bar-progress {
                font-size: 11px;
                font-weight: 600;
                color: #007782;
                padding: 0 4px;
                white-space: nowrap;
            }
            .vlt-icon-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                padding: 0;
                border-radius: 999px;
                border: 1px solid rgba(0, 0, 0, 0.12);
                background: #ffffff;
                color: #444;
                font-size: 13px;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
            }
            .vlt-icon-btn:hover,
            .vlt-icon-btn.vlt-icon-btn-active {
                border-color: #007782;
                background: #f0f9fa;
                color: #007782;
            }

            /* Full item title displayed on cards */
            .vlt-full-title {
                font-size: 12px;
                font-weight: 600;
                line-height: 1.32;
                color: #151920;
                margin-bottom: 3px;
                white-space: normal;
                word-break: break-word;
                overflow-wrap: anywhere;
            }

            /* Settings popover above filter bar */
            #vlt-settings-popover {
                position: fixed;
                bottom: 68px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 99991;
                min-width: 240px;
                padding: 10px 14px;
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.97);
                border: 1px solid rgba(0, 119, 130, 0.28);
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Inter, sans-serif;
                font-size: 12.5px;
                color: #1a202c;
                display: flex;
                flex-direction: column;
                gap: 8px;
                user-select: none;
            }
            #vlt-settings-popover.vlt-popover-hidden {
                display: none !important;
            }
            .vlt-settings-title {
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                color: #007782;
                margin-bottom: 2px;
            }
            .vlt-setting-row {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                padding: 2px 0;
            }
            .vlt-setting-row input[type="checkbox"] {
                width: 15px;
                height: 15px;
                accent-color: #007782;
                cursor: pointer;
                margin: 0;
            }
        `;
        document.head.appendChild(style);
    }

    /* =========================
       Seller userId & item title extraction via React Fiber (0 network requests)
    ========================== */
    function extractItemMetaFromElement(el) {
        if (!el) return { uid: null, title: '' };
        let fiberKey = null;
        const keys = Object.keys(el);
        for (let i = 0; i < keys.length; i++) {
            if (keys[i].startsWith('__reactFiber$')) {
                fiberKey = keys[i];
                break;
            }
        }
        let cur = fiberKey ? el[fiberKey] : null;
        let uid = null;
        let title = '';
        for (let depth = 0; depth < 25 && cur; depth++) {
            const p = cur.memoizedProps;
            if (p) {
                if (!uid) {
                    const foundUid =
                        p.item?.user?.id ||
                        p.item?.user_id ||
                        p.productItem?.user?.id ||
                        p.user?.id ||
                        p.catalogTracking?.ownerId ||
                        p.tracking?.ownerId ||
                        p.ownerId;
                    if (foundUid) uid = String(foundUid);
                }
                if (!title) {
                    const foundTitle =
                        p.item?.title ||
                        p.productItem?.title ||
                        p.itemTitle;
                    if (typeof foundTitle === 'string' && foundTitle.trim()) {
                        title = foundTitle.trim();
                    }
                }
                if (uid && title) break;
            }
            cur = cur.return;
        }
        if (!title && el.title) {
            title = el.title.split(',')[0].trim();
        }
        return { uid, title };
    }

    function extractUserIdFromElement(el) {
        return extractItemMetaFromElement(el).uid;
    }

    function getFilterTarget(container, uid) {
        const gridItem =
            container.closest('[data-testid="grid-item"]') ||
            container.closest('[class*="feed-grid__item"]');
        if (gridItem) {
            // Regular catalog cell (1 item): hide the grid cell so matching items reflow with no gaps
            const isFullRow = gridItem.className && gridItem.className.includes('full-row');
            if (!isFullRow) return gridItem;

            // For full-row blocks (e.g. promoted closet), hide the whole block only if all cards share one seller
            const links = gridItem.querySelectorAll(CARD_LINK_SELECTOR);
            let singleSeller = links.length > 0;
            for (let i = 0; i < links.length && singleSeller; i++) {
                const otherUid = extractUserIdFromElement(links[i]);
                if (otherUid && otherUid !== uid) {
                    singleSeller = false;
                }
            }
            if (singleSeller) return gridItem;
        }
        return container.closest('[class*="new-item-box__container"]') || container;
    }

    /* =========================
       Card registry, badge rendering, and filter application
    ========================== */
    // container -> { uid, title, iso, filterTarget }
    const trackedCards = new Map();
    // userId -> Set<HTMLElement> (all cards by this seller on the current page)
    const sellerCards = new Map();
    // Currently visible cards (tracked by IntersectionObserver)
    const visibleCards = new Set();
    // Queue of unique userIds to fetch (Set preserves insertion order)
    const fetchQueue = new Set();
    // In-flight userId requests to prevent duplicate calls
    const inFlight = new Set();

    let activeWorkers = 0;
    let backoffMs = 0;
    let pausedUntil = 0;
    let resumeTimer = null;

    function renderFullTitle(container, title) {
        if (!container || !container.isConnected) return;
        const box = container.closest('[class*="new-item-box__container"]') || container.parentElement;
        if (!box) return;

        const existing = box.querySelector('.vlt-full-title');
        if (!filterState.showFullTitle || !title) {
            if (existing) existing.remove();
            return;
        }

        if (existing) {
            if (existing.textContent !== title) {
                existing.textContent = title;
            }
            return;
        }

        const descContent =
            box.querySelector('[data-testid$="--description--content"]') ||
            box.querySelector('[data-testid$="--description"]');
        if (!descContent) return;

        const titleEl = document.createElement('div');
        titleEl.className = 'vlt-full-title';
        titleEl.textContent = title;
        descContent.prepend(titleEl);
    }

    function applyFullTitleToAllCards() {
        for (const [container, rec] of trackedCards.entries()) {
            if (!container.isConnected) {
                cleanupCard(container);
                continue;
            }
            renderFullTitle(container, rec.title);
        }
    }

    function reRenderAllBadges() {
        for (const [container, rec] of trackedCards.entries()) {
            if (!container.isConnected) {
                cleanupCard(container);
                continue;
            }
            const cached = cacheGet(rec.uid);
            if (cached) {
                renderBadge(container, rec.uid, cached, true);
            }
        }
    }

    function renderBadge(container, uid, info, force = false) {
        if (!container || !container.isConnected || !info || !info.iso) return;
        if (container.dataset.vltUid && container.dataset.vltUid !== uid) return;

        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }

        const showCity = filterState.showCity ? '1' : '0';
        let badge = container.querySelector(':scope > .vlt-country-badge');
        if (!force && badge && badge.dataset.uid === uid && badge.dataset.iso === info.iso && badge.dataset.city === showCity) {
            return;
        }

        if (!badge) {
            badge = document.createElement('div');
            container.appendChild(badge);
        }

        const iso = info.iso.toUpperCase();
        const isLocal = CONFIG.HIGHLIGHT_LOCAL && iso === LOCAL_COUNTRY_ISO;
        badge.className = isLocal
            ? 'vlt-country-badge vlt-country-badge--local'
            : 'vlt-country-badge';
        badge.dataset.uid = uid;
        badge.dataset.iso = iso;
        badge.dataset.city = showCity;

        const countryLabel = getCountryLabel(iso, info.name);
        const text = filterState.showCity && info.city
            ? `${countryLabel} · ${info.city}`
            : countryLabel;

        badge.textContent = '';
        badge.appendChild(createFlagNode(iso));
        const textSpan = document.createElement('span');
        textSpan.className = 'vlt-country-text';
        textSpan.textContent = text;
        badge.appendChild(textSpan);
    }

    function applyFilterToCard(record) {
        const target = record.filterTarget;
        if (!target || !target.isConnected) return;

        target.classList.remove('vlt-filtered-hide', 'vlt-filtered-dim', 'vlt-filtered-pending');

        if (!isFilterActive()) {
            return;
        }

        if (!record.iso) {
            // Country not yet resolved — softly dim while scanning
            target.classList.add('vlt-filtered-pending');
            return;
        }

        const matches = filterState.selected.has(record.iso);
        if (!matches) {
            target.classList.add(filterState.mode === 'hide' ? 'vlt-filtered-hide' : 'vlt-filtered-dim');
        }
    }

    function applyFilterToAllCards() {
        for (const [container, record] of trackedCards.entries()) {
            if (!container.isConnected) {
                cleanupCard(container);
                continue;
            }
            applyFilterToCard(record);
        }
        // When a filter is active, queue all remaining unresolved cards on the current page
        if (isFilterActive()) {
            enqueueAllUnresolvedCards();
        }
        scheduleBarRender();
    }

    function cleanupCard(container) {
        const rec = trackedCards.get(container);
        if (rec) {
            const set = sellerCards.get(rec.uid);
            if (set) {
                set.delete(container);
                if (set.size === 0) sellerCards.delete(rec.uid);
            }
            trackedCards.delete(container);
        }
        visibleCards.delete(container);
    }

    function registerCard(container, uid, title) {
        const prev = trackedCards.get(container);
        if (prev && prev.uid === uid) {
            if (title && prev.title !== title) prev.title = title;
            return prev;
        }

        if (prev && prev.uid !== uid) {
            const prevSet = sellerCards.get(prev.uid);
            if (prevSet) {
                prevSet.delete(container);
                if (prevSet.size === 0) sellerCards.delete(prev.uid);
            }
            const oldBadge = container.querySelector(':scope > .vlt-country-badge');
            if (oldBadge) oldBadge.remove();
        }

        container.dataset.vltUid = uid;
        const record = {
            uid,
            title: title || '',
            iso: '',
            filterTarget: getFilterTarget(container, uid),
        };
        trackedCards.set(container, record);

        let set = sellerCards.get(uid);
        if (!set) {
            set = new Set();
            sellerCards.set(uid, set);
        }
        set.add(container);
        return record;
    }

    function hasConnectedCard(uid, requireVisible) {
        const set = sellerCards.get(uid);
        if (!set) return false;
        for (const el of set) {
            if (!el.isConnected) {
                cleanupCard(el);
                continue;
            }
            if (el.dataset.vltUid !== uid) continue;
            if (!requireVisible || visibleCards.has(el)) {
                return true;
            }
        }
        if (set.size === 0) sellerCards.delete(uid);
        return false;
    }

    function applySellerToCards(uid, info) {
        const set = sellerCards.get(uid);
        if (!set) return;
        const iso = info.iso.toUpperCase();
        for (const el of set) {
            if (!el.isConnected) {
                cleanupCard(el);
                continue;
            }
            if (el.dataset.vltUid !== uid) continue;
            const rec = trackedCards.get(el);
            if (rec) {
                rec.iso = iso;
            }
            renderBadge(el, uid, info);
            if (rec) applyFilterToCard(rec);
        }
        scheduleBarRender();
    }

    function enqueueSeller(uid, prioritize = false) {
        if (!uid || deadSellers.has(uid) || inFlight.has(uid)) return;
        const cached = cacheGet(uid);
        if (cached) {
            applySellerToCards(uid, cached);
            return;
        }
        if (prioritize && fetchQueue.has(uid)) {
            // Move visible seller to the front of the queue
            const rest = Array.from(fetchQueue).filter((x) => x !== uid);
            fetchQueue.clear();
            fetchQueue.add(uid);
            for (const x of rest) fetchQueue.add(x);
        } else if (prioritize) {
            const rest = Array.from(fetchQueue);
            fetchQueue.clear();
            fetchQueue.add(uid);
            for (const x of rest) fetchQueue.add(x);
        } else {
            fetchQueue.add(uid);
        }
        pumpQueue();
    }

    function enqueueAllUnresolvedCards() {
        // Prioritize visible cards first, then remaining cards on the page
        for (const el of visibleCards) {
            if (!el.isConnected) continue;
            const rec = trackedCards.get(el);
            if (rec && !rec.iso) enqueueSeller(rec.uid, false);
        }
        for (const [el, rec] of trackedCards.entries()) {
            if (!el.isConnected) {
                cleanupCard(el);
                continue;
            }
            if (!rec.iso) enqueueSeller(rec.uid, false);
        }
    }

    function pickNextSeller() {
        const filterActive = isFilterActive();
        for (const uid of fetchQueue) {
            fetchQueue.delete(uid);
            if (deadSellers.has(uid) || inFlight.has(uid)) continue;
            const cached = cacheGet(uid);
            if (cached) {
                applySellerToCards(uid, cached);
                continue;
            }
            // When filter is off, fetch only visible cards; when active, scan all cards on the page
            if (!hasConnectedCard(uid, !filterActive)) continue;
            return uid;
        }
        return null;
    }

    function scheduleResume(delayMs) {
        if (resumeTimer) return;
        resumeTimer = setTimeout(() => {
            resumeTimer = null;
            pumpQueue();
        }, delayMs);
    }

    function pumpQueue() {
        if (document.hidden) return;
        const now = Date.now();
        if (now < pausedUntil) {
            scheduleResume(pausedUntil - now + 50);
            return;
        }
        while (activeWorkers < CONFIG.CONCURRENCY && fetchQueue.size > 0) {
            const uid = pickNextSeller();
            if (!uid) break;
            runWorker(uid);
        }
        scheduleBarRender();
    }

    function getNextRequestDelay() {
        const jitter = CONFIG.REQUEST_JITTER_MS > 0
            ? Math.floor(Math.random() * CONFIG.REQUEST_JITTER_MS)
            : 0;
        return CONFIG.REQUEST_DELAY_MS + jitter;
    }

    async function runWorker(uid) {
        activeWorkers++;
        inFlight.add(uid);
        try {
            const response = await fetch(`/api/v2/users/${uid}`, {
                credentials: 'include',
                headers: { Accept: 'application/json' },
            });

            if (response.status === 200) {
                backoffMs = 0;
                const data = await response.json();
                const user = data && data.user;
                const iso = (user?.country_iso_code || user?.country_code || '').toUpperCase();
                if (iso) {
                    const info = {
                        iso,
                        name: user?.country_title_local || user?.country_title || iso,
                        city: user?.city || '',
                    };
                    cacheSet(uid, info);
                    applySellerToCards(uid, info);
                } else {
                    deadSellers.add(uid);
                }
            } else if (response.status === 404 || response.status === 410) {
                deadSellers.add(uid);
            } else if (response.status === 429 || response.status === 403) {
                const now = Date.now();
                // Escalate backoff only once per cooldown window
                if (now >= pausedUntil) {
                    const retryAfter = parseInt(response.headers.get('Retry-After') || '', 10);
                    if (Number.isFinite(retryAfter) && retryAfter > 0) {
                        backoffMs = Math.min(retryAfter * 1000, 60000);
                    } else {
                        backoffMs = backoffMs
                            ? Math.min(backoffMs * 2, 30000)
                            : (response.status === 429 ? 4000 : 10000);
                    }
                    pausedUntil = now + backoffMs;
                }
                if (hasConnectedCard(uid, !isFilterActive())) {
                    fetchQueue.add(uid);
                }
                scheduleBarRender();
            }
        } catch {
            // Transient network error — continue processing remaining cards
        } finally {
            inFlight.delete(uid);
            setTimeout(() => {
                activeWorkers--;
                pumpQueue();
            }, getNextRequestDelay());
        }
    }

    /* =========================
       Floating bottom country filter bar (updated in-place without recreating buttons)
    ========================== */
    let filterBarEl = null;
    let barRenderScheduled = false;
    let barUiMode = null; // 'expanded' | 'collapsed' | null
    let lastBarSignature = '';
    const chipButtons = new Map(); // iso -> { btn, countSpan }
    let allChipBtn = null;
    let chipsContainerEl = null;
    let progressEl = null;
    let modeBtnEl = null;
    let settingsBtnEl = null;
    let settingsPopoverEl = null;
    let settingsOpen = false;
    let collapseBtnEl = null;
    let expandBtnEl = null;

    function ensureSettingsPopover(ui) {
        if (settingsPopoverEl && settingsPopoverEl.isConnected) return settingsPopoverEl;
        settingsPopoverEl = document.createElement('div');
        settingsPopoverEl.id = 'vlt-settings-popover';
        settingsPopoverEl.className = 'vlt-popover-hidden';

        const header = document.createElement('div');
        header.className = 'vlt-settings-title';
        header.textContent = ui.settings;
        settingsPopoverEl.appendChild(header);

        const makeToggleRow = (labelText, checked, onChange) => {
            const row = document.createElement('label');
            row.className = 'vlt-setting-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = checked;
            cb.addEventListener('change', () => onChange(cb.checked));
            const span = document.createElement('span');
            span.textContent = labelText;
            row.appendChild(cb);
            row.appendChild(span);
            return row;
        };

        settingsPopoverEl.appendChild(
            makeToggleRow(ui.showFullTitle, filterState.showFullTitle, (val) => {
                filterState.showFullTitle = val;
                saveFilterState();
                applyFullTitleToAllCards();
            })
        );

        settingsPopoverEl.appendChild(
            makeToggleRow(ui.showCity, filterState.showCity, (val) => {
                filterState.showCity = val;
                saveFilterState();
                reRenderAllBadges();
            })
        );

        document.body.appendChild(settingsPopoverEl);
        return settingsPopoverEl;
    }

    function setSettingsOpen(open, ui) {
        settingsOpen = open;
        const pop = ensureSettingsPopover(ui || getUiStrings());
        pop.classList.toggle('vlt-popover-hidden', !open);
        if (settingsBtnEl) {
            settingsBtnEl.classList.toggle('vlt-icon-btn-active', open);
        }
    }

    function ensureFilterBar() {
        if (!CONFIG.SHOW_FILTER_BAR) return null;
        if (filterBarEl && filterBarEl.isConnected) return filterBarEl;
        filterBarEl = document.createElement('div');
        filterBarEl.id = 'vlt-filter-bar';
        document.body.appendChild(filterBarEl);
        barUiMode = null;
        lastBarSignature = '';
        return filterBarEl;
    }

    function scheduleBarRender() {
        if (!CONFIG.SHOW_FILTER_BAR || barRenderScheduled) return;
        barRenderScheduled = true;
        requestAnimationFrame(renderFilterBar);
    }

    function onCountryChipClick(iso, e) {
        const multi = e.ctrlKey || e.metaKey || e.shiftKey;
        if (multi) {
            if (filterState.selected.has(iso)) {
                filterState.selected.delete(iso);
            } else {
                filterState.selected.add(iso);
            }
        } else {
            // Regular click: filter to only this country; clicking again resets to "All"
            if (filterState.selected.size === 1 && filterState.selected.has(iso)) {
                filterState.selected.clear();
            } else {
                filterState.selected.clear();
                filterState.selected.add(iso);
            }
        }
        saveFilterState();
        applyFilterToAllCards();
    }

    function createCountryChip(iso, ui) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vlt-chip' + (iso === LOCAL_COUNTRY_ISO ? ' vlt-chip-local' : '');
        btn.dataset.iso = iso;
        btn.title = ui.multiHint;

        btn.appendChild(createFlagNode(iso));
        const labelSpan = document.createElement('span');
        labelSpan.textContent = getCountryLabel(iso, iso, true);
        btn.appendChild(labelSpan);

        const countSpan = document.createElement('span');
        countSpan.className = 'vlt-chip-count';
        countSpan.style.display = 'none';
        btn.appendChild(countSpan);

        btn.addEventListener('click', (e) => onCountryChipClick(iso, e));
        return { btn, countSpan };
    }

    function buildExpandedBar(bar, ui) {
        bar.textContent = '';
        bar.classList.remove('vlt-bar-collapsed');
        chipButtons.clear();

        allChipBtn = document.createElement('button');
        allChipBtn.type = 'button';
        allChipBtn.className = 'vlt-chip';
        allChipBtn.textContent = ui.all;
        allChipBtn.addEventListener('click', () => {
            if (isFilterActive()) {
                filterState.selected.clear();
                saveFilterState();
                applyFilterToAllCards();
            }
        });
        bar.appendChild(allChipBtn);

        chipsContainerEl = document.createElement('span');
        chipsContainerEl.style.cssText = 'display: contents;';
        bar.appendChild(chipsContainerEl);

        progressEl = document.createElement('span');
        progressEl.className = 'vlt-bar-progress';
        progressEl.style.display = 'none';
        bar.appendChild(progressEl);

        const divider = document.createElement('span');
        divider.className = 'vlt-bar-divider';
        bar.appendChild(divider);

        modeBtnEl = document.createElement('button');
        modeBtnEl.type = 'button';
        modeBtnEl.className = 'vlt-icon-btn';
        modeBtnEl.addEventListener('click', () => {
            filterState.mode = filterState.mode === 'hide' ? 'dim' : 'hide';
            saveFilterState();
            applyFilterToAllCards();
        });
        bar.appendChild(modeBtnEl);

        settingsBtnEl = document.createElement('button');
        settingsBtnEl.type = 'button';
        settingsBtnEl.className = 'vlt-icon-btn';
        settingsBtnEl.textContent = '⚙️';
        settingsBtnEl.title = ui.settings;
        settingsBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            setSettingsOpen(!settingsOpen, ui);
        });
        bar.appendChild(settingsBtnEl);

        collapseBtnEl = document.createElement('button');
        collapseBtnEl.type = 'button';
        collapseBtnEl.className = 'vlt-icon-btn';
        collapseBtnEl.textContent = '−';
        collapseBtnEl.title = ui.collapse;
        collapseBtnEl.addEventListener('click', () => {
            filterState.collapsed = true;
            setSettingsOpen(false, ui);
            saveFilterState();
            renderFilterBar();
        });
        bar.appendChild(collapseBtnEl);

        barUiMode = 'expanded';
    }

    function buildCollapsedBar(bar, ui) {
        bar.textContent = '';
        bar.classList.add('vlt-bar-collapsed');
        chipButtons.clear();
        setSettingsOpen(false, ui);

        expandBtnEl = document.createElement('button');
        expandBtnEl.type = 'button';
        expandBtnEl.className = 'vlt-chip';
        expandBtnEl.title = ui.expand;
        expandBtnEl.addEventListener('click', () => {
            filterState.collapsed = false;
            saveFilterState();
            renderFilterBar();
        });
        bar.appendChild(expandBtnEl);

        barUiMode = 'collapsed';
    }

    function renderFilterBar() {
        barRenderScheduled = false;
        const bar = ensureFilterBar();
        if (!bar) return;

        // Compute stats only for connected cards on the current page
        let totalCards = 0;
        let resolvedCards = 0;
        const counts = new Map();

        for (const [el, rec] of trackedCards.entries()) {
            if (!el.isConnected) {
                cleanupCard(el);
                continue;
            }
            totalCards++;
            if (rec.iso) {
                resolvedCards++;
                counts.set(rec.iso, (counts.get(rec.iso) || 0) + 1);
            }
        }

        // Hide the bar on pages without product cards (e.g. inbox, settings)
        if (totalCards === 0) {
            if (!bar.classList.contains('vlt-bar-hidden')) {
                bar.classList.add('vlt-bar-hidden');
            }
            if (settingsOpen) setSettingsOpen(false);
            return;
        }
        if (bar.classList.contains('vlt-bar-hidden')) {
            bar.classList.remove('vlt-bar-hidden');
        }

        const isCoolingDown = Date.now() < pausedUntil;
        const countsSig = Array.from(counts.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
        const selectedSig = Array.from(filterState.selected).sort().join(',');
        const signature = `${filterState.collapsed ? 1 : 0}|${filterState.mode}|${selectedSig}|${resolvedCards}/${totalCards}|${isCoolingDown ? 1 : 0}|${countsSig}`;
        if (signature === lastBarSignature) return;
        lastBarSignature = signature;

        const ui = getUiStrings();

        if (filterState.collapsed) {
            if (barUiMode !== 'collapsed') {
                buildCollapsedBar(bar, ui);
            }
            expandBtnEl.className = isFilterActive() ? 'vlt-chip vlt-chip-active' : 'vlt-chip';
            expandBtnEl.textContent = '';
            if (isFilterActive()) {
                const selectedList = Array.from(filterState.selected);
                expandBtnEl.appendChild(createFlagNode(selectedList[0]));
                const lbl = document.createElement('span');
                lbl.textContent = selectedList.length === 1
                    ? getCountryLabel(selectedList[0], selectedList[0], true)
                    : selectedList.join('+');
                expandBtnEl.appendChild(lbl);
            } else {
                expandBtnEl.textContent = `🌍 ${ui.expand}`;
            }
            return;
        }

        if (barUiMode !== 'expanded') {
            buildExpandedBar(bar, ui);
        }

        // Update "All" button state
        allChipBtn.classList.toggle('vlt-chip-active', !isFilterActive());

        // Collect country list and update chips in-place
        const countries = new Set(DEFAULT_COUNTRIES);
        for (const iso of counts.keys()) countries.add(iso);
        for (const iso of filterState.selected) countries.add(iso);

        for (const iso of countries) {
            let entry = chipButtons.get(iso);
            if (!entry) {
                entry = createCountryChip(iso, ui);
                chipButtons.set(iso, entry);
                chipsContainerEl.appendChild(entry.btn);
            }
            entry.btn.classList.toggle('vlt-chip-active', filterState.selected.has(iso));
            const cnt = counts.get(iso) || 0;
            if (cnt > 0) {
                entry.countSpan.textContent = String(cnt);
                entry.countSpan.style.display = '';
            } else {
                entry.countSpan.style.display = 'none';
            }
        }

        // Scan progress indicator when filter is active
        if (isFilterActive() && resolvedCards < totalCards) {
            progressEl.textContent = isCoolingDown
                ? `⏳ ${resolvedCards}/${totalCards}`
                : `${resolvedCards}/${totalCards}`;
            progressEl.style.display = '';
        } else {
            progressEl.style.display = 'none';
        }

        // Hide vs dim mode toggle button
        modeBtnEl.textContent = filterState.mode === 'hide' ? '🚫' : '👁️';
        modeBtnEl.title = filterState.mode === 'hide' ? ui.modeHide : ui.modeDim;
    }

    /* =========================
       IntersectionObserver: prioritize visible cards
    ========================== */
    const viewportObserver = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                const container = entry.target;
                const uid = container.dataset.vltUid;
                if (entry.isIntersecting) {
                    visibleCards.add(container);
                    if (uid) enqueueSeller(uid, true);
                } else {
                    visibleCards.delete(container);
                }
            }
        },
        { rootMargin: CONFIG.VIEWPORT_MARGIN }
    );

    const observedContainers = new WeakSet();

    /* =========================
       DOM scanning via MutationObserver (no setInterval polling)
    ========================== */
    let scanScheduled = false;

    function scanCards() {
        scanScheduled = false;
        const links = document.querySelectorAll(CARD_LINK_SELECTOR);
        const filterActive = isFilterActive();

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            const container = link.closest('[class*="image-container"]') || link.parentElement;
            if (!container) continue;

            const { uid, title } = extractItemMetaFromElement(link);
            if (!uid) continue;

            const record = registerCard(container, uid, title);
            renderFullTitle(container, record.title);

            // Render and filter immediately if seller is already cached
            const cached = cacheGet(uid);
            if (cached) {
                record.iso = cached.iso.toUpperCase();
                renderBadge(container, uid, cached);
                applyFilterToCard(record);
                continue;
            }

            applyFilterToCard(record);

            if (!observedContainers.has(container)) {
                observedContainers.add(container);
                viewportObserver.observe(container);
            } else if (visibleCards.has(container)) {
                enqueueSeller(uid, true);
            }

            if (filterActive) {
                enqueueSeller(uid, false);
            }
        }

        scheduleBarRender();
    }

    function scheduleScan() {
        if (scanScheduled) return;
        scanScheduled = true;
        requestAnimationFrame(scanCards);
    }

    function isOwnNode(node) {
        if (!node || node.nodeType !== 1) return false;
        return (
            node.id === 'vlt-filter-bar' ||
            node.id === 'vlt-settings-popover' ||
            node.id === 'vlt-country-badge-styles' ||
            node.classList.contains('vlt-country-badge') ||
            node.classList.contains('vlt-full-title')
        );
    }

    function handleMutations(mutations) {
        for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            const t = m.target;
            if (t && t.nodeType === 1 && t.closest('#vlt-filter-bar, #vlt-settings-popover, .vlt-country-badge, .vlt-full-title')) {
                continue;
            }
            let hasExternalChange = false;
            for (let j = 0; j < m.addedNodes.length; j++) {
                if (!isOwnNode(m.addedNodes[j])) {
                    hasExternalChange = true;
                    break;
                }
            }
            if (!hasExternalChange) {
                for (let j = 0; j < m.removedNodes.length; j++) {
                    if (!isOwnNode(m.removedNodes[j])) {
                        hasExternalChange = true;
                        break;
                    }
                }
            }
            if (hasExternalChange) {
                scheduleScan();
                return;
            }
        }
    }

    /* =========================
       Bootstrap
    ========================== */
    loadCache();
    loadFilterState();
    injectStyles();
    scanCards();

    const domObserver = new MutationObserver(handleMutations);
    domObserver.observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Close settings popover on outside click
    document.addEventListener('click', (e) => {
        if (!settingsOpen) return;
        const target = e.target;
        if (target && target.nodeType === 1 && target.closest('#vlt-settings-popover, #vlt-filter-bar')) {
            return;
        }
        setSettingsOpen(false);
    });

    // Flush cache & pause queue when tab is hidden; resume when tab returns
    window.addEventListener('pagehide', flushCache);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushCache();
        } else {
            pumpQueue();
        }
    });
})();
