// WhatsApp Business Cloud API integration for GuardClaw approval notifications.
// Sends interactive button messages for tap-to-approve UX.
// Receives button callbacks via webhook endpoint.

const GRAPH_API = 'https://graph.facebook.com/v21.0';

export class WhatsAppChannel {
  constructor(token, phoneNumberId, recipientPhone) {
    this.token = token;
    this.phoneNumberId = phoneNumberId;
    this.recipientPhone = recipientPhone;
    this.baseUrl = `${GRAPH_API}/${phoneNumberId}/messages`;
    // approvalId → { waMessageId }
    this.sentMessages = new Map();
    this.onApprovalAction = null; // callback: (approvalId, action) => void
  }

  async sendApprovalRequest(approval) {
    const tool = approval.originalToolName || approval.toolName;
    const input = (approval.displayInput || '').slice(0, 300);
    const reason = (approval.reason || '').replace(/^⛨ GuardClaw (?:ASK|BLOCKED)[^:]*:\s*/, '');
    const riskBar = '🔴'.repeat(Math.min(Math.round(approval.riskScore / 2), 5));

    const bodyText = [
      `🛡️ *GuardClaw — Approval Required*`,
      ``,
      `*Tool:* \`${tool}\``,
      `*Risk:* ${approval.riskScore}/10 ${riskBar}`,
      `*Backend:* ${approval.backend || 'unknown'}`,
      ``,
      `\`\`\`${input}\`\`\``,
      ``,
      `_${reason.slice(0, 200)}_`,
    ].join('\n');

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this.recipientPhone,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: [
            { type: 'reply', reply: { id: `approve:${approval.id}`, title: '✅ Approve' } },
            { type: 'reply', reply: { id: `always:${approval.id}`, title: '✅ Always' } },
            { type: 'reply', reply: { id: `deny:${approval.id}`, title: '❌ Deny' } },
          ],
        },
      },
    };

    try {
      const resp = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await resp.json();
      if (data.messages?.[0]?.id) {
        this.sentMessages.set(approval.id, { waMessageId: data.messages[0].id });
      } else {
        console.error('[WhatsApp] sendMessage failed:', JSON.stringify(data.error || data));
      }
    } catch (err) {
      console.error('[WhatsApp] sendMessage error:', err.message);
    }
  }

  async updateMessageResolved(approvalId, action) {
    const msg = this.sentMessages.get(approvalId);
    if (!msg) return;
    this.sentMessages.delete(approvalId);

    // WhatsApp doesn't support editing messages — send a follow-up
    const icon = action === 'deny' ? '❌' : '✅';
    const label = action === 'deny' ? 'Denied' : action === 'always' ? 'Always Approved' : 'Approved';

    try {
      await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: this.recipientPhone,
          type: 'text',
          text: { body: `${icon} *${label}* — \`${approvalId}\`` },
        }),
      });
    } catch {}
  }

  // Handle incoming webhook from Meta (button callback)
  handleWebhook(body) {
    const entries = body?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        const messages = change?.value?.messages || [];
        for (const msg of messages) {
          if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
            const buttonId = msg.interactive.button_reply.id || '';
            const [action, approvalId] = buttonId.split(':');
            if (approvalId && (action === 'approve' || action === 'deny' || action === 'always')) {
              console.log(`[WhatsApp] Button: ${action} (${approvalId})`);
              if (this.onApprovalAction) {
                this.onApprovalAction(approvalId, action).catch(err => {
                  console.error('[WhatsApp] Action error:', err.message);
                });
              }
            }
          }
        }
      }
    }
  }

  async testConnection() {
    try {
      const resp = await fetch(`${GRAPH_API}/${this.phoneNumberId}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      const data = await resp.json();
      return { ok: !data.error, phoneNumber: data.display_phone_number || null, error: data.error?.message };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
