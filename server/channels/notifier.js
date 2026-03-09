// Central notification dispatcher for GuardClaw approvals.
// Routes approval notifications to all configured channels (Telegram, Discord).
// Generates one-click tokens for URL-based approval.

import crypto from 'crypto';
import { TelegramChannel } from './telegram.js';
import { DiscordChannel } from './discord.js';

export class ApprovalNotifier {
  constructor(config = {}) {
    this.telegram = null;
    this.discord = null;
    // approvalId → token (for one-click URL verification)
    this.tokens = new Map();
    // Callback: (approvalId, action, alwaysApprove) => Promise<void>
    this.onResolve = config.onResolve || null;

    const guardclawUrl = config.guardclawUrl || `http://127.0.0.1:${process.env.PORT || 3002}`;

    // Initialize Telegram
    const tgToken = config.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN;
    const tgChat = config.telegramChatId || process.env.TELEGRAM_CHAT_ID;
    if (tgToken && tgChat) {
      this.telegram = new TelegramChannel(tgToken, tgChat);
      this.telegram.onApprovalAction = (approvalId, action) => this._handleChannelAction(approvalId, action);
      this.telegram.startPolling();
      console.log('[Notifier] Telegram channel enabled');
    }

    // Initialize Discord
    const discordUrl = config.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL;
    if (discordUrl) {
      this.discord = new DiscordChannel(discordUrl, guardclawUrl);
      console.log('[Notifier] Discord channel enabled');
    }

    if (!this.telegram && !this.discord) {
      console.log('[Notifier] No notification channels configured');
    }
  }

  get hasChannels() {
    return !!(this.telegram || this.discord);
  }

  generateToken(approvalId) {
    const token = crypto.randomBytes(24).toString('base64url');
    this.tokens.set(approvalId, token);
    return token;
  }

  validateToken(approvalId, token) {
    const stored = this.tokens.get(approvalId);
    if (!stored || stored !== token) return false;
    return true;
  }

  consumeToken(approvalId) {
    this.tokens.delete(approvalId);
  }

  async notifyApprovalRequest(approval) {
    const token = this.generateToken(approval.id);
    const tasks = [];
    if (this.telegram) tasks.push(this.telegram.sendApprovalRequest(approval));
    if (this.discord) tasks.push(this.discord.sendApprovalRequest(approval, token));
    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }

  async notifyApprovalResolved(approvalId, action) {
    this.consumeToken(approvalId);
    const tasks = [];
    if (this.telegram) tasks.push(this.telegram.updateMessageResolved(approvalId, action));
    if (this.discord) tasks.push(this.discord.updateMessageResolved(approvalId, action));
    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }

  async _handleChannelAction(approvalId, action) {
    if (!this.onResolve) throw new Error('No resolve handler configured');
    const alwaysApprove = action === 'always';
    const resolveAction = action === 'deny' ? 'deny' : 'approve';
    await this.onResolve(approvalId, resolveAction, alwaysApprove);
  }

  async testChannels() {
    const results = {};
    if (this.telegram) results.telegram = await this.telegram.testConnection();
    if (this.discord) results.discord = await this.discord.testConnection();
    return results;
  }

  stop() {
    if (this.telegram) this.telegram.stopPolling();
  }
}
