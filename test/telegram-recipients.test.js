import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/lib/db';
import { getSetting, setSetting } from '../src/lib/settings';
import {
  addTelegramRecipient,
  listTelegramRecipients,
  removeTelegramRecipient,
  resolveTelegramNotifyChatIds,
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
  });

  it('removes recipient by id', () => {
    const db = createDatabase(':memory:');
    const first = addTelegramRecipient(db, getSetting, setSetting, { chatId: '333', label: 'A' });
    addTelegramRecipient(db, getSetting, setSetting, { chatId: '444', label: 'B' });
    expect(removeTelegramRecipient(db, getSetting, setSetting, first.id)).toBe(true);
    expect(resolveTelegramNotifyChatIds(db, getSetting, setSetting)).toEqual(['444']);
  });
});
