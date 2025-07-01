const { getClickUpTaskDetails, getClickUpSpaceDetails } = require('../services/clickup');
const {
  findCompanyIdByName,
  createHubspotTask,
  findHubspotOwnerIdByEmail,
  updateHubspotTaskField,
  updateHubspotTicketField
} = require('../services/hubspot');
const {
  saveSyncedItem,
  isClickupTaskAlreadySynced,
  findSyncedItemByClickupTaskId
} = require('../db/syncedItems');

const { cleanQuillDelta } = require('../utils/cleanQuillDelta');
const cheerio = require("cheerio");

function htmlToQuillDelta(html) {
  const $ = cheerio.load(html);
  const ops = [];

  function walk(node) {
    if (node.type === "text") {
      ops.push({ insert: node.data });
    } else if (node.name === "a") {
      const text = $(node).text();
      const href = $(node).attr("href");
      ops.push({
        insert: text,
        attributes: { link: href }
      });
    } else if (node.children) {
      node.children.forEach(walk);
    }
  }

  $("body").contents().each((_, el) => walk(el));
  ops.push({ insert: "\n" });
  return { ops };
}

function isLikelyDelta(obj) {
  return obj && typeof obj === 'object' && Array.isArray(obj.ops);
}

const pendingClickUpSyncs = new Set();

function getOneWeekFromNowISO() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString();
}

const PRIORITY_MAP = {
  task: {
    urgent: 'HIGH',
    high: 'HIGH',
    normal: 'MEDIUM',
    low: 'LOW'
  },
  ticket: {
    urgent: 'URGENT',
    high: 'HIGH',
    normal: 'MEDIUM',
    low: 'LOW'
  }
};

const STATUS_MAP = {
  task: status => (status === 'complete' ? 'COMPLETED' : 'NOT_STARTED'),
  ticket: status => {
    if (status === 'complete') return '4'; // Closed
    if (status === 'not started') return '1'; // New
    return '3'; // Waiting on us
  }
};

const FIELD_MAPPING = {
  task: {
    name: 'hs_task_subject',
    content: 'hs_task_body',
    due_date: 'hs_timestamp',
    assignees: 'hubspot_owner_id',
    priority: 'hs_task_priority',
    status: 'hs_task_status'
  },
  ticket: {
    name: 'subject',
    content: 'content',
    due_date: 'closed_date',
    assignees: 'hubspot_owner_id',
    priority: 'hs_ticket_priority',
    status: 'hs_pipeline_stage'
  }
};

