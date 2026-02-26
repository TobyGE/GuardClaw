// ─── Helper functions (extracted from index.js) ─────────────────────────────

export function shouldSkipEvent(eventDetails) {
  if (eventDetails.subType === 'delta' || eventDetails.subType === 'content_block_delta') return true;
  if (eventDetails.type === 'agent-message' && eventDetails.subType !== 'final') return true;
  if (eventDetails.type === 'tool-result') return true;
  if (eventDetails.type === 'exec-output') return true;
  if (eventDetails.type === 'health' || eventDetails.type === 'heartbeat') return true;
  return false;
}

export function shouldAnalyzeEvent(eventDetails) {
  if (eventDetails.type === 'exec-started') return true;
  if (eventDetails.type === 'tool-call') return true;
  return false;
}

export function extractAction(event, eventDetails) {
  const action = {
    type: eventDetails.tool || eventDetails.type,
    tool: eventDetails.tool,
    command: eventDetails.command,
    description: eventDetails.description,
    summary: '',
    raw: event
  };

  if (eventDetails.tool === 'exec') {
    action.summary = eventDetails.command || 'unknown exec command';
  } else if (eventDetails.tool === 'write') {
    const path = event.payload?.data?.input?.path || event.payload?.data?.input?.file_path || 'unknown';
    action.summary = `write file: ${path}`;
  } else if (eventDetails.tool === 'edit') {
    const path = event.payload?.data?.input?.path || event.payload?.data?.input?.file_path || 'unknown';
    action.summary = `edit file: ${path}`;
  } else if (eventDetails.tool === 'read') {
    const path = event.payload?.data?.input?.path || event.payload?.data?.input?.file_path || 'unknown';
    action.summary = `read file: ${path}`;
  } else if (eventDetails.tool === 'web_fetch') {
    const url = event.payload?.data?.input?.url || 'unknown';
    action.summary = `fetch URL: ${url}`;
  } else if (eventDetails.tool === 'browser') {
    const subAction = event.payload?.data?.input?.action || 'unknown';
    const url = event.payload?.data?.input?.targetUrl || '';
    action.summary = `browser ${subAction}${url ? ': ' + url : ''}`;
  } else if (eventDetails.tool === 'message') {
    const target = event.payload?.data?.input?.target || 'unknown';
    action.summary = `send message to: ${target}`;
  } else if (eventDetails.type === 'chat-update' || eventDetails.type === 'agent-message' || eventDetails.type === 'chat-message') {
    const text = eventDetails.description || '';
    action.summary = `chat message: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`;
    action.fullText = text;
  } else {
    action.summary = `${eventDetails.tool || eventDetails.type || 'unknown'}`;
  }

  return action;
}

export function classifyNonExecEvent(eventDetails) {
  const type = eventDetails.type;

  if (type === 'health' || type === 'heartbeat' || type === 'connection') {
    return { riskScore: 0, category: 'safe', reasoning: 'System health check or heartbeat', allowed: true, warnings: [], backend: 'classification' };
  }

  if (type === 'chat-update' || type === 'agent-message' || type === 'chat-message') {
    return { isContext: true, riskScore: null, category: 'context', reasoning: 'Conversation message — stored for context only', allowed: true, warnings: [], backend: 'classification' };
  }

  return { riskScore: 0, category: 'safe', reasoning: 'Unknown event type', allowed: true, warnings: [], backend: 'classification' };
}

