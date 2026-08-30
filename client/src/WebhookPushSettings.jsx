import React, { useEffect, useState } from 'react';

export default function WebhookPushSettings({
  webhookConfig,
  loading,
  onSave,
  onTest,
  onPushLatest,
  saving,
  testing,
  pushingLatest,
  message,
}) {
  const webhook = webhookConfig?.webhook || {};
  const filters = webhook.filters || {};
  const sniper = webhook.sniper || {};
  const status = webhookConfig?.status || {};
  const providerCatalog = webhookConfig?.providerCatalog || [];
  const [enabled, setEnabled] = useState(Boolean(webhook.enabled));
  const [url, setUrl] = useState(webhook.url || '');
  const [secret, setSecret] = useState('');
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
  const [lookbackMinutes, setLookbackMinutes] = useState('60');
  const [sniperEnabled, setSniperEnabled] = useState(Boolean(sniper.enabled));
  const [sniperTargets, setSniperTargets] = useState(() => {
    if (Array.isArray(sniper.targets) && sniper.targets.length) {
      return sniper.targets.map((row) => ({
        country: row.country || '',
        maxPriceUsd: row.maxPriceUsd == null ? '' : String(row.maxPriceUsd),
      }));
    }
    return (sniper.countries || []).map((country) => ({
      country,
      maxPriceUsd: sniper.maxPriceUsd == null ? '' : String(sniper.maxPriceUsd),
    }));
  });
  const [sniperRequireBalance, setSniperRequireBalance] = useState(
    sniper.requireBalance == null ? true : Boolean(sniper.requireBalance),
  );
  const [localMessage, setLocalMessage] = useState(null);

  useEffect(() => {
    const next = webhookConfig?.webhook || {};
    const nextFilters = next.filters || {};
    const nextSniper = next.sniper || {};
    setEnabled(Boolean(next.enabled));
    setUrl(next.url || '');
    setSecret('');
    setMaxPriceUsd(nextFilters.maxPriceUsd == null ? '' : String(nextFilters.maxPriceUsd));
    setRequireBalance(Boolean(nextFilters.requireBalance));
    setMinBalance(nextFilters.minBalance == null ? '' : String(nextFilters.minBalance));
    setTypeRestock((nextFilters.alertTypes || ['restock', 'new_listing']).includes('restock'));
    setTypeNew((nextFilters.alertTypes || ['restock', 'new_listing']).includes('new_listing'));
    setMaxItems(String(nextFilters.maxItemsPerPush || 50));
    setAllProviders(nextFilters.providerKeys == null);
    setSelectedProviders(Array.isArray(nextFilters.providerKeys) ? nextFilters.providerKeys : []);
    setSniperEnabled(Boolean(nextSniper.enabled));
    if (Array.isArray(nextSniper.targets) && nextSniper.targets.length) {
      setSniperTargets(nextSniper.targets.map((row) => ({
        country: row.country || '',
        maxPriceUsd: row.maxPriceUsd == null ? '' : String(row.maxPriceUsd),
      })));
    } else {
      setSniperTargets((nextSniper.countries || []).map((country) => ({
        country,
        maxPriceUsd: nextSniper.maxPriceUsd == null ? '' : String(nextSniper.maxPriceUsd),
      })));
    }
    setSniperRequireBalance(nextSniper.requireBalance == null ? true : Boolean(nextSniper.requireBalance));
  }, [webhookConfig]);

  const filteredProviders = providerCatalog.filter((row) => {
    const query = providerQuery.trim().toLowerCase();
    if (!query) return true;
    return `${row.alertCode} ${row.displayName} ${row.providerKey}`.toLowerCase().includes(query);
  });

  const ready = Boolean(enabled && String(url || '').trim());
  const displayMessage = localMessage || message;

  async function handleSave(event) {
    event.preventDefault();
    setLocalMessage(null);
    const alertTypes = [];
    if (typeNew) alertTypes.push('new_listing');
    if (typeRestock) alertTypes.push('restock');
    if (enabled && !String(url || '').trim()) {
      setLocalMessage({ ok: false, text: '勾选启用后必须填写 Webhook URL' });
      return;
    }
    await onSave({
      enabled,
      url: String(url || '').trim(),
      secret: secret || '********',
      filters: {
        maxPriceUsd: maxPriceUsd === '' ? null : Number(maxPriceUsd),
        requireBalance,
        minBalance: minBalance === '' ? null : Number(minBalance),
        alertTypes,
        providerKeys: allProviders ? null : selectedProviders,
        maxItemsPerPush: Number(maxItems) || 50,
      },
      sniper: {
        enabled: sniperEnabled,
        targets: sniperTargets
          .map((row) => ({
            country: String(row.country || '').trim().toUpperCase(),
            maxPriceUsd: row.maxPriceUsd === '' || row.maxPriceUsd == null
              ? null
              : Number(row.maxPriceUsd),
          }))
          .filter((row) => /^[A-Z]{2}$/.test(row.country)),
        requireBalance: sniperRequireBalance,
        alertTypes: ['new_listing', 'restock'],
        providerKeys: null,
      },
    });
  }

  async function handleTestClick() {
    setLocalMessage(null);
    const trimmed = String(url || '').trim();
    if (!trimmed) {
      setLocalMessage({
        ok: false,
        text: '请先填写 Webhook URL。当前服务器上过滤条件已保存，但 URL 为空，所以测试发不出去。',
      });
      return;
    }
    await onTest({ url: trimmed, secret: secret || '********' });
  }

  async function handlePushLatestClick() {
    setLocalMessage(null);
    const trimmed = String(url || '').trim() || String(webhook.url || '').trim();
    if (!trimmed) {
      setLocalMessage({
        ok: false,
        text: '请先填写并保存 Webhook URL，再手动推送最新通知。',
      });
      return;
    }
    const minutes = Number(lookbackMinutes);
    await onPushLatest({
      lookbackMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 60,
    });
  }

  function formatPushTime(value) {
    if (!value) return '尚未推送';
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return String(value);
    return new Date(ms).toLocaleString();
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
          <span className={ready ? 'provider-settings-badge provider-settings-badge--ok' : 'provider-settings-badge provider-settings-badge--muted'}>
            {ready ? 'Webhook 已就绪' : 'Webhook 未就绪'}
          </span>
          <span className={enabled ? 'provider-settings-badge provider-settings-badge--ok' : 'provider-settings-badge provider-settings-badge--muted'}>
            {enabled ? '已启用' : '未启用'}
          </span>
          <span className="provider-settings-badge provider-settings-badge--muted">
            {webhook.secretConfigured ? '已配置 Secret' : '未配置 Secret'}
          </span>
          {filters.minBalance != null ? (
            <span className="provider-settings-badge provider-settings-badge--ok">
              最低余额 ≥ {filters.minBalance}
            </span>
          ) : null}
          {filters.maxPriceUsd != null ? (
            <span className="provider-settings-badge provider-settings-badge--ok">
              最高单价 ≤ ${filters.maxPriceUsd}
            </span>
          ) : null}
          <span className="provider-settings-badge provider-settings-badge--muted">
            单次最多 {filters.maxItemsPerPush || 50} 条 · 优先最新
          </span>
          {sniper.enabled && (sniper.targets || sniper.countries || []).length ? (
            <span className="provider-settings-badge provider-settings-badge--ok">
              狙击 {(sniper.targets || []).map((row) => (
                `${row.country}${row.maxPriceUsd != null ? `≤$${row.maxPriceUsd}` : ''}`
              )).join(' / ') || (sniper.countries || []).join('/')}
            </span>
          ) : (
            <span className="provider-settings-badge provider-settings-badge--muted">
              狙击未启用
            </span>
          )}
        </div>
        {status.lastPushAt || status.lastManualPushAt || status.lastSniperPushAt ? (
          <p className="webhook-filters__hint">
            最近一次推送：{formatPushTime(status.lastPushAt)}
            {status.lastPushSource ? `（${
              status.lastPushSource === 'manual_latest' ? '手动最新'
                : status.lastPushSource === 'sniper' ? '狙击'
                  : '自动'
            }）` : ''}
            {status.lastPushItemCount != null ? ` · ${status.lastPushItemCount} 条` : ''}
            {status.lastPushOk === false ? ` · 失败：${status.lastPushError || 'unknown'}` : ''}
            {status.lastManualPushAt ? `；上次手动：${formatPushTime(status.lastManualPushAt)}` : ''}
            {status.lastSniperPushAt ? `；上次狙击：${formatPushTime(status.lastSniperPushAt)}（${status.lastSniperItemCount || 0} 条）` : ''}
          </p>
        ) : (
          <p className="webhook-filters__hint">
            自动推送若堆积，可用「手动推送最新」。狙击国家命中时会单独打标并立即推给上游（`source=sniper`）。
          </p>
        )}
        {!ready ? (          <div className="error-banner">
            过滤条件可以先保存，但必须同时「勾选启用 + 填写可达的 Webhook URL」后才会真正推送。
            Docker 内不要用 127.0.0.1 指宿主机程序，请用宿主机 IP 或 http://172.17.0.1:端口/...
          </div>
        ) : null}
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
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="http://172.17.0.1:9090/hooks/smsall"
            required={enabled}
          />
        </label>

        <label>
          Secret（可选，用于签名校验）
          <input
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder={webhook.secretConfigured ? '已保存，留空表示不修改' : '可选共享密钥'}
            autoComplete="new-password"
          />
        </label>

        <div className="webhook-filters">
          <h4>简化 / 过滤规则</h4>
          <p className="webhook-filters__hint">
            这些过滤<strong>只作用于程序推送（Webhook）</strong>，不影响 Telegram 机器人原文。
            最低余额会丢弃余额未知或低于阈值的平台。SMSTG 若 Key 无效导致余额未知，Webhook 不会推它，但 Telegram 仍可能推送。
          </p>
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
          <p className="webhook-filters__hint">
            超过上限时<strong>优先保留最新通知</strong>（其次低价）。当前生产若设为 4，堆积时旧消息会挤掉新消息——建议提高，或用手动推送最新。
          </p>
          <label>
            手动推送回看分钟数
            <input
              type="number"
              min="5"
              max="1440"
              value={lookbackMinutes}
              onChange={(event) => setLookbackMinutes(event.target.value)}
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

        <div className="webhook-filters">
          <h4>狙击国家对应表</h4>
          <p className="webhook-filters__hint">
            每个国家单独设<strong>狙击最高价</strong>：≤ 该价 → 打
            <code> sniper </code>
            标签并立即优先推送；
            <strong>超过该价仍通知</strong>，但不打狙击标签（上游不要自动动作）。
            仅有余额平台触发（可关）。
          </p>
          <label className="telegram-recipient-toggle">
            <input
              type="checkbox"
              checked={sniperEnabled}
              onChange={(event) => setSniperEnabled(event.target.checked)}
            />
            启用狙击
          </label>
          <label className="telegram-recipient-toggle">
            <input
              type="checkbox"
              checked={sniperRequireBalance}
              onChange={(event) => setSniperRequireBalance(event.target.checked)}
              disabled={!sniperEnabled}
            />
            仅有余额平台才狙击（推荐开启）
          </label>

          <div className="sniper-targets">
            <div className="sniper-targets__header" aria-hidden="true">
              <span>国家</span>
              <span>最高狙击价 ($)</span>
              <span />
            </div>
            <div className="sniper-targets__list">
              {sniperTargets.length === 0 ? (
                <div className="sniper-targets__empty">暂无国家，点击下方添加</div>
              ) : null}
              {sniperTargets.map((row, index) => (
                <div key={`sniper-${index}`} className="sniper-targets__row">
                  <input
                    className="sniper-targets__country"
                    type="text"
                    value={row.country}
                    disabled={!sniperEnabled}
                    maxLength={2}
                    placeholder="IR"
                    aria-label={`狙击国家 ${index + 1}`}
                    onChange={(event) => {
                      const value = event.target.value.toUpperCase();
                      setSniperTargets((current) => current.map((item, i) => (
                        i === index ? { ...item, country: value } : item
                      )));
                    }}
                  />
                  <input
                    className="sniper-targets__price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.maxPriceUsd}
                    disabled={!sniperEnabled}
                    placeholder="0.9"
                    aria-label={`${row.country || '国家'} 最高狙击价`}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSniperTargets((current) => current.map((item, i) => (
                        i === index ? { ...item, maxPriceUsd: value } : item
                      )));
                    }}
                  />
                  <button
                    type="button"
                    className="ghost-button sniper-targets__delete"
                    disabled={!sniperEnabled}
                    onClick={() => {
                      setSniperTargets((current) => current.filter((_, i) => i !== index));
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="ghost-button sniper-targets__add"
              disabled={!sniperEnabled}
              onClick={() => {
                setSniperTargets((current) => [...current, { country: '', maxPriceUsd: '' }]);
              }}
            >
              添加国家
            </button>
          </div>
        </div>

        {displayMessage ? (
          <div className={displayMessage.ok ? 'success-banner' : 'error-banner'}>
            {displayMessage.text}
            {displayMessage.hint ? <div>{displayMessage.hint}</div> : null}
          </div>
        ) : null}

        <div className="settings-actions">
          <button type="submit" className="primary-button" disabled={saving || loading}>
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            className="ghost-button"
            disabled={testing || pushingLatest}
            onClick={handleTestClick}
          >
            {testing ? '测试中…' : '发送测试'}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={pushingLatest || testing || loading}
            onClick={handlePushLatestClick}
          >
            {pushingLatest ? '推送中…' : '手动推送最新'}
          </button>
        </div>
      </form>
    </div>
  );
}
