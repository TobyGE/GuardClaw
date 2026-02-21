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

  for (const event of chronological) {
    const type = event.type || '';

    if (type === 'chat-update' || type === 'chat-message') {
      // This is a parent: absorb any pending tool-calls
      turns.push({
        parent: event,
        toolCalls: pendingToolCalls,
        id: event.id || `turn-${event.timestamp}`,
      });
      pendingToolCalls = [];
    } else if (type === 'tool-call') {
      pendingToolCalls.push(event);
    } else {
      // Other event types (exec-started, exec-completed, etc.) — flush orphans then show standalone
      if (pendingToolCalls.length > 0) {
        // flush into an orphan turn before adding this
        turns.push({
          parent: null,
          toolCalls: [...pendingToolCalls],
          id: `orphan-${pendingToolCalls[0]?.id || Date.now()}`,
        });
        pendingToolCalls = [];
      }
      turns.push({
        parent: event,
        toolCalls: [],
        id: event.id || `standalone-${event.timestamp}`,
      });
    }
  }

  // Remaining orphan tool-calls (agent still running, no parent yet)
  if (pendingToolCalls.length > 0) {
    turns.push({
      parent: null,
      toolCalls: pendingToolCalls,
      id: `inprogress-${Date.now()}`,
    });
  }

  // Reverse back to newest-first for display
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
