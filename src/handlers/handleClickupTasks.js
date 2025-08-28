const {
  updateHubspotTaskField,
  updateHubspotTicketField,
  findHubspotOwnerIdByEmail
} = require('../services/hubspot');
const {
  findSyncedItemByClickupTaskId
} = require('../db/syncedItems');
const cheerio = require("cheerio");
const {
  isLikelyDelta
} = require('../utils/fathomUtils');

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
    return '1'; // New
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
    //content: 'content',
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
    const syncedRecord = await findSyncedItemByClickupTaskId(taskId);

    if (!syncedRecord) {
      console.log(`⛔ Task ${taskId} not synced with HubSpot. Skipping update.`);
      return;
    }

    const history = event.history_items || [];
    const hubspotType = syncedRecord.hubspot_object_type;
    const hubspotId = syncedRecord.hubspot_object_id;
    const mapping = FIELD_MAPPING[hubspotType];

    for (const item of history) {
      const field = item.field || 'unknown';

      // Manejo especial para reassignment de owner
      if (field === 'assignee_add' && item.after?.email) {
        const email = item.after.email;
        const hubspotOwnerId = await findHubspotOwnerIdByEmail(email);

        if (!hubspotOwnerId) {
          console.warn(`⚠️ Could not find HubSpot owner for email: ${email}`);
          continue;
        }

        console.log(`🔄 Reassigning HubSpot ${hubspotType} (${hubspotId}) to user ${email} → ownerId ${hubspotOwnerId} (from ClickUp task ${taskId})`);

        if (hubspotType === 'task') {
          await updateHubspotTaskField(hubspotId, 'hubspot_owner_id', hubspotOwnerId);
        } else {
          await updateHubspotTicketField(hubspotId, 'hubspot_owner_id', hubspotOwnerId);
        }

        console.log(`✅ Reassigned owner for ${hubspotType} (${taskId})`);
        continue;
      }

      const hubspotProperty = mapping?.[field];
      if (!hubspotProperty) continue;

      let finalValue = null;

      if (field === 'status') {
        const statusStr = (item.after?.status || '').toString().toLowerCase();
        finalValue = STATUS_MAP[hubspotType]?.(statusStr);
      } else if (field === 'priority') {
        const afterPriority = item.after?.priority?.toLowerCase();
        finalValue = PRIORITY_MAP[hubspotType]?.[afterPriority] || null;
      } else if (field === 'content') {
        let rawContent = item.after;
        const isDelta = isLikelyDelta(rawContent);
        let fathomLink = null;

        if (isDelta) {
          const fathomOp = rawContent.ops.find(op => op.attributes?.link?.includes('fathom.video'));
          fathomLink = fathomOp?.attributes?.link;

          if (fathomLink) {
            finalValue = `WATCH FATHOM CLIP: ${fathomLink}`;
            console.log(`📢 Detected Fathom link in Delta: ${finalValue}`);
          } else {
            finalValue = rawContent.ops.map(op => typeof op.insert === 'string' ? op.insert : '').join('').trim();
            console.log(`📢 Non-Fathom Delta content (plain text): ${finalValue}`);
          }

        } else {
          const html = typeof rawContent === 'string' ? rawContent : rawContent?.value || '';

          try {
            const parsed = JSON.parse(html);
            if (parsed?.ops?.length) {
              const fathomOp = parsed.ops.find(op => op.attributes?.link?.includes('fathom.video'));
              fathomLink = fathomOp?.attributes?.link;
            }
          } catch (err) {
            const $ = cheerio.load(html);
            fathomLink = $('a[href*="fathom.video/share"]').attr('href');
          }

          if (html.includes('WATCH FATHOM CLIP') && fathomLink) {
            finalValue = `WATCH FATHOM CLIP: ${fathomLink}`;
            console.log(`✅ Fathom link extracted from HTML or parsed Delta: ${fathomLink}`);
          } else {
            const $ = cheerio.load(html);
            finalValue = $.text().trim();
            console.log(`📢 HTML converted to plain text: ${finalValue}`);
          }
        }

        if (typeof finalValue !== 'string') {
          console.warn(`⚠️ Unexpected content format. Fallback to empty string.`);
          finalValue = '';
        }

        console.log('✅ Final value for content:', finalValue);
      } else {
        try {
          finalValue = typeof item.after === 'string' ? JSON.parse(item.after) : item.after;
        } catch {
          finalValue = item.after;
        }

        if (typeof finalValue === 'object' && !Array.isArray(finalValue) && finalValue !== null) {
          finalValue = finalValue.value || finalValue;
        }
      }

      const isValidType = typeof finalValue === 'string' || typeof finalValue === 'number' || isLikelyDelta(finalValue);
      if (!isValidType) {
        console.warn(`⚠️ Skipping ${hubspotProperty}: invalid value`, finalValue);
        continue;
      }

      console.log(`🔄 Updating HubSpot ${hubspotType} (${hubspotId}) field "${hubspotProperty}" with value:`, finalValue, `(from ClickUp task ${taskId})`);

      if (hubspotType === 'task') {
        await updateHubspotTaskField(hubspotId, hubspotProperty, finalValue);
      } else {
        await updateHubspotTicketField(hubspotId, hubspotProperty, finalValue);
      }

      console.log(`✅ Synced ${hubspotProperty} for ${hubspotType} (${taskId})`);
    }
  }
}

module.exports = handleClickupTasks;
