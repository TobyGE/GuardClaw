import TurnItem from './TurnItem';
import EventItem from './EventItem';

/**
 * Group events into conversation turns.
 * Events come in newest-first order from the API.
 *
 * A "turn" is a group of tool-call events that belong to the same agent
 * response, optionally capped by a parent chat-update or chat-message event.
 *
 * Algorithm (work on oldest-first, then reverse for display):
 *   1. Reverse events to oldest-first
 *   2. Walk forward; accumulate tool-calls into a pending buffer
 *   3. When we hit a chat-update/chat-message → it becomes the parent; flush buffer as its children
 *   4. Remaining orphan tool-calls (no parent yet) → one extra "In Progress" group
 *   5. Re-reverse groups for newest-first display
 */
function groupEventsIntoTurns(events) {
  // Events from API are newest-first; reverse to process chronologically
  const chronological = [...events].reverse();

  const turns = [];
  let pendingToolCalls = [];
  let pendingPrompt = null; // user's message that started this CC turn

  for (const event of chronological) {
    const type = event.type || '';

    // ── OpenClaw: chat reply closes the current tool-call group ──
    const isOCChat = type === 'chat-update' || type === 'chat-message';
    // ── Claude Code: reply closes the CC tool-call group ──
    const isCCReply = type === 'claude-code-reply';
    // ── Claude Code: tool call ──
    const isCCTool = type === 'claude-code-tool';
    // ── Claude Code: user prompt starts a new turn ──
    const isCCPrompt = type === 'claude-code-prompt';
    const isContext = event.safeguard?.isContext;

    if (isOCChat) {
      if (pendingToolCalls.length > 0) {
        turns.push({ parent: event, toolCalls: pendingToolCalls, id: event.id || `turn-${event.timestamp}` });
        pendingToolCalls = [];
      } else {
        const last = turns[turns.length - 1];
        if (last && last.toolCalls.length > 0 && !last.reply && isContext) {
          last.reply = event;
        } else {
          turns.push({ parent: event, toolCalls: [], id: event.id || `turn-${event.timestamp}` });
        }
      }
    } else if (type === 'tool-call') {
      pendingToolCalls.push(event);
    } else if (isCCPrompt) {
      // Flush any orphan CC tool calls from the previous turn
      if (pendingToolCalls.length > 0) {
        turns.push({ parent: null, userPrompt: pendingPrompt, toolCalls: [...pendingToolCalls], isCCTurn: true, id: `cc-orphan-${Date.now()}` });
        pendingToolCalls = [];
      }
      pendingPrompt = event;
    } else if (isCCTool) {
      pendingToolCalls.push(event);
    } else if (isCCReply) {
      // CC reply closes the current CC turn
      turns.push({
        parent: event,          // reply event
        userPrompt: pendingPrompt,
        toolCalls: pendingToolCalls,
        isCCTurn: true,
        id: event.id || `cc-turn-${event.timestamp}`,
      });
      pendingToolCalls = [];
      pendingPrompt = null;
    } else {
      // Other event types — flush orphans then show standalone
      if (pendingToolCalls.length > 0) {
        turns.push({ parent: null, toolCalls: [...pendingToolCalls], isCCTurn: pendingToolCalls[0]?.type === 'claude-code-tool', id: `orphan-${pendingToolCalls[0]?.id || Date.now()}` });
        pendingToolCalls = [];
        pendingPrompt = null;
      }
      turns.push({ parent: event, toolCalls: [], id: event.id || `standalone-${event.timestamp}` });
    }
  }

  // Remaining orphans
  if (pendingToolCalls.length > 0) {
    turns.push({
      parent: null,
      userPrompt: pendingPrompt,
      toolCalls: pendingToolCalls,
      isCCTurn: pendingToolCalls[0]?.type === 'claude-code-tool',
      id: `inprogress-${Date.now()}`,
    });
  }

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
