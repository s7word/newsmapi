import React, { useEffect, useState } from 'react';

export default function WebhookPushSettings({
  webhookConfig,
  loading,
  onSave,
  onTest,
  saving,
  testing,
  message,
}) {
  const webhook = webhookConfig?.webhook || {};
  const filters = webhook.filters || {};
  const providerCatalog = webhookConfig?.providerCatalog || [];
  const [enabled, setEnabled] = useState(Boolean(webhook.enabled));
  const [url, setUrl] = useState(webhook.url || '');
  const [secret, setSecret] = useState(webhook.secret || '');
  const [maxPriceUsd, setMaxPriceUsd] = useState(
    filters.maxPriceUsd == null ? '' : String(filters.maxPriceUsd),
  );
  const [requireBalance, setRequireBalance] = useState(Boolean(filters.requireBalance));
  const [minBalance, setMinBalance] = useState(
    filters.minBalance == null ? '' : String(filters.minBalance),
  );
  const [typeRestock, setTypeRestock] = useState(
    (filters.alertTypes || ['restock', 'new_listing']).includes('restock'),
  );
  const [typeNew, setTypeNew] = useState(
    (filters.alertTypes || ['restock', 'new_listing']).includes('new_listing'),
  );
  const [maxItems, setMaxItems] = useState(String(filters.maxItemsPerPush || 50));
  const [allProviders, setAllProviders] = useState(filters.providerKeys == null);
  const [selectedProviders, setSelectedProviders] = useState(
    Array.isArray(filters.providerKeys) ? filters.providerKeys : [],
  );
  const [providerQuery, setProviderQuery] = useState('');

  useEffect(() => {
    const next = webhookConfig?.webhook || {};
    const nextFilters = next.filters || {};
    setEnabled(Boolean(next.enabled));
    setUrl(next.url || '');
    setSecret(next.secret || '');
    setMaxPriceUsd(nextFilters.maxPriceUsd == null ? '' : String(nextFilters.maxPriceUsd));
    setRequireBalance(Boolean(nextFilters.requireBalance));
    setMinBalance(nextFilters.minBalance == null ? '' : String(nextFilters.minBalance));
    setTypeRestock((nextFilters.alertTypes || ['restock', 'new_listing']).includes('restock'));
    setTypeNew((nextFilters.alertTypes || ['restock', 'new_listing']).includes('new_listing'));
    setMaxItems(String(nextFilters.maxItemsPerPush || 50));
    setAllProviders(nextFilters.providerKeys == null);
    setSelectedProviders(Array.isArray(nextFilters.providerKeys) ? nextFilters.providerKeys : []);
  }, [webhookConfig]);

  const filteredProviders = providerCatalog.filter((row) => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return true;
    return `${row.alertCode} ${row.displayName} ${row.providerKey}`.toLowerCase().includes(query);
  });

  async function handleSave(event) {
    event.preventDefault();
    const alertTypes = [];
    if (typeNew) alertTypes.push('new_listing');
    if (typeRestock) alertTypes.push('restock');
    await onSave({
      enabled,
      url,
      secret,
      filters: {
        maxPriceUsd: maxPriceUsd === '' ? null : Number(maxPriceUsd),
        requireBalance,
        minBalance: minBalance === '' ? null : Number(minBalance),
        alertTypes,
        providerKeys: allProviders ? null : selectedProviders,
        maxItemsPerPush: Number(maxItems) || 50,
      },
    });
  }

  return (
    <div className="telegram-push-settings">
      <div className="telegram-push-settings__intro">
        <h3 className="telegram-push-settings__title">程序推送（Webhook）</h3>
        <p>
          把补货 / 上新结果以简化 JSON 推送到你的程序。接收协议见
          <code> docs/alert-webhook.md </code>
          （schema：{webhookConfig?.schema || 'smsall.alert.v1'}）。
        </p>
        <div className="telegram-push-settings__status">
          <span className={enabled ? 'provider-settings-badge provider-settings-badge--ok' : 'provider-settings-badge provider-settings-badge--muted'}>
            {enabled ? 'Webhook 已启用' : 'Webhook 未启用'}
          </span>
          <span className="provider-settings-badge provider-settings-badge--muted">
            {webhook.secretConfigured ? '已配置 Secret' : '未配置 Secret'}
          </span>
        </div>
      </div>

      <form className="webhook-settings-form" onSubmit={handleSave}>
        <label className="telegram-recipient-toggle">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          启用程序推送
        </label>

        <label>
          Webhook URL
          <input
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://your-app.example/hooks/smsall"
            required={enabled}
          />
        </label>

        <label>
          Secret（可选，用于签名校验）
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={webhook.secretConfigured ? '已保存；填 ******** 或不改可保留原值' : '可选共享密钥'}
            autoComplete="new-password"
          />
        </label>

        <div className="webhook-filters">
          <h4>简化 / 过滤规则</h4>
          <label>
            最高单价 USD（只要低价；空=不限）
            <input
              type="number"
              min="0"
              step="0.01"
              value={maxPriceUsd}
              onChange={(event) => setMaxPriceUsd(event.target.value)}
              placeholder="例如 0.5"
            />
          </label>
          <label className="telegram-recipient-toggle">
            <input
              type="checkbox"
              checked={requireBalance}
              onChange={(event) => setRequireBalance(event.target.checked)}
            />
            仅推送有余额的平台（余额未知或 ≤0 丢弃）
          </label>
          <label>
            最低余额（可选）
            <input
              type="number"
              min="0"
              step="0.01"
              value={minBalance}
              onChange={(event) => setMinBalance(event.target.value)}
              placeholder="例如 1"
            />
          </label>
          <div className="webhook-filter-types">
            <label className="telegram-recipient-toggle">
              <input type="checkbox" checked={typeNew} onChange={(event) => setTypeNew(event.target.checked)} />
              新上架
            </label>
            <label className="telegram-recipient-toggle">
              <input type="checkbox" checked={typeRestock} onChange={(event) => setTypeRestock(event.target.checked)} />
              补货
            </label>
          </div>
          <label>
            单次最多条数
            <input
              type="number"
              min="1"
              max="200"
              value={maxItems}
              onChange={(event) => setMaxItems(event.target.value)}
            />
          </label>
          <label className="telegram-recipient-toggle">
            <input
              type="checkbox"
              checked={allProviders}
              onChange={(event) => {
                setAllProviders(event.target.checked);
                if (event.target.checked) setSelectedProviders([]);
              }}
            />
            全部平台
          </label>
          {!allProviders ? (
            <div className="telegram-recipient-providers">
              <input
                className="telegram-source-legend__search"
                value={providerQuery}
                onChange={(event) => setProviderQuery(event.target.value)}
                placeholder="搜索平台"
              />
              <div className="telegram-recipient-providers__list">
                {filteredProviders.map((row) => (
                  <label key={row.providerKey} className="telegram-recipient-provider">
                    <input
                      type="checkbox"
                      checked={selectedProviders.includes(row.providerKey)}
                      onChange={(event) => {
                        setSelectedProviders((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(row.providerKey);
                          else next.delete(row.providerKey);
                          return [...next];
                        });
                      }}
                    />
                    <span>{row.alertCode} {row.displayName}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {message ? (
          <div className={message.ok ? 'success-banner' : 'error-banner'}>{message.text}</div>
        ) : null}

        <div className="settings-actions">
          <button type="submit" className="primary-button" disabled={saving || loading}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={testing || !url}
            onClick={() => onTest({ url, secret })}
          >
            {testing ? '测试中…' : '发送测试'}
          </button>
        </div>
      </form>
    </div>
  );
}