export function parseEventDetails(event) {
  const details = { type: 'unknown', subType: null, description: '', tool: null, command: null };
  const eventType = event.event || event.type;
  const payload = event.payload || {};

  if (eventType === 'exec.started') {
    details.type = 'exec-started'; details.tool = 'exec'; details.command = payload.command;
    details.description = `exec: ${payload.command || 'unknown'}`;
    return details;
  }
  if (eventType === 'exec.output') {
    details.type = 'exec-output'; details.tool = 'exec';
    const output = payload.output || '';
    details.description = output.length > 100 ? output.substring(0, 100) + '...' : output;
    return details;
  }
  if (eventType === 'exec.completed') {
    details.type = 'exec-completed'; details.tool = 'exec';
    details.description = `Completed (exit ${payload.exitCode || 0})`;
    return details;
  }

  switch (eventType) {
    case 'agent':
      if (payload.data?.type === 'tool_use') {
        details.type = 'tool-call'; details.tool = payload.data.name; details.subType = payload.data.name;
        details.description = `${payload.data.name}`;
        const input = payload.data.input || payload.data.args || {};
        if (payload.data.name === 'exec' && input.command) {
          details.command = input.command;
          details.description = `exec: ${details.command}`;
        } else if (payload.data.name === 'edit') {
          const file = input.file_path || input.path || '';
          const oldStr = (input.old_string || input.oldText || '').substring(0, 100);
          const newStr = (input.new_string || input.newText || '').substring(0, 100);
          details.command = oldStr || newStr
            ? `edit ${file}\n--- old: ${oldStr}${oldStr.length >= 100 ? '…' : ''}\n+++ new: ${newStr}${newStr.length >= 100 ? '…' : ''}`
            : `edit ${file}`;
          details.description = `edit file: ${file}`;
        } else if (payload.data.name === 'write') {
          const file = input.file_path || input.path || '';
          const content = (input.content || '').substring(0, 150);
          details.command = `write ${file}\n${content}${content.length >= 150 ? '…' : ''}`;
          details.description = `write file: ${file}`;
        }
        return details;
      }
      if (payload.data?.type === 'tool_result') {
        details.type = 'tool-result'; details.tool = 'result';
        details.subType = payload.data.tool_use_id || 'unknown';
        const content = payload.data.content?.[0]?.text || '';
        details.description = content.length > 100 ? content.substring(0, 100) + '...' : content;
        return details;
      }
      details.type = 'agent-message'; details.subType = payload.stream || 'unknown';
      if (payload.data?.text) {
        const text = payload.data.text;
        details.description = text.length > 100 ? text.substring(0, 100) + '...' : text;
      }
      break;

    case 'chat':
      details.type = 'chat-update'; details.subType = payload.state || 'unknown';
      if (payload.message?.content) {
        let text = '';
        const content = payload.message.content;
        if (Array.isArray(content)) {
          for (const block of content) { if (block.type === 'text' && block.text) text += block.text; }
        } else if (typeof content === 'string') { text = content; }
        details.description = text || JSON.stringify(content).substring(0, 100);
      }
      break;

    case 'tick': details.type = 'heartbeat'; details.description = 'Gateway heartbeat'; break;
    case 'hello': case 'hello-ok': details.type = 'connection'; details.description = 'Gateway connection'; break;
    case 'health': details.type = 'health'; details.description = 'Health check'; break;

    default:
      details.type = eventType || 'unknown';
      if (payload.tool) {
        details.type = 'tool-call'; details.tool = payload.tool; details.subType = payload.tool;
        details.description = `${payload.tool} called`;
      } else if (payload.stream) {
        details.subType = payload.stream; details.description = `Stream: ${payload.stream}`;
      }
  }
  return details;
}

export function isExecCommand(event) {
  const eventType = event.event || event.type;
  if (eventType === 'exec.started') return true;
  if (eventType === 'exec.output') return false;
  if (eventType === 'exec.completed') return false;
  if (eventType === 'agent' && event.payload?.data?.type === 'tool_use') return event.payload.data.name === 'exec';
  const details = parseEventDetails(event);
  return details.tool === 'exec' && details.type === 'exec-started';
}

export function extractCommand(event) {
  if (event.payload?.command) return event.payload.command;
  if (event.payload?.args?.command) return event.payload.args.command;
  if (event.command) return event.command;
  if (event.data?.command) return event.data.command;
  const details = parseEventDetails(event);
  return details.command || 'unknown command';
}