async function handleClickupTasks(event) {
  const taskId = event.task_id;
  if (!taskId) return;

  console.log(`📅 ClickUp Event Received: ${event.event} (taskId: ${taskId})`);

  if (event.event === 'taskUpdated') {
    let syncedRecord = await findSyncedItemByClickupTaskId(taskId);

    if (!syncedRecord) {
      if (pendingClickUpSyncs.has(taskId)) {
        console.log(`🕒 Already waiting for sync of ClickUp task ${taskId}. Skipping duplicate wait.`);
        return;
      }

      console.log(`⏳ Task ${taskId} not yet synced. Waiting 30s before retry.`);
      pendingClickUpSyncs.add(taskId);
      await new Promise(resolve => setTimeout(resolve, 30000));
      pendingClickUpSyncs.delete(taskId);

      syncedRecord = await findSyncedItemByClickupTaskId(taskId);

      if (!syncedRecord) {
        console.log(`🔁 Still not found after 30s. Creating new task in HubSpot.`);
        return await handleClickupTasks({ ...event, event: 'taskCreated' });
      } else {
        console.log(`✅ Task ${taskId} got synced during wait. Proceeding with update.`);
      }
    }

    const history = event.history_items || [];
    const hubspotType = syncedRecord.hubspot_object_type;
    const hubspotId = syncedRecord.hubspot_object_id;
    const mapping = FIELD_MAPPING[hubspotType];
    console.log(event);

    for (const item of history) {
      console.log(`🧾 Change detected – field: ${item.field}`);
      if (item.before) console.log(`   🔙 before:`, item.before);
      if (item.after) console.log(`   🔜 after:`, item.after);

      const field = item.field || 'unknown';

      if (field === 'assignee_rem') {
        console.log(`ℹ️ Skipping assignee removal event for task ${taskId}`);
        continue;
      }

      if (field === 'assignee_add') {
        const userObj = item.after || {};
        const email = userObj?.email;

        if (email) {
          const hubspotOwnerId = await findHubspotOwnerIdByEmail(email);
          if (hubspotOwnerId) {
            const property = mapping.assignees;
            if (hubspotType === 'task') {
              await updateHubspotTaskField(hubspotId, property, hubspotOwnerId);
            } else {
              await updateHubspotTicketField(hubspotId, property, hubspotOwnerId);
            }
            console.log(`✅ Synced ${property} for ${hubspotType} (${taskId})`);
          }
        }
        continue;
      }

      const hubspotProperty = mapping?.[field];
      if (!hubspotProperty) continue;

      let finalValue = null;

      if (field === 'status') {
        const statusStr = (item.after?.status || '').toString().toLowerCase();
        finalValue = STATUS_MAP[hubspotType]?.(statusStr);
      } else if (field === 'priority') {
        const beforePriority = item.before?.priority?.toLowerCase();
        const afterPriority = item.after?.priority?.toLowerCase();

        if (beforePriority === afterPriority) {
          console.log(`⏭️ Skipping priority update – no actual change (${afterPriority})`);
          continue;
        }

        const rawPriority = afterPriority;

        if (rawPriority && typeof rawPriority === 'string') {
          finalValue = PRIORITY_MAP[hubspotType]?.[rawPriority] || null;
        } else {
          console.warn(`⚠️ Could not extract valid priority from:`, item.after);
          continue;
        }
      } else if (field === 'content') {
          let rawContent = item.after;

          try {
            if (typeof rawContent === 'string') {
              rawContent = JSON.parse(rawContent);
            }
          } catch (err) {
            console.warn(`⚠️ Could not parse content as JSON, assuming HTML.`, err.message);
          }

          if (isLikelyDelta(rawContent)) {
            finalValue = rawContent; // ya está en formato válido
          } else {
            const html = typeof item.after === 'string' ? item.after : item.after?.value || '';
            finalValue = htmlToQuillDelta(html);
          }
        } else {
        try {
          finalValue = typeof item.after === 'string' ? JSON.parse(item.after) : item.after;
        } catch {
          finalValue = item.after;
        }

        if (
          typeof finalValue === 'object' &&
          !Array.isArray(finalValue) &&
          finalValue !== null
        ) {
          finalValue = finalValue.value || JSON.stringify(finalValue);
        }
      }

      const isValidType =
        typeof finalValue === 'string' ||
        (typeof finalValue === 'number' && !isNaN(finalValue));

      if (!isValidType) {
        console.warn(`⚠️ Skipping ${hubspotProperty}: invalid value`, finalValue);
        continue;
      }

      if (hubspotType === 'task') {
        await updateHubspotTaskField(hubspotId, hubspotProperty, finalValue);
      } else {
        await updateHubspotTicketField(hubspotId, hubspotProperty, finalValue);
      }

      console.log(`✅ Synced ${hubspotProperty} for ${hubspotType} (${taskId})`);
    }

    return;
  }

  // taskCreated
  const alreadySynced = await isClickupTaskAlreadySynced(taskId);
  if (alreadySynced) {
    console.log(`⛔ ClickUp task ${taskId} is already synced. Skipping.`);
    return;
  }

  const task = await getClickUpTaskDetails(taskId);
  if (!task) return;

  const listName = task.list?.name || '';
  if (!listName.includes('Support Ticket Form')) {
    console.log(`⏭️ Ignored task: not in a valid list (${listName})`);
    return;
  }

  const space = await getClickUpSpaceDetails(task.space?.id);
  console.log(space);
  const spaceName = space?.name;
  const companyId = await findCompanyIdByName(spaceName);
  const finalCompanyId = companyId || '35461787401';

  const dueDateISO = task.due_date
    ? new Date(Number(task.due_date)).toISOString()
    : getOneWeekFromNowISO();

  const priorityValue = task.priority?.priority || null;
  const hubspotPriority = priorityValue
    ? PRIORITY_MAP.task[priorityValue.toLowerCase()]
    : undefined;

  const assignee = task.assignees?.[0];
  let hubspotOwnerId = null;

  if (assignee?.email) {
    hubspotOwnerId = await findHubspotOwnerIdByEmail(assignee.email);
  }

  const hubspotTask = await createHubspotTask({
    name: task.name,
    description: task.description || '',
    dueDate: dueDateISO,
    ownerId: hubspotOwnerId,
    companyId: finalCompanyId,
    priority: hubspotPriority
  });

  if (hubspotTask?.id) {
    await saveSyncedItem({
      hubspotObjectId: hubspotTask.id,
      hubspotObjectType: 'task',
      clickupTaskId: taskId
    });
  }
}

module.exports = handleClickupTasks;
