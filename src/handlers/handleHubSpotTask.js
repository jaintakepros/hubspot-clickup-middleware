const {
  getCompanyById,
  getHubSpotTaskDetails,
  getHubspotUserById
} = require('../services/hubspot');
const {
  findClickUpSpaceByCompanyName,
  findSupportTicketListInSpace,
  findClickUpUserByEmail
} = require('../services/clickup');
const {
  saveSyncedItem,
  findSyncedItem
} = require('../db/syncedItems');
const {
  updateClickUpTaskFromHubspotTask
} = require('../services/clickup');
const {
  buildFathomDelta
} = require('../utils/fathomUtils');
const cheerio = require('cheerio');
const axios = require('axios');

const processingEvents = new Set();
const pendingSyncs = new Set();

// Utilidad para convertir HTML plano a Quill Delta
function htmlToQuillDelta(html) {
  const $ = cheerio.load(html);
  const ops = [];

  function walk(node) {
    if (node.type === 'text') {
      ops.push({ insert: node.data });
    } else if (node.name === 'a') {
      const text = $(node).text();
      const href = $(node).attr('href');
      ops.push({
        insert: text,
        attributes: { link: href }
      });
    } else if (node.children) {
      node.children.forEach(walk);
    }
  }

  $('body').contents().each((_, el) => walk(el));
  ops.push({ insert: '\n' });
  return { ops };
}

