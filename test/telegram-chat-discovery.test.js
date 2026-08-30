import { describe, expect, it } from 'vitest';
import { pickChatIdFromUpdates } from '../src/lib/telegram-chat-discovery';

describe('telegram-chat-discovery', () => {
  it('picks the latest chat id from updates', () => {
    const updates = [
      { update_id: 1, message: { chat: { id: 100, type: 'private' } } },
      { update_id: 3, message: { chat: { id: 200, type: 'private' } } },
      { update_id: 2, channel_post: { chat: { id: -300, type: 'channel' } } },
    ];
    const picked = pickChatIdFromUpdates(updates);
    expect(picked.chatId).toBe('200');
    expect(picked.updateId).toBe(3);
  });
});
