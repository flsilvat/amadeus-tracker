// =============================================================================
// Command processor (Phase 4)
//
// Subscribes to pending commands in Firestore and runs them. Each service
// function already serialises its JFE work through the shared queue, so we just
// invoke the matching handler. Runs only while this service is up; commands
// queued while it's down are picked up next start.
// =============================================================================
import { logger } from '../logger.js';
import {
  createOrUpdateGroupAndDiscover,
  refreshGroup,
  refreshAllActiveGroups,
} from '../service.js';
import {
  subscribePendingCommands,
  claimCommand,
  completeCommand,
  failCommand,
  reclaimStaleCommands,
} from '../storage/firestore.js';

const HANDLERS = {
  createGroup: (p) => createOrUpdateGroupAndDiscover(p.group),
  refreshGroup: (p) => refreshGroup(p.groupId),
  refreshAll: () => refreshAllActiveGroups(),
};

function summarize(type, result) {
  if (type === 'createGroup') return { discovered: Array.isArray(result) ? result.length : null };
  if (type === 'refreshGroup' || type === 'refreshAll') {
    return { refreshed: Array.isArray(result) ? result.length : (result ?? null) };
  }
  return null;
}

// Guards the brief window between a snapshot firing and the status update
// propagating, so a command isn't picked up twice.
const handled = new Set();

export function startCommandProcessor() {
  logger.info('command processor listening for pending commands');
  // Recover anything left 'running' by a previous crash/Ctrl-C. The flip to
  // 'pending' triggers the subscription below, so they resume on their own.
  reclaimStaleCommands();
  return subscribePendingCommands((cmds) => {
    cmds.sort((a, b) => a.createdAtMs - b.createdAtMs); // oldest first
    for (const cmd of cmds) {
      if (handled.has(cmd.id)) continue;
      handled.add(cmd.id);
      void processOne(cmd);
    }
  });
}

async function processOne(cmd) {
  const claimed = await claimCommand(cmd.id);
  if (!claimed) return; // someone/something else took it, or it's gone
  logger.info({ id: cmd.id, type: cmd.type }, 'processing command');
  try {
    const handler = HANDLERS[cmd.type];
    if (!handler) throw new Error(`unknown command type: ${cmd.type}`);
    const result = await handler(cmd.payload || {});
    await completeCommand(cmd.id, summarize(cmd.type, result));
    logger.info({ id: cmd.id, type: cmd.type }, 'command done');
  } catch (err) {
    await failCommand(cmd.id, err.message);
    logger.error({ id: cmd.id, type: cmd.type, err: err.message }, 'command failed');
  }
}