async function handleHubSpotTask(event) {
  const taskId = event.objectId;
  const eventType = event.subscriptionType;

  console.log(`🧠 Event received: ${eventType}`);
  console.log(`🔎 Task ID: ${taskId}`);

  if (!taskId || processingEvents.has(taskId)) {
    console.log(`🚫 Skipping duplicate or invalid event for task ${taskId}`);
    return;
  }

  processingEvents.add(taskId);

  try {
    if (eventType === 'object.creation') {
      const alreadySynced = await findSyncedItem({
        hubspotObjectId: taskId,
        hubspotObjectType: 'task',
      });

      if (alreadySynced) {
        console.log(`🔁 Task ${taskId} already synced. Skipping creation.`);
        return;
      }

      const task = await getHubSpotTaskDetails(taskId);
      if (!task) {
        console.warn(`⚠️ Could not fetch task with ID ${taskId}`);
        return;
      }

      const companyId = task?.associations?.companies?.results?.[0]?.id || '35461787401';
      const company = await getCompanyById(companyId);
      const companyName = company?.properties?.name || 'Generic Company';
      const space = await findClickUpSpaceByCompanyName(companyName);
      const listId = space
        ? (await findSupportTicketListInSpace(space.id))?.id
        : '901704948470';

      if (!listId) {
        console.error('❌ No list found to create the ClickUp task.');
        return;
      }
      const hsBody = task.properties.hs_task_body;
      let assignees = [];
      try {
        const hubspotUser = await getHubspotUserById(task.properties.hubspot_owner_id);
        if (hubspotUser?.email) {
          const clickupUserId = await findClickUpUserByEmail(hubspotUser.email);
          if (clickupUserId) assignees = [clickupUserId];
          if(hubspotUser.email === "lisa@legalintakepros.com" && hsBody.includes('WATCH FATHOM CLIP')){
            const virginiaClickupId = await findClickUpUserByEmail("virginia@legalintakepros.com");
            assignees.push(virginiaClickupId);
          }else if((hubspotUser.email === "desiree@legalintakepros.com" || hubspotUser.email === "anais@legalintakepros.com") && hsBody.includes('WATCH FATHOM CLIP')){
            const danielaCastrejonClickupId = await findClickUpUserByEmail("daniela@legalintakepros.com");
            assignees.push(danielaCastrejonClickupId)
          }
        }
      } catch (e) {}

      const dueDate = task.properties?.hs_timestamp
        ? new Date(task.properties.hs_timestamp).getTime()
        : undefined;

      let description = 'No description';
      
      const tags = [];
      let fathomUrl = null;
      console.log('📦 hs_task_body (raw):', hsBody);

      if (hsBody && typeof hsBody === 'string') {
        if (hsBody.includes('WATCH FATHOM CLIP')) {
          console.log('🔎 Detected WATCH FATHOM CLIP in hs_task_body');

          const match = hsBody.match(/https:\/\/fathom\.video\/share\/[^\s"<]+/);
          if (match) {
            console.log('✅ Fathom URL matched:', match[0]);
            description = {
              ops: [
                { insert: `WATCH FATHOM CLIP: ${match[0]}\n` }
              ]
            };
            tags.push('Fathom');
            fathomUrl = match[0];
          } else {
            console.warn('⚠️ WATCH FATHOM CLIP found but no URL matched');
          }

        } else {
          description = htmlToQuillDelta(hsBody);
        }
      }

      const taskData = {
        name: task.properties.hs_task_subject || 'No Subject',
        description,
        due_date: dueDate,
        start_date: Date.now(),
        assignees,
        priority: task.properties.hs_task_priority === 'HIGH' ? 2 :
                  task.properties.hs_task_priority === 'LOW' ? 4 : 3,
        status: task.properties.hs_task_status === 'COMPLETED' ? 'complete' : 'not started',
        tags,
      };

      const response = await axios.post(`https://api.clickup.com/api/v2/list/${listId}/task`, taskData, {
        headers: {
          Authorization: process.env.CLICKUP_API_KEY,
          'Content-Type': 'application/json',
        },
      });

      console.log(`✅ Created ClickUp task ${response.data.id}`);

      await saveSyncedItem({
        hubspotObjectId: taskId,
        hubspotObjectType: 'task',
        clickupTaskId: response.data.id,
      });

      console.log(`💾 Sync saved for HubSpot task ${taskId}`);

      // 🔗 Actualizar custom field HubSpot URL
      const clickupHubSpotRecordId = '939589ca-d9c5-483e-baab-a2b30d008672';
      const hubspotRecordUrl = `https://app.hubspot.com/contacts/46493300/company/${companyId}/?engagement=${taskId}`;

      try {
        await axios.post(
          `https://api.clickup.com/api/v2/task/${response.data.id}/field/${clickupHubSpotRecordId}`,
          { value: hubspotRecordUrl },
          {
            headers: {
              Authorization: process.env.CLICKUP_API_KEY,
              'Content-Type': 'application/json',
            }
          }
        );
        console.log(`🔗 Custom field actualizado: ${hubspotRecordUrl}`);
      } catch (error) {
        console.error(`❌ Error al actualizar custom field HubSpot Record URL:`, error.message);
      }

      // 🔗 Actualizar custom field fathomUrl si se detectó
      if (fathomUrl) {
        const fathomUrlFieldId = 'f9fe2f36-7969-4dfa-891b-78e55511563a';
        try {
          await axios.post(
            `https://api.clickup.com/api/v2/task/${response.data.id}/field/${fathomUrlFieldId}`,
            { value: getFathomBaseUrl(fathomUrl) },
            {
              headers: {
                Authorization: process.env.CLICKUP_API_KEY,
                'Content-Type': 'application/json',
              }
            }
          );
          console.log(`🔗 Custom field fathomUrl actualizado: ${fathomUrl}`);
        } catch (error) {
          console.error(`❌ Error al actualizar custom field fathomUrl:`, error.message);
        }
      }

    } else if (eventType === 'object.propertyChange') {
      const synced = await findSyncedItem({
        hubspotObjectId: taskId,
        hubspotObjectType: 'task',
      });

      if (!synced) {
        if (pendingSyncs.has(taskId)) {
          console.log(`⏳ Task ${taskId} is already pending creation. Skipping reprocessing.`);
          return;
        }

        pendingSyncs.add(taskId);
        console.log(`⏳ Task ${taskId} not yet synced. Waiting 30 seconds...`);

        setTimeout(async () => {
          try {
            const syncedLater = await findSyncedItem({
              hubspotObjectId: taskId,
              hubspotObjectType: 'task',
            });

            if (syncedLater) {
              console.log(`🔁 Task ${taskId} now synced after delay. Proceeding to update.`);
              await updateClickUpTaskFromHubspotTask({
                hubspotTaskId: taskId,
                clickupTaskId: syncedLater.clickup_task_id,
              });
            } else {
              console.log(`📌 Task ${taskId} still not synced. Proceeding to creation...`);
              await handleHubSpotTask({ ...event, subscriptionType: 'object.creation' });
            }
          } finally {
            pendingSyncs.delete(taskId);
            processingEvents.delete(taskId);
          }
        }, 30000);
        return;
      }

      await updateClickUpTaskFromHubspotTask({
        hubspotTaskId: taskId,
        clickupTaskId: synced.clickup_task_id,
      });
    } else {
      console.log(`ℹ️ Unhandled event type: ${eventType}`);
    }
  } catch (err) {
    console.error(`❌ Error processing task ${taskId}:`, err.message);
  } finally {
    processingEvents.delete(taskId);
  }
}

function getFathomBaseUrl(fullUrl) {
  if (typeof fullUrl !== 'string') return null;
  return fullUrl.split('?timestamp=')[0];
}

module.exports = {
  handleHubSpotTask,
};

