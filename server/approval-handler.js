// GuardClaw Approval Handler
// Intercepts exec approval requests and makes intelligent decisions based on LLM risk analysis

export class ApprovalHandler {
  constructor(clawdbotClient, safeguardService, eventStore, config = {}) {
    this.client = clawdbotClient;
    this.safeguard = safeguardService;
    this.eventStore = eventStore;
    
    // Configuration
    this.mode = config.mode || process.env.GUARDCLAW_APPROVAL_MODE || 'auto';
    this.autoAllowThreshold = parseInt(config.autoAllowThreshold || process.env.GUARDCLAW_AUTO_ALLOW_THRESHOLD || '6');
    this.askThreshold = parseInt(config.askThreshold || process.env.GUARDCLAW_ASK_THRESHOLD || '8');
    this.autoBlockThreshold = parseInt(config.autoBlockThreshold || process.env.GUARDCLAW_AUTO_BLOCK_THRESHOLD || '9');
    
    // Pending approvals (waiting for user decision)
    this.pendingApprovals = new Map();
    
    // Stats
    this.stats = {
      total: 0,
      autoAllowed: 0,
      autoBlocked: 0,
      userApproved: 0,
      userDenied: 0,
      pending: 0
    };
    
    console.log(`[ApprovalHandler] Mode: ${this.mode}`);
    console.log(`[ApprovalHandler] Auto-allow: ≤${this.autoAllowThreshold}, Ask: ${this.autoAllowThreshold + 1}-${this.askThreshold}, Auto-block: ≥${this.autoBlockThreshold}`);
  }

  async handleApprovalRequest(event) {
    const payload = event.payload || event;
    const approvalId = payload.approvalId || payload.id;
    const command = payload.command || payload.args?.join(' ') || 'unknown';
    const agentId = payload.agentId || 'unknown';
    
    console.log(`\n[ApprovalHandler] 🔔 Approval request: ${approvalId}`);
    console.log(`[ApprovalHandler]    Command: ${command}`);
    console.log(`[ApprovalHandler]    Agent: ${agentId}`);
    
    this.stats.total++;
    
    // Monitor-only mode: just log and let Clawdbot handle it
    if (this.mode === 'monitor-only') {
      console.log(`[ApprovalHandler] 👀 Monitor mode - not intercepting`);
      return;
    }
    
    try {
      // Analyze command with LLM
      console.log(`[ApprovalHandler] 🧠 Analyzing with LLM...`);
      const analysis = await this.safeguard.analyzeCommand(command);
      
      console.log(`[ApprovalHandler] 📊 Risk Score: ${analysis.riskScore}/10`);
      console.log(`[ApprovalHandler] 📝 Reasoning: ${analysis.reasoning.substring(0, 100)}...`);
      
      // Store event
      const approvalEvent = {
        id: `approval-${approvalId}-${Date.now()}`,
        timestamp: Date.now(),
        type: 'exec-approval',
        subType: 'requested',
        approvalId,
        command,
        agentId,
        safeguard: analysis,
        status: 'pending'
      };
      this.eventStore.addEvent(approvalEvent);
      
      // Decision logic
      let decision = null;
      let reason = '';
      
      if (analysis.riskScore >= this.autoBlockThreshold) {
        // Auto-block high risk
        decision = 'deny';
        reason = `Auto-blocked: High risk (${analysis.riskScore}/10). ${analysis.reasoning}`;
        this.stats.autoBlocked++;
        console.log(`[ApprovalHandler] 🚫 AUTO-BLOCKED (risk ${analysis.riskScore})`);
      } else if (analysis.riskScore <= this.autoAllowThreshold) {
        // Auto-allow low risk
        decision = 'allow-once';
        reason = `Auto-allowed: Low risk (${analysis.riskScore}/10)`;
        this.stats.autoAllowed++;
        console.log(`[ApprovalHandler] ✅ AUTO-ALLOWED (risk ${analysis.riskScore})`);
      } else {
        // Medium risk - prompt user or auto-decide based on mode
        if (this.mode === 'prompt') {
          console.log(`[ApprovalHandler] ⏸️  Pending user decision (risk ${analysis.riskScore})`);
          this.pendingApprovals.set(approvalId, {
            ...approvalEvent,
            receivedAt: Date.now()
          });
          this.stats.pending++;
          return; // Don't auto-resolve, wait for user
        } else {
          // Auto mode: be conservative, block medium-high risk
          decision = 'deny';
          reason = `Auto-blocked: Medium-high risk (${analysis.riskScore}/10). ${analysis.reasoning}`;
          this.stats.autoBlocked++;
          console.log(`[ApprovalHandler] 🚫 AUTO-BLOCKED (medium risk ${analysis.riskScore})`);
        }
      }
      
      // Send decision to Clawdbot
      await this.resolveApproval(approvalId, decision, reason, analysis);
      
    } catch (error) {
      console.error(`[ApprovalHandler] ❌ Analysis failed:`, error.message);
      
      // On error, be conservative: deny in auto mode, let through in prompt mode
      if (this.mode === 'auto') {
        await this.resolveApproval(approvalId, 'deny', `Analysis failed: ${error.message}`, null);
      } else {
        console.log(`[ApprovalHandler] ⚠️  Letting Clawdbot handle due to analysis error`);
      }
    }
  }

  async resolveApproval(approvalId, action, reason, analysis) {
    try {
      console.log(`[ApprovalHandler] 📤 Resolving approval ${approvalId}: ${action}`);
      
      const response = await this.client.request('exec.approval.resolve', {
        approvalId,
        action, // 'allow-once', 'allow-always', or 'deny'
        reason
      });
      
      console.log(`[ApprovalHandler] ✅ Resolution sent successfully`);
      
      // Store resolution event
      this.eventStore.addEvent({
        id: `approval-${approvalId}-resolved-${Date.now()}`,
        timestamp: Date.now(),
        type: 'exec-approval',
        subType: 'resolved',
        approvalId,
        action,
        reason,
        safeguard: analysis,
        status: 'resolved'
      });
      
      // Remove from pending
      this.pendingApprovals.delete(approvalId);
      if (this.stats.pending > 0) this.stats.pending--;
      
      return response;
    } catch (error) {
      console.error(`[ApprovalHandler] ❌ Failed to resolve approval:`, error.message);
      throw error;
    }
  }

  async userResolve(approvalId, action) {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) {
      throw new Error(`Approval ${approvalId} not found in pending queue`);
    }
    
    const reason = action === 'deny'
      ? `User denied: Risk ${pending.safeguard.riskScore}/10`
      : `User approved: Risk ${pending.safeguard.riskScore}/10`;
    
    if (action === 'deny') {
      this.stats.userDenied++;
    } else {
      this.stats.userApproved++;
    }
    
    return await this.resolveApproval(approvalId, action, reason, pending.safeguard);
  }

  getPendingApprovals() {
    return Array.from(this.pendingApprovals.values());
  }

  getStats() {
    return {
      ...this.stats,
      mode: this.mode,
      thresholds: {
        autoAllow: this.autoAllowThreshold,
        ask: this.askThreshold,
        autoBlock: this.autoBlockThreshold
      }
    };
  }

  clearPending() {
    this.pendingApprovals.clear();
    this.stats.pending = 0;
  }
}
