import React, { useEffect, useMemo, useRef, useState } from 'react';

const SORT_OPTIONS = [
  { value: 'price_asc', label: '价格从低到高' },
  { value: 'price_desc', label: '价格从高到低' },
  { value: 'stock_desc', label: '库存从高到低' },
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'in_stock', label: '有库存' },
  { value: 'out_of_stock', label: '无库存' },
  { value: 'stale', label: '缓存数据' },
  { value: 'error', label: '异常' },
];

const MODE_LABELS = {
  register: { title: '先手机号注册 OAuth', subtitle: 'OPENAI 支持的国家地区' },
  bind: { title: '后手机号绑定 OAuth', subtitle: '绑定白名单国家' },
  recommended: { title: '目前推荐国家(自测)', subtitle: '推荐白名单' },
  whatsapp: { title: 'WhatsApp 接码', subtitle: 'OPENAI 支持的 WhatsApp 地区' },
  all: { title: '全部国家', subtitle: '不按业务模式过滤' },
};

const THEME_OPTIONS = ['system', 'light', 'dark'];

const THEME_LABELS = {
  system: '跟随系统',
  light: '亮色',
  dark: '暗色',
};

function getAuthToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('smsbazaar_admin_token') || '';
}

function setAuthToken(token) {
  if (!token) {
    window.localStorage.removeItem('smsbazaar_admin_token');
    return;
  }
  window.localStorage.setItem('smsbazaar_admin_token', token);
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function buildCompareUrl(filters, summary = false) {
  const params = new URLSearchParams(filters);
  if (summary) params.set('summary', '1');
  return `/api/compare?${params.toString()}`;
}

function formatPrice(value, currency, suffix = '') {
  if (!Number.isFinite(Number(value))) return '-';
  return `${currency} ${Number(value).toFixed(4).replace(/\.?0+$/, '')}${suffix ? ` ${suffix}` : ''}`;
}

function formatDualPrice(usdValue, cnyRate) {
  if (usdValue === null || usdValue === undefined || !Number.isFinite(Number(usdValue))) {
    return {
      cnyText: '-',
      usdText: '-',
    };
  }
  const safeUsd = Number(usdValue);
  const safeRate = Number(cnyRate || 0);
  const cnyValue = safeUsd * safeRate;
  return {
    cnyText: formatPrice(cnyValue, 'CNY', '￥'),
    usdText: formatPrice(safeUsd, 'USD', '＄'),
  };
}

function getFlagImageUrl(iso2) {
  const code = String(iso2 || '').toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return '';
  return `https://flagcdn.com/w40/${code}.png`;
}

function getRecommendationPathLabel(pathCode) {
  if (pathCode === 0) return '注册';
  if (pathCode === 1) return '绑定';
  return '-';
}

function FlagIcon({ iso2, alt }) {
  const src = getFlagImageUrl(iso2);
  if (!src) {
    return <span className="flag-icon flag-icon--fallback">🏳️</span>;
  }

  return (
    <img
      className="flag-icon"
      src={src}
      alt={alt}
      loading="lazy"
      width="20"
      height="15"
    />
  );
}

function formatTime(value) {
  if (!value) return '未刷新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatRefreshInterval(ms) {
  const totalMinutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
  return `每${totalMinutes}分钟1次`;
}

function StatusPill({ status }) {
  const labelMap = {
    in_stock: '在线',
    out_of_stock: '无库存',
    stale: '缓存',
    error: '异常',
  };
  return <span className={`status-pill status-pill--${status}`}>{labelMap[status] || status}</span>;
}

function ThemeIcon({ theme }) {
  if (theme === 'light') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }

  if (theme === 'dark') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7 7 0 1 0 11 11Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .9a11.1 11.1 0 0 0-3.5 21.6c.55.1.75-.24.75-.53v-2c-3.05.67-3.7-1.3-3.7-1.3-.5-1.25-1.22-1.58-1.22-1.58-1-.68.08-.67.08-.67 1.1.08 1.68 1.14 1.68 1.14.98 1.68 2.58 1.2 3.2.92.1-.72.38-1.2.7-1.48-2.43-.28-5-1.22-5-5.42 0-1.2.43-2.18 1.13-2.95-.12-.28-.5-1.4.1-2.9 0 0 .93-.3 3.05 1.13A10.6 10.6 0 0 1 12 6.48c.94 0 1.9.13 2.78.38 2.12-1.43 3.05-1.13 3.05-1.13.6 1.5.22 2.62.1 2.9.7.77 1.13 1.75 1.13 2.95 0 4.22-2.58 5.14-5.03 5.4.4.35.75 1.03.75 2.08v3.08c0 .3.2.63.76.52A11.1 11.1 0 0 0 12 .9Z" />
    </svg>
  );
}

