import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { getSetting, setSetting } from '../src/lib/settings';
import {
  addTelegramRecipient,
  listTelegramAlertRecipients,
  listTelegramRecipients,
  removeTelegramRecipient,
  resolveTelegramNotifyChatIds,
  updateTelegramRecipient,
} from '../src/lib/telegram-recipients';

describe('telegram-recipients', () => {
  it('migrates legacy chat id and supports multiple recipients', () => {
    const db = createDatabase(':memory:');
    setSetting(db, 'telegram_notify_chat_id', '111');

    const migrated = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
    expect(migrated).toContain('111');

    addTelegramRecipient(db, getSetting, setSetting, { chatId: '222', label: '同事' });
    const ids = resolveTelegramNotifyChatIds(db, getSetting, setSetting);
    expect(ids.sort()).toEqual(['111', '222']);

    const recipients = listTelegramRecipients(db, getSetting, setSetting);
    expect(recipients).toHaveLength(2);
    expect(recipients.some((row) => row.chatId === '222' && row.label === '同事')).toBe(true);
    expect(recipients.every((row) => row.includeSource === true && row.providerKeys == null)).toBe(true);
  });

  it('updates includeSource and providerKeys filters', () => {
    const db = createDatabase(':memory:');
    const created = addTelegramRecipient(db, getSetting, setSetting, { chatId: '555', label: 'A' });
    const updated = updateTelegramRecipient(db, getSetting, setSetting, created.id, {
      includeSource: false,
      providerKeys: ['smstg', '5sim'],
    });
    expect(updated.includeSource).toBe(false);
    expect(updated.providerKeys).toEqual(['smstg', '5sim']);

    const forSmstg = listTelegramAlertRecipients(db, getSetting, setSetting, 'smstg');
    const forHero = listTelegramAlertRecipients(db, getSetting, setSetting, 'hero-sms');
    expect(forSmstg.map((row) => row.chatId)).toEqual(['555']);
    expect(forHero).toEqual([]);
  });

  it('removes recipient by id', () => {
    const db = createDatabase(':memory:');
    const first = addTelegramRecipient(db, getSetting, setSetting, { chatId: '333', label: 'A' });
    addTelegramRecipient(db, getSetting, setSetting, { chatId: '444', label: 'B' });
    expect(removeTelegramRecipient(db, getSetting, setSetting, first.id)).toBe(true);
    expect(resolveTelegramNotifyChatIds(db, getSetting, setSetting)).toEqual(['444']);
  });
});
