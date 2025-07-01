const { getCompanyById, getHubSpotTaskDetails, getHubspotUserById } = require('../services/hubspot');
const { findClickUpSpaceByCompanyName, findSupportTicketListInSpace, findClickUpUserByEmail } = require('../services/clickup');
const { saveSyncedItem, findSyncedItem } = require('../db/syncedItems');
const { updateClickUpTaskFromHubspotTask } = require('../services/clickup');
const axios = require('axios');

const processingEvents = new Set();
const pendingSyncs = new Set(); // ✅ evita múltiples propertyChange sobre el mismo ID

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

      // Compañía
      console.log(task.associations)
      console.log(task.associations.companies.results);
      const companyId = task.associations?.companies?.results?.[0]?.id || '35461787401';
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

      // Assignee
      let assignees = [];
      try {
        const hubspotUser = await getHubspotUserById(task.properties.hubspot_owner_id);
        if (hubspotUser?.email) {
          const clickupUserId = await findClickUpUserByEmail(hubspotUser.email);
          if (clickupUserId) assignees = [clickupUserId];
        }
      } catch (e) {}

      const dueDate = task.properties?.hs_timestamp
        ? new Date(task.properties.hs_timestamp).getTime()
        : undefined;
      const description = task.properties.hs_task_body?.replace(/<[^>]*>/g, '').trim();

      const taskData = {
        name: task.properties.hs_task_subject || 'No Subject',
        description: description || 'No description',
        due_date: dueDate,
        assignees,
        priority: task.properties.hs_task_priority === 'HIGH' ? 2 :
                  task.properties.hs_task_priority === 'LOW' ? 4 : 3,
        status: task.properties.hs_task_status === 'COMPLETED' ? 'complete' : 'not started',
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

      // Si ya está sincronizado, actualizar la task
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

module.exports = {
  handleHubSpotTask,
};