function getStoredThemePreference() {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem('themePreference');
  return THEME_OPTIONS.includes(stored) ? stored : 'system';
}

function TierList({ tiers, cnyRate }) {
  return (
    <div className="tier-list">
      {tiers.map((tier) => (
        <div key={`${tier.providerRef}-${tier.priceOriginal}-${tier.stock}`} className="tier-chip">
          <span>{formatDualPrice(tier.priceUsd, cnyRate).cnyText}</span>
          <span>≈ {formatDualPrice(tier.priceUsd, cnyRate).usdText}</span>
          <span>{tier.stock} 库存</span>
          {tier.providerRef ? <span>#{tier.providerRef}</span> : null}
        </div>
      ))}
    </div>
  );
}

function CountryCombobox({ countries, value, onChange }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const selected = countries.find((country) => country.iso2 === value);
    setQuery(selected?.displayName || '');
  }, [countries, value]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return countries;
    return countries.filter((country) => {
      const haystack = [
        country.displayName,
        country.chineseName,
        country.englishName,
        country.iso2,
      ].join(' ').toLowerCase();
      return haystack.includes(normalized);
    });
  }, [countries, query]);

  return (
    <div
      className="country-combobox"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          const selected = countries.find((country) => country.iso2 === value);
          setQuery(selected?.displayName || '');
        }
      }}
    >
      <input
        className="country-combobox__input"
        placeholder="搜索国家 / Search country"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          if (!event.target.value.trim()) {
            onChange('');
          }
        }}
      />
      {open ? (
        <div className="country-combobox__menu">
          <button
            type="button"
            className={value === '' ? 'country-combobox__option is-active' : 'country-combobox__option'}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange('');
              setQuery('');
              setOpen(false);
            }}
          >
            <span>🌐</span>
            <span>全部国家</span>
          </button>
          {filtered.map((country) => (
            <button
              key={country.iso2}
              type="button"
              className={value === country.iso2 ? 'country-combobox__option is-active' : 'country-combobox__option'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(country.iso2);
                setQuery(country.displayName);
                setOpen(false);
              }}
            >
              <FlagIcon iso2={country.iso2} alt={country.displayName} />
              <span>{country.displayName}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatConnectivityBalance(connectivity) {
  if (!connectivity) return '—';
  if (connectivity.balance != null && connectivity.balance !== '') {
    const currency = connectivity.currency || 'USD';
    return `${currency} ${connectivity.balance}`;
  }
  if (connectivity.countryCount != null) {
    return `${connectivity.countryCount} 个国家`;
  }
  if (connectivity.mode === 'public') return '公开接口';
  return connectivity.ok ? '已联通' : '—';
}

const REFRESH_STATUS_LABELS = {
  idle: '未刷新',
  success: '正常',
  stale: '缓存',
  error: '异常',
};

const KEY_SOURCE_LABELS = {
  database: '已存库',
  env: '环境变量',
  public: '可无 Key',
  none: '未配置',
};

function ProviderSettingsCard({
  provider,
  draftValue,
  onDraftChange,
  onTest,
  testing,
  testResult,
}) {
  const connectivity = testResult?.connectivity || provider.connectivity;
  const refresh = provider.refresh || {};
  const lastRefreshTime = refresh.lastSuccessAt || refresh.snapshotFetchedAt;
  const connectivityCheckedAt = connectivity?.checkedAt;

  return (
    <article className="provider-settings-card">
      <header className="provider-settings-card__header">
        <div>
          <h3>{provider.displayName}</h3>
          <p className="provider-settings-card__meta">
            {provider.keyEnv}
            {' · '}
            {KEY_SOURCE_LABELS[provider.source] || provider.source}
            {provider.maskedKey ? ` · ${provider.maskedKey}` : ''}
          </p>
        </div>
        <div className="provider-settings-card__badges">
          <span className={`provider-settings-badge provider-settings-badge--refresh-${refresh.status || 'idle'}`}>
            报价 {REFRESH_STATUS_LABELS[refresh.status] || refresh.status || '未刷新'}
          </span>
          <span className={
            connectivity
              ? (connectivity.ok
                ? 'provider-settings-badge provider-settings-badge--ok'
                : 'provider-settings-badge provider-settings-badge--error')
              : 'provider-settings-badge provider-settings-badge--muted'
          }>
            接口 {connectivity ? (connectivity.ok ? '联通' : '失败') : '未测试'}
          </span>
        </div>
      </header>

      <div className="provider-settings-metrics">
        <div className="provider-settings-metric">
          <span>余额 / 接口</span>
          <strong>{formatConnectivityBalance(connectivity)}</strong>
        </div>
        <div className="provider-settings-metric">
          <span>报价条数</span>
          <strong>{Number.isFinite(Number(refresh.offerCount)) ? refresh.offerCount : '—'}</strong>
        </div>
        <div className="provider-settings-metric">
          <span>最后刷新</span>
          <strong>{formatTime(lastRefreshTime)}</strong>
        </div>
        <div className="provider-settings-metric">
          <span>接口延迟</span>
          <strong>
            {connectivity?.latencyMs
              ? `${connectivity.latencyMs}ms`
              : (testResult?.latencyMs ? `${testResult.latencyMs}ms` : '—')}
          </strong>
        </div>
        <div className="provider-settings-metric provider-settings-metric--wide">
          <span>测试端点</span>
          <strong>{connectivity?.endpoint || testResult?.endpoint || '—'}</strong>
        </div>
        {connectivity?.email ? (
          <div className="provider-settings-metric provider-settings-metric--wide">
            <span>账号</span>
            <strong>{connectivity.email}</strong>
          </div>
        ) : null}
        {connectivityCheckedAt ? (
          <div className="provider-settings-metric provider-settings-metric--wide">
            <span>接口检测</span>
            <strong>{formatTime(connectivityCheckedAt)}</strong>
          </div>
        ) : null}
      </div>

      {(refresh.errorMessage || (connectivity && !connectivity.ok && connectivity.message)) ? (
        <div className="provider-settings-card__error">
          {refresh.errorMessage || connectivity.message}
        </div>
      ) : null}

      {testResult?.message && testResult.ok ? (
        <div className="key-test-result key-test-result--ok">
          {testResult.message}
          {testResult.latencyMs ? ` · ${testResult.latencyMs}ms` : ''}
        </div>
      ) : null}

      <div className="settings-key-row__controls provider-settings-card__controls">
        <input
          type="password"
          autoComplete="off"
          placeholder={provider.hasKey ? '留空保留现有 Key；输入新值覆盖' : '粘贴 API Key'}
          value={draftValue}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <button
          type="button"
          className="ghost-button settings-test-button"
          disabled={testing}
          onClick={onTest}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
      </div>
    </article>
  );
}

function SettingsModal({
  open,
  onClose,
  authenticated,
  onLogin,
  onLogout,
  providers,
  serviceKey,
  panelLoading,
  onReloadPanel,
  onSaveKeys,
  onTestKey,
  onTestAllKeys,
  saving,
  message,
}) {
  const [password, setPassword] = useState('');
  const [draftKeys, setDraftKeys] = useState({});
  const [loginError, setLoginError] = useState('');
  const [testResults, setTestResults] = useState({});
  const [testingKeyEnv, setTestingKeyEnv] = useState('');
  const [testingAll, setTestingAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraftKeys({});
    setPassword('');
    setLoginError('');
    setTestResults({});
    setTestingKeyEnv('');
    setTestingAll(false);
  }, [open, authenticated]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="平台 API Key 设置"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-card__header">
          <div>
            <h2>平台设置</h2>
            <p>
              查看各平台余额、报价刷新与接口联通状态，并配置 API Key。
              {serviceKey ? ` 当前服务：${serviceKey}` : ''}
            </p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        {!authenticated ? (
          <form
            className="settings-login"
            onSubmit={async (event) => {
              event.preventDefault();
              setLoginError('');
              const formPassword = String(new FormData(event.currentTarget).get('password') || password || '');
              try {
                await onLogin(formPassword);
              } catch (error) {
                setLoginError(error.message || '登录失败');
              }
            }}
          >
            <label>
              管理员密码
              <input
                type="password"
                name="password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="ADMIN_PASSWORD / ADMIN_REFRESH_TOKEN"
              />
            </label>
            {loginError ? <div className="error-banner">{loginError}</div> : null}
            <button type="submit" className="primary-button">登录</button>
          </form>
        ) : (
          <form
            className="settings-keys"
            onSubmit={async (event) => {
              event.preventDefault();
              await onSaveKeys(draftKeys);
            }}
          >
            <div className="settings-panel-toolbar">
              <button
                type="button"
                className="ghost-button"
                disabled={panelLoading || testingAll || Boolean(testingKeyEnv) || saving}
                onClick={async () => {
                  setTestingAll(true);
                  try {
                    const results = await onTestAllKeys(draftKeys);
                    const mapped = {};
                    for (const result of results) {
                      if (result.keyEnv) mapped[result.keyEnv] = result;
                    }
                    setTestResults(mapped);
                    await onReloadPanel();
                  } catch (error) {
                    setTestResults({
                      __all: { ok: false, message: error.message || '批量测试失败' },
                    });
                  } finally {
                    setTestingAll(false);
                  }
                }}
              >
                {testingAll ? '检测中…' : '刷新接口状态'}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={panelLoading || testingAll || Boolean(testingKeyEnv) || saving}
                onClick={() => onReloadPanel()}
              >
                {panelLoading ? '加载中…' : '刷新面板数据'}
              </button>
            </div>

            {panelLoading && !providers?.length ? (
              <div className="loading-card settings-panel-loading">正在加载平台状态…</div>
            ) : null}

            <div className="settings-keys__list settings-provider-grid">
              {(providers || []).map((provider) => {
                const testResult = testResults[provider.keyEnv];
                const draftValue = draftKeys[provider.keyEnv] ?? '';
                return (
                  <ProviderSettingsCard
                    key={provider.keyEnv}
                    provider={provider}
                    draftValue={draftValue}
                    testResult={testResult}
                    testing={testingKeyEnv === provider.keyEnv}
                    onDraftChange={(value) => {
                      setDraftKeys((current) => ({ ...current, [provider.keyEnv]: value }));
                      setTestResults((current) => {
                        const next = { ...current };
                        delete next[provider.keyEnv];
                        return next;
                      });
                    }}
                    onTest={async () => {
                      setTestingKeyEnv(provider.keyEnv);
                      try {
                        const result = await onTestKey(provider.keyEnv, draftValue);
                        setTestResults((current) => ({ ...current, [provider.keyEnv]: result }));
                        await onReloadPanel();
                      } catch (error) {
                        setTestResults((current) => ({
                          ...current,
                          [provider.keyEnv]: {
                            ok: false,
                            message: error.message || '测试失败',
                          },
                        }));
                      } finally {
                        setTestingKeyEnv('');
                      }
                    }}
                  />
                );
              })}
            </div>
            {testResults.__all ? (
              <div className={testResults.__all.ok ? 'success-banner' : 'error-banner'}>
                {testResults.__all.message}
              </div>
            ) : null}
            {message ? <div className="success-banner">{message}</div> : null}
            <div className="settings-actions">
              <button type="submit" className="primary-button" disabled={saving || testingAll}>
                {saving ? '保存中...' : '保存 Key'}
              </button>
              <button
                type="button"
                className="ghost-button"
                disabled={saving || testingAll || Boolean(testingKeyEnv)}
                onClick={async () => {
                  setTestingAll(true);
                  try {
                    const results = await onTestAllKeys(draftKeys);
                    const mapped = {};
                    for (const result of results) {
                      if (result.keyEnv) mapped[result.keyEnv] = result;
                    }
                    setTestResults(mapped);
                    await onReloadPanel();
                  } catch (error) {
                    setTestResults({
                      __all: { ok: false, message: error.message || '批量测试失败' },
                    });
                  } finally {
                    setTestingAll(false);
                  }
                }}
              >
                {testingAll ? '测试中…' : '测试全部'}
              </button>
              <button type="button" className="ghost-button" onClick={onLogout}>退出登录</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function App() {
  const [themePreference, setThemePreference] = useState(getStoredThemePreference);
  const [meta, setMeta] = useState(null);
  const [compare, setCompare] = useState({ rows: [], countries: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState({});
  const [tierExpanded, setTierExpanded] = useState({});
  const [detailOffers, setDetailOffers] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [detailErrors, setDetailErrors] = useState({});
  const skippedInitialFilterLoad = useRef(false);
  const detailsGeneration = useRef(0);
  const [filters, setFilters] = useState({
    service: 'openai_chatgpt',
    mode: 'register',
    country: '',
    provider: '',
    status: '',
    sort: 'price_asc',
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(Boolean(getAuthToken()));
  const [keyProviders, setKeyProviders] = useState([]);
  const [panelProviders, setPanelProviders] = useState([]);
  const [panelLoading, setPanelLoading] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [refreshingService, setRefreshingService] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState('');

  useEffect(() => {
    const root = document.documentElement;
    if (themePreference === 'system') {
      root.removeAttribute('data-theme');
      window.localStorage.removeItem('themePreference');
      return;
    }
    root.dataset.theme = themePreference;
    window.localStorage.setItem('themePreference', themePreference);
  }, [themePreference]);

  async function loadKeySettings() {
    const response = await fetch('/api/settings/keys', { headers: authHeaders() });
    if (!response.ok) {
      setAuthenticated(false);
      setAuthToken('');
      throw new Error('未登录或会话已过期');
    }
    const payload = await response.json();
    setKeyProviders(payload.providers || []);
    setAuthenticated(true);
  }

  async function loadProvidersPanel({ silent = false } = {}) {
    if (!silent) setPanelLoading(true);
    try {
      const response = await fetch(
        `/api/settings/providers-panel?service=${encodeURIComponent(filters.service)}`,
        { headers: authHeaders() },
      );
      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          setAuthToken('');
        }
        throw new Error('加载平台状态失败');
      }
      const payload = await response.json();
      setPanelProviders(payload.providers || []);
      setKeyProviders(payload.providers || []);
      setAuthenticated(true);
      return payload;
    } finally {
      if (!silent) setPanelLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        setError('');
        const [metaResponse, compareResponse] = await Promise.all([
          fetch(`/api/meta?service=${encodeURIComponent(filters.service)}`),
          fetch(buildCompareUrl(filters, true)),
        ]);
        if (!metaResponse.ok || !compareResponse.ok) {
          throw new Error('初始化加载失败');
        }
        const [metaPayload, comparePayload] = await Promise.all([
          metaResponse.json(),
          compareResponse.json(),
        ]);
        if (cancelled) return;
        setMeta(metaPayload);
        setCompare(comparePayload);
        if (getAuthToken()) {
          try {
            await loadProvidersPanel({ silent: true });
          } catch {
            setAuthenticated(false);
          }
        }
      } catch (bootstrapError) {
        if (!cancelled) setError(bootstrapError.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settingsOpen || !authenticated) return;
    loadProvidersPanel().catch(() => {});
  }, [settingsOpen, authenticated, filters.service]);

  useEffect(() => {
    if (!meta) return;
    if (!skippedInitialFilterLoad.current) {
      skippedInitialFilterLoad.current = true;
      return;
    }

    let cancelled = false;
    detailsGeneration.current += 1;
    setExpanded({});
    setTierExpanded({});
    setDetailOffers({});
    setDetailLoading({});
    setDetailErrors({});

    async function refreshCompare() {
      try {
        setError('');
        const response = await fetch(buildCompareUrl(filters, true));
        if (!response.ok) throw new Error('筛选刷新失败');
        const payload = await response.json();
        if (!cancelled) setCompare(payload);
      } catch (filterError) {
        if (!cancelled) setError(filterError.message);
      }
    }
    refreshCompare();
    return () => {
      cancelled = true;
    };
  }, [filters.mode, filters.country, filters.provider, filters.status, filters.sort, meta]);

  useEffect(() => {
    if (!meta) return;
    if (!skippedInitialFilterLoad.current) return;

    let cancelled = false;
    detailsGeneration.current += 1;
    setExpanded({});
    setTierExpanded({});
    setDetailOffers({});
    setDetailLoading({});
    setDetailErrors({});

    async function refreshForService() {
      try {
        setError('');
        const [metaResponse, compareResponse] = await Promise.all([
          fetch(`/api/meta?service=${encodeURIComponent(filters.service)}`),
          fetch(buildCompareUrl(filters, true)),
        ]);
        if (!metaResponse.ok || !compareResponse.ok) throw new Error('服务切换失败');
        const [metaPayload, comparePayload] = await Promise.all([
          metaResponse.json(),
          compareResponse.json(),
        ]);
        if (cancelled) return;
        setMeta(metaPayload);
        setCompare(comparePayload);
      } catch (serviceError) {
        if (!cancelled) setError(serviceError.message);
      }
    }
    refreshForService();
    return () => {
      cancelled = true;
    };
  }, [filters.service]);

  async function toggleCountry(row) {
    const countryIso2 = row.countryIso2;
    if (expanded[countryIso2]) {
      setExpanded((current) => ({ ...current, [countryIso2]: false }));
      return;
    }

    setExpanded((current) => ({ ...current, [countryIso2]: true }));
    if (Object.prototype.hasOwnProperty.call(detailOffers, countryIso2)) return;
    if (row.offers?.length) {
      setDetailOffers((current) => ({ ...current, [countryIso2]: row.offers }));
      return;
    }

    const requestGeneration = detailsGeneration.current;
    setDetailLoading((current) => ({ ...current, [countryIso2]: true }));
    setDetailErrors((current) => ({ ...current, [countryIso2]: '' }));

    try {
      const response = await fetch(buildCompareUrl({ ...filters, country: countryIso2 }));
      if (!response.ok) throw new Error('加载平台明细失败');
      const payload = await response.json();
      if (requestGeneration !== detailsGeneration.current) return;
      const detailRow = (payload.rows || []).find((item) => item.countryIso2 === countryIso2);
      setDetailOffers((current) => ({ ...current, [countryIso2]: detailRow?.offers || [] }));
    } catch (detailError) {
      if (requestGeneration !== detailsGeneration.current) return;
      setDetailErrors((current) => ({
        ...current,
        [countryIso2]: detailError.message || '加载平台明细失败',
      }));
    } finally {
      if (requestGeneration === detailsGeneration.current) {
        setDetailLoading((current) => ({ ...current, [countryIso2]: false }));
      }
    }
  }

  async function handleLogin(password) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.reason === 'admin_password_not_configured'
        ? '未配置管理员密码，请先在环境变量设置 ADMIN_PASSWORD'
        : '密码错误');
    }
    setAuthToken(payload.token);
    setAuthenticated(true);
    await loadProvidersPanel();
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: authHeaders(),
    });
    setAuthToken('');
    setAuthenticated(false);
    setKeyProviders([]);
    setPanelProviders([]);
    setSettingsMessage('');
  }

  async function handleTestKey(keyEnv, apiKey) {
    const body = { keyEnv };
    if (String(apiKey || '').trim()) {
      body.apiKey = String(apiKey).trim();
    }
    const response = await fetch('/api/settings/keys/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    if (!response.ok && !payload.message) {
      throw new Error('测试请求失败');
    }
    return payload;
  }

  async function handleTestAllKeys(draftKeysPayload) {
    const response = await fetch('/api/settings/keys/test-all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify({ keys: draftKeysPayload }),
    });
    if (!response.ok) throw new Error('批量测试失败');
    const payload = await response.json();
    return payload.results || [];
  }

  async function reloadDashboardData() {
    const [metaResponse, compareResponse] = await Promise.all([
      fetch(`/api/meta?service=${encodeURIComponent(filters.service)}`),
      fetch(buildCompareUrl(filters, true)),
    ]);
    if (!metaResponse.ok || !compareResponse.ok) {
      throw new Error('加载最新报价失败');
    }
    const [metaPayload, comparePayload] = await Promise.all([
      metaResponse.json(),
      compareResponse.json(),
    ]);
    setMeta(metaPayload);
    setCompare(comparePayload);
  }

  async function handleRefreshCurrentService({ silent = false } = {}) {
    if (!authenticated) {
      setSettingsOpen(true);
      setSettingsMessage('请先登录管理员账号，再点击「刷新当前服务」。');
      return { ok: false };
    }

    setRefreshingService(true);
    if (!silent) setRefreshNotice('正在向各平台拉取报价…');
    setError('');
    try {
      const response = await fetch('/api/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ service: filters.service }),
      });
      const payload = await response.json();
      if (!response.ok && !payload.accepted) {
        if (payload.reason === 'cooldown') {
          throw new Error('刷新冷却中，请稍后再试');
        }
        if (payload.reason === 'already_running') {
          throw new Error('已有刷新任务进行中');
        }
        throw new Error('刷新请求失败');
      }

      // Background refresh: wait briefly then reload dashboard snapshots.
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await reloadDashboardData();
      if (!silent) setRefreshNotice('当前服务报价已刷新');
      return { ok: true };
    } catch (refreshError) {
      const message = refreshError.message || '刷新失败';
      if (!silent) setRefreshNotice(message);
      setError(message);
      return { ok: false };
    } finally {
      setRefreshingService(false);
      if (!silent) {
        setTimeout(() => setRefreshNotice(''), 5000);
      }
    }
  }

  async function handleSaveKeys(draftKeys) {
    setSettingsSaving(true);
    setSettingsMessage('');
    try {
      const response = await fetch('/api/settings/keys', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ keys: draftKeys }),
      });
      if (!response.ok) throw new Error('保存失败');
      const payload = await response.json();
      setKeyProviders(payload.providers || []);
      setSettingsMessage('已保存，正在刷新当前服务报价…');
      await loadProvidersPanel({ silent: true });
      const refreshResult = await handleRefreshCurrentService({ silent: true });
      setSettingsMessage(
        refreshResult.ok
          ? '已保存，当前服务报价已刷新。'
          : '已保存。若价格未更新，请关闭设置后点击主界面「刷新当前服务」。',
      );
    } catch (saveError) {
      setSettingsMessage(saveError.message || '保存失败');
    } finally {
      setSettingsSaving(false);
    }
  }

  const providerOptions = useMemo(() => (meta?.providers || []).map((provider) => ({
    value: provider.providerKey,
    label: provider.displayName,
  })), [meta]);
  const cnyRate = Number(meta?.display?.cnyRateFromUsd || 7.2);
  const serviceModes = meta?.service?.modes || ['all'];

  const summary = useMemo(() => ({
    countryCount: compare.rows?.length || 0,
    providerCount: meta?.providers?.length || 0,
    configuredCount: (meta?.providers || []).filter((provider) => provider.configured).length,
  }), [compare.rows, meta]);

  const themeTitle = `主题：${THEME_LABELS[themePreference]}，点击切换`;

  if (loading) {
    return <div className="page-shell"><div className="loading-card">正在加载价格快照...</div></div>;
  }

  return (
    <div className="page-shell">
      <button
        type="button"
        className="theme-toggle"
        title={themeTitle}
        aria-label={themeTitle}
        onClick={() => {
          setThemePreference((current) => {
            const currentIndex = THEME_OPTIONS.indexOf(current);
            return THEME_OPTIONS[(currentIndex + 1) % THEME_OPTIONS.length];
          });
        }}
      >
        <ThemeIcon theme={themePreference} />
      </button>

      <button
        type="button"
        className="settings-toggle"
        title="平台 API Key 设置"
        aria-label="平台 API Key 设置"
        onClick={() => setSettingsOpen(true)}
      >
        设置
      </button>

      <div className="hero-bar">
        <div>
          <p className="eyebrow">Multi-service · Multi-provider SMS price board</p>
          <h1>{meta?.service?.displayName || '短信'} 价格对比</h1>
        </div>
        <div className="hero-meta">
          {authenticated ? (
            <button
              type="button"
              className="hero-refresh-button"
              disabled={refreshingService}
              onClick={() => handleRefreshCurrentService()}
            >
              {refreshingService ? '刷新中…' : '刷新当前服务'}
            </button>
          ) : null}
          <div className="hero-badge">
            <span>国家</span>
            <strong>{summary.countryCount}</strong>
          </div>
          <div className="hero-badge">
            <span>平台</span>
            <strong>{summary.configuredCount}/{summary.providerCount}</strong>
          </div>
          <div className="hero-badge">
            <span>更新时间</span>
            <strong>{formatTime(compare.updatedAt || meta?.lastRefresh?.completed_at)}</strong>
          </div>
          <div className="hero-badge">
            <span>刷新时间</span>
            <strong>{formatRefreshInterval(meta?.display?.refreshIntervalMs)}</strong>
          </div>
        </div>
        {refreshNotice ? <div className="refresh-notice">{refreshNotice}</div> : null}
      </div>

      <div className="panel card">
        <div className="project-links" aria-label="GitHub 项目入口">
          <a
            className="project-link"
            href="https://github.com/FoundZiGu/SMSBazaar"
            target="_blank"
            rel="noreferrer"
            title="本项目开源地址"
          >
            <GithubIcon />
            <span>
              <strong>上游开源</strong>
              <small>FoundZiGu/SMSBazaar</small>
            </span>
          </a>
          <button type="button" className="project-link settings-inline" onClick={() => setSettingsOpen(true)}>
            <span>
              <strong>平台设置</strong>
              <small>{authenticated ? '已登录 · 管理 API Key' : '登录后配置 API Key'}</small>
            </span>
          </button>
        </div>

        <div className="service-switch" aria-label="选择对比服务">
          {(meta?.services || []).map((service) => (
            <button
              key={service.serviceKey}
              type="button"
              className={filters.service === service.serviceKey ? 'service-switch__button is-active' : 'service-switch__button'}
              onClick={() => {
                const nextModes = service.modes || ['all'];
                setFilters((current) => ({
                  ...current,
                  service: service.serviceKey,
                  mode: nextModes.includes(current.mode) ? current.mode : nextModes[0],
                  country: '',
                }));
              }}
            >
              {service.displayName}
            </button>
          ))}
        </div>

        <div className="toolbar">
          <label>
            国家
            <CountryCombobox
              countries={compare.countries || []}
              value={filters.country}
              onChange={(nextCountry) => setFilters((current) => ({ ...current, country: nextCountry }))}
            />
          </label>
          <label>
            平台
            <select value={filters.provider} onChange={(event) => setFilters((current) => ({ ...current, provider: event.target.value }))}>
              <option value="">全部平台</option>
              {providerOptions.map((provider) => (
                <option key={provider.value} value={provider.value}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label>
            排序
            <select value={filters.sort} onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value }))}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            状态
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="mode-switch">
          {serviceModes.map((mode) => (
            <button
              key={mode}
              type="button"
              className={filters.mode === mode ? 'mode-switch__button is-active' : 'mode-switch__button'}
              onClick={() => setFilters((current) => ({ ...current, mode }))}
            >
              {MODE_LABELS[mode]?.title || mode}
              <small>{MODE_LABELS[mode]?.subtitle || ''}</small>
            </button>
          ))}
        </div>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="table-shell">
          <div className="table-head">
            <span>国家</span>
            <span>最低价格</span>
            <span>总库存</span>
            <span>在线平台</span>
            <span>更新时间</span>
            <span>推荐路径</span>
          </div>

          {(compare.rows || []).map((row) => {
            const isOpen = Boolean(expanded[row.countryIso2]);
            const offers = detailOffers[row.countryIso2] || row.offers || [];
            return (
              <div key={row.countryIso2} className="country-group">
                <button
                  type="button"
                  className="country-row"
                  onClick={() => toggleCountry(row)}
                >
                  <span className="country-row__country">
                    <strong><FlagIcon iso2={row.countryIso2} alt={row.countryDisplayName || row.countryName} /> {row.countryDisplayName || row.countryName}</strong>
                    <small>{row.countryIso2}</small>
                  </span>
                  <span>
                    {formatDualPrice(row.minPriceUsd, cnyRate).cnyText}
                    {row.minPriceUsd === null || row.minPriceUsd === undefined
                      ? null
                      : <small> ≈ {formatDualPrice(row.minPriceUsd, cnyRate).usdText}</small>}
                  </span>
                  <span>{row.inventoryTotal}</span>
                  <span>{row.providerCount}</span>
                  <span>{formatTime(row.lastFetchedAt)}</span>
                  <span>{getRecommendationPathLabel(row.recommendationPath)}</span>
                </button>

                {isOpen ? (
                  <div className="provider-list">
                    {detailLoading[row.countryIso2] ? (
                      <div className="provider-list__message">正在加载平台明细...</div>
                    ) : null}
                    {detailErrors[row.countryIso2] ? (
                      <div className="provider-list__message provider-list__message--error">
                        {detailErrors[row.countryIso2]}
                      </div>
                    ) : null}
                    {!detailLoading[row.countryIso2] && !detailErrors[row.countryIso2] && offers.length === 0 ? (
                      <div className="provider-list__message">该国家暂无平台明细。</div>
                    ) : null}
                    {offers.map((offer) => {
                      const tierKey = `${row.countryIso2}:${offer.providerKey}`;
                      const tiersOpen = Boolean(tierExpanded[tierKey]);
                      return (
                        <div key={`${row.countryIso2}-${offer.providerKey}`} className="provider-card">
                          <div className="provider-card__header">
                            <div>
                              <h3>{offer.providerName}</h3>
                              <p>{offer.providerKey}</p>
                            </div>
                            <StatusPill status={offer.status} />
                          </div>
                          <div className="provider-card__stats">
                            <div>
                              <span>最低价</span>
                              <strong>{formatDualPrice(offer.minPriceUsd, cnyRate).cnyText}</strong>
                              <small>≈ {formatDualPrice(offer.minPriceUsd, cnyRate).usdText}</small>
                            </div>
                            <div>
                              <span>库存</span>
                              <strong>{offer.inventoryTotal}</strong>
                            </div>
                            <div>
                              <span>更新时间</span>
                              <strong>{formatTime(offer.lastFetchedAt)}</strong>
                            </div>
                          </div>
                          <button
                            type="button"
                            className={tiersOpen ? 'tier-toggle is-open' : 'tier-toggle'}
                            onClick={() => setTierExpanded((current) => ({ ...current, [tierKey]: !tiersOpen }))}
                          >
                            <span>价格档位</span>
                            <strong>{offer.tiers.length}</strong>
                            <small>{tiersOpen ? '收起' : '展开'}</small>
                          </button>
                          {tiersOpen ? <TierList tiers={offer.tiers} cnyRate={cnyRate} /> : null}
                          {offer.errorMessage ? <div className="provider-card__error">{offer.errorMessage}</div> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          {!compare.rows?.length ? <div className="empty-state">当前筛选条件下没有可展示的数据。可先在右上角「设置」配置平台 Key 并刷新。</div> : null}
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        authenticated={authenticated}
        onLogin={handleLogin}
        onLogout={handleLogout}
        providers={panelProviders.length ? panelProviders : keyProviders}
        serviceKey={filters.service}
        panelLoading={panelLoading}
        onReloadPanel={() => loadProvidersPanel()}
        onSaveKeys={handleSaveKeys}
        onTestKey={handleTestKey}
        onTestAllKeys={handleTestAllKeys}
        saving={settingsSaving}
        message={settingsMessage}
      />
    </div>
  );
}

export default App;
