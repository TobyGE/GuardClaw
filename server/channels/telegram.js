// Telegram Bot API integration for GuardClaw approval notifications.
// Uses inline keyboard buttons for tap-to-approve UX.
// Polls for callback queries — no public URL needed.

const POLL_INTERVAL_MS = 1500;
const RISK_EMOJI = { high: '🔴', medium: '🟡', low: '🟢' };

export class TelegramChannel {
  constructor(botToken, chatId) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
    // approvalId → { messageId, chatId }
    this.sentMessages = new Map();
    this.pollOffset = 0;
    this.polling = false;
    this.onApprovalAction = null; // callback: (approvalId, action) => void
  }

  riskLevel(score) {
    if (score >= 8) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
  }

  formatMessage(approval) {
    const level = this.riskLevel(approval.riskScore);
    const emoji = RISK_EMOJI[level];
    const tool = approval.originalToolName || approval.toolName;
    const input = (approval.displayInput || '').slice(0, 300);
    const reason = (approval.reason || '').replace(/^⛨ GuardClaw (?:ASK|BLOCKED)[^:]*:\s*/, '');

    return [
      `${emoji} <b>GuardClaw — Approval Required</b>`,
      ``,
      `<b>Tool:</b> <code>${this.escapeHtml(tool)}</code>`,
      `<b>Risk:</b> ${approval.riskScore}/10`,
      `<b>Backend:</b> ${approval.backend || 'unknown'}`,
      ``,
      `<pre>${this.escapeHtml(input)}</pre>`,
      ``,
      `<i>${this.escapeHtml(reason)}</i>`,
    ].join('\n');
  }

  escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  async sendApprovalRequest(approval) {
    const text = this.formatMessage(approval);
    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${approval.id}` },
        { text: '✅ Always', callback_data: `always:${approval.id}` },
        { text: '❌ Deny', callback_data: `deny:${approval.id}` },
      ]],
    };

    try {
      const resp = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        }),
      });
      const data = await resp.json();
      if (data.ok) {
        this.sentMessages.set(approval.id, {
          messageId: data.result.message_id,
          chatId: data.result.chat.id,
        });
      } else {
        console.error('[Telegram] sendMessage failed:', data.description);
      }
    } catch (err) {
      console.error('[Telegram] sendMessage error:', err.message);
    }
  }

  async updateMessageResolved(approvalId, action) {
    const msg = this.sentMessages.get(approvalId);
    if (!msg) return;
    this.sentMessages.delete(approvalId);

    const icon = action === 'deny' ? '❌' : '✅';
    const label = action === 'deny' ? 'Denied' : action === 'always' ? 'Always Approved' : 'Approved';

    try {
      await fetch(`${this.baseUrl}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: msg.chatId,
          message_id: msg.messageId,
          reply_markup: { inline_keyboard: [[{ text: `${icon} ${label}`, callback_data: 'noop' }]] },
        }),
      });
    } catch {}
  }

  startPolling() {
    if (this.polling) return;
    this.polling = true;
    console.log('[Telegram] Polling started');
    this._poll();
  }

  stopPolling() {
    this.polling = false;
  }

  async _poll() {
    while (this.polling) {
      try {
        const resp = await fetch(
          `${this.baseUrl}/getUpdates?offset=${this.pollOffset}&timeout=10&allowed_updates=["callback_query"]`,
          { signal: AbortSignal.timeout(15_000) },
        );
        const data = await resp.json();
        if (data.ok && data.result.length > 0) {
          for (const update of data.result) {
            this.pollOffset = update.update_id + 1;
            if (update.callback_query) {
              await this._handleCallback(update.callback_query);
            }
          }
        }
      } catch (err) {
        if (err.name !== 'TimeoutError' && err.name !== 'AbortError') {
          console.error('[Telegram] Poll error:', err.message);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    }
  }

  async _handleCallback(query) {
    const data = query.data || '';
    const [action, approvalId] = data.split(':');
    if (!approvalId || action === 'noop') {
      await this._answerCallback(query.id, 'Already resolved');
      return;
    }

    if (action !== 'approve' && action !== 'deny' && action !== 'always') {
      await this._answerCallback(query.id, 'Unknown action');
      return;
    }

    const user = query.from?.first_name || 'User';
    console.log(`[Telegram] ${user} → ${action} (${approvalId})`);

    if (this.onApprovalAction) {
      try {
        await this.onApprovalAction(approvalId, action);
        const label = action === 'deny' ? 'Denied ❌' : action === 'always' ? 'Always Approved ✅' : 'Approved ✅';
        await this._answerCallback(query.id, label);
        await this.updateMessageResolved(approvalId, action);
      } catch (err) {
        await this._answerCallback(query.id, `Error: ${err.message}`);
      }
    } else {
      await this._answerCallback(query.id, 'No handler configured');
    }
  }

  async _answerCallback(callbackQueryId, text) {
    try {
      await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
      });
    } catch {}
  }

  async testConnection() {
    try {
      const resp = await fetch(`${this.baseUrl}/getMe`);
      const data = await resp.json();
      return { ok: data.ok, botName: data.result?.username || null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
