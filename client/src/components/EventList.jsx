import TurnItem from './TurnItem';
import EventItem from './EventItem';

/**
 * Group events into conversation turns.
 * Events come in newest-first order from the API.
 *
 * A "turn" is a group of tool-call events that belong to the same agent
 * response, optionally capped by a parent chat-update or chat-message event.
 *
 * Algorithm (work on oldest-first; final display is also oldest-first / newest at bottom):
 *   1. Reverse events to oldest-first
 *   2. Walk forward; accumulate tool-calls into a pending buffer
 *   3. When we hit a chat-update/chat-message → it becomes the parent; flush buffer as its children
 *   4. Remaining orphan tool-calls (no parent yet) → one extra "In Progress" group
 *   5. Return groups in chronological order (oldest first, newest last)
 */
function groupEventsIntoTurns(events) {
  // Events from API are newest-first; reverse to process chronologically
  const chronological = [...events].reverse();

  const turns = [];
  // Separate pending buffers for OC and CC to avoid cross-contamination in "All" mode
  let pendingOCTools = [];    // OC tool-call events
  let pendingCCTools = [];    // CC claude-code-tool / claude-code-text events
  let pendingReplies = [];    // CC reply segments
  let pendingPrompt = null;   // CC user prompt

  // Flush helpers
  const flushOC = () => {
    if (pendingOCTools.length > 0) {
      turns.push({ parent: null, toolCalls: pendingOCTools, id: `oc-orphan-${pendingOCTools[0].timestamp}` });
      pendingOCTools = [];
    }
  };
  const flushCC = () => {
    if (pendingCCTools.length > 0 || pendingReplies.length > 0 || pendingPrompt) {
      turns.push({
        parent: pendingReplies[pendingReplies.length - 1] || null,
        userPrompt: pendingPrompt,
        toolCalls: [...pendingCCTools],
        replies: [...pendingReplies],
        isCCTurn: true,
        id: pendingPrompt?.id || `cc-orphan-${Date.now()}`,
      });
      pendingCCTools = [];
      pendingReplies = [];
      pendingPrompt = null;
    }
  };

  for (const event of chronological) {
    const type = event.type || '';

    // ── OpenClaw: chat reply closes the current OC tool-call group ──
    const isOCChat = type === 'chat-update' || type === 'chat-message';
    // ── Claude Code event types ──
    const isCCReply = type === 'claude-code-reply';
    const isCCTool = type === 'claude-code-tool';
    const isCCText = type === 'claude-code-text';
    const isCCPrompt = type === 'claude-code-prompt';
    const isContext = event.safeguard?.isContext;

    if (isOCChat) {
      // OC chat event — flush any pending CC turn first (interleaved backends)
      flushCC();
      if (pendingOCTools.length > 0) {
        turns.push({ parent: event, toolCalls: pendingOCTools, id: event.id || `turn-${event.timestamp}` });
        pendingOCTools = [];
      } else {
        const last = turns[turns.length - 1];
        if (last && last.toolCalls.length > 0 && !last.reply && isContext) {
          last.reply = event;
        } else {
          turns.push({ parent: event, toolCalls: [], id: event.id || `turn-${event.timestamp}` });
        }
      }
    } else if (type === 'tool-call') {
      pendingOCTools.push(event);
    } else if (isCCPrompt) {
      // New CC user prompt → flush both buffers
      flushOC();
      flushCC();
      pendingPrompt = event;
    } else if (isCCTool || isCCText) {
      pendingCCTools.push(event);
    } else if (isCCReply) {
      const promptId = event.promptId;
      if (!promptId || promptId === pendingPrompt?.id) {
        pendingReplies.push(event);
      } else {
        // Retroactively attach to the correct already-flushed CC turn
        let matched = false;
        for (let i = turns.length - 1; i >= 0; i--) {
          if (turns[i].isCCTurn && turns[i].userPrompt?.id === promptId) {
            turns[i].replies = turns[i].replies || [];
            turns[i].replies.push(event);
            matched = true;
            break;
          }
        }
        if (!matched) pendingReplies.push(event);
      }
    } else {
      // Unknown event type — flush both, show standalone
      flushOC();
      flushCC();
      turns.push({ parent: event, toolCalls: [], id: event.id || `standalone-${event.timestamp}` });
    }
  }

  // Remaining in-progress turns
  if (pendingOCTools.length > 0) {
    turns.push({
      parent: null,
      toolCalls: pendingOCTools,
      isCCTurn: false,
      id: `oc-inprogress-${Date.now()}`,
    });
  }
  if (pendingCCTools.length > 0 || pendingReplies.length > 0 || pendingPrompt) {
    turns.push({
      parent: pendingReplies[pendingReplies.length - 1] || null,
      userPrompt: pendingPrompt,
      toolCalls: pendingCCTools,
      replies: pendingReplies,
      isCCTurn: !!pendingPrompt,
      id: pendingPrompt?.id || `cc-inprogress-${Date.now()}`,
    });
  }

  // Newest-first: most recent turn at top
  return turns.reverse();
}

function EventList({ events }) {
  if (events.length === 0) {
    return (
      <div className="px-6 py-12 text-center text-gc-text-dim">
        <p className="text-lg">No events yet. Waiting for agent activity...</p>
        <p className="text-sm mt-2">Events will appear here in real-time</p>
      </div>
    );
  }

  const turns = groupEventsIntoTurns(events);

  return (
    <div className="divide-y divide-gc-border">
      {turns.map((turn) => (
        <TurnItem key={turn.id} turn={turn} />
      ))}
    </div>
  );
}

export default EventList;
