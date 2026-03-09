// Discord webhook integration for GuardClaw approval notifications.
// Sends rich embeds with one-click approve/deny URLs.

const RISK_COLORS = { high: 0xef4444, medium: 0xf59e0b, low: 0x22c55e };

export class DiscordChannel {
  constructor(webhookUrl, guardclawUrl) {
    this.webhookUrl = webhookUrl;
    this.guardclawUrl = guardclawUrl; // e.g. http://127.0.0.1:3002
    // approvalId → webhookMessageId (for editing resolved state)
    this.sentMessages = new Map();
  }

  riskLevel(score) {
    if (score >= 8) return 'high';
    if (score >= 5) return 'medium';
    return 'low';
  }

  async sendApprovalRequest(approval, token) {
    const level = this.riskLevel(approval.riskScore);
    const tool = approval.originalToolName || approval.toolName;
    const input = (approval.displayInput || '').slice(0, 500);
    const reason = (approval.reason || '').replace(/^⛨ GuardClaw (?:ASK|BLOCKED)[^:]*:\s*/, '');
    const approveUrl = `${this.guardclawUrl}/api/approvals/${approval.id}/one-click?action=approve&token=${token}`;
    const alwaysUrl = `${this.guardclawUrl}/api/approvals/${approval.id}/one-click?action=always&token=${token}`;
    const denyUrl = `${this.guardclawUrl}/api/approvals/${approval.id}/one-click?action=deny&token=${token}`;

    const embed = {
      title: '🛡️ GuardClaw — Approval Required',
      color: RISK_COLORS[level],
      fields: [
        { name: 'Tool', value: `\`${tool}\``, inline: true },
        { name: 'Risk', value: `**${approval.riskScore}/10**`, inline: true },
        { name: 'Backend', value: approval.backend || 'unknown', inline: true },
        { name: 'Command', value: `\`\`\`\n${input.slice(0, 1000)}\n\`\`\`` },
        { name: 'Reason', value: reason.slice(0, 200) || 'N/A' },
        { name: 'Actions', value: `[✅ Approve](${approveUrl}) · [✅ Always](${alwaysUrl}) · [❌ Deny](${denyUrl})` },
      ],
      timestamp: new Date().toISOString(),
      footer: { text: `ID: ${approval.id}` },
    };

    try {
      const resp = await fetch(`${this.webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ embeds: [embed] }),
      });
      const data = await resp.json();
      if (data.id) {
        this.sentMessages.set(approval.id, data.id);
      }
    } catch (err) {
      console.error('[Discord] webhook error:', err.message);
    }
  }

  async updateMessageResolved(approvalId, action) {
    const msgId = this.sentMessages.get(approvalId);
    if (!msgId) return;
    this.sentMessages.delete(approvalId);

    const label = action === 'deny' ? '❌ Denied' : '✅ Approved';
    const color = action === 'deny' ? 0xef4444 : 0x22c55e;

    try {
      await fetch(`${this.webhookUrl}/messages/${msgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title: `🛡️ GuardClaw — ${label}`,
            color,
            description: `Approval \`${approvalId}\` has been ${label.toLowerCase()}.`,
            timestamp: new Date().toISOString(),
          }],
        }),
      });
    } catch {}
  }

  async testConnection() {
    try {
      const resp = await fetch(this.webhookUrl);
      const data = await resp.json();
      return { ok: !!data.id, name: data.name || null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
