const { getHubspotTicketDetails, getCompanyById } = require('../services/hubspot');
const {
  findClickUpSpaceByCompanyName,
  findSupportTicketListInSpace,
  updateClickUpTask,
  createClickUpTask
} = require('../services/clickup');
const {
  saveSyncedItem,
  findSyncedItem
} = require('../db/syncedItems');
const axios = require('axios');

const processingEvents = new Set();
const pendingSyncs = new Set(); // ✅ Previene loops de creación

async function handleHubSpotTicket(payload) {
  const ticketId = extractTicketIdFromPayload(payload);
  const eventType = payload?.subscriptionType || 'unknown';
  const property = payload?.propertyName || null;
  const newValue = payload?.propertyValue || null;

  console.log(`🧠 Event received: ${eventType}${property ? ` (property: ${property}, new value: ${newValue})` : ''}`);
  console.log('Extracted ticketId:', ticketId);

  if (!ticketId) {
    console.warn('No ticketId found in the webhook payload:', JSON.stringify(payload, null, 2));
    return;
  }

  if (processingEvents.has(ticketId)) {
    console.log(`🚫 Event already being processed: ${ticketId}`);
    return;
  }

  processingEvents.add(ticketId);

  try {
    const ticket = await getHubspotTicketDetails(ticketId);
    if (!ticket) {
      console.warn(`Could not retrieve ticket with ID ${ticketId}`);
      return;
    }

    const associations = ticket?.associations?.companies?.results;
    const companyId = associations?.[0]?.id;

    let company = null;
    let space = null;
    let list = null;

    if (companyId) {
      company = await getCompanyById(companyId);
      if (company) {
        try {
          space = await findClickUpSpaceByCompanyName(company.properties.name);
          if (space) {
            list = await findSupportTicketListInSpace(space.id);
          }
        } catch (error) {
          console.error('Error while searching for space/list in ClickUp:', error);
        }
      }
    }

    if (!list) {
      const fallbackListId = '901704948470';
      list = { id: fallbackListId, name: '📋 Support Ticket Form (Fallback)' };
      console.log(`Using fallback list with ID ${fallbackListId}`);
    }

    const existing = await findSyncedItem({ hubspotObjectId: ticketId, hubspotObjectType: 'ticket' });
    console.log('🔍 Synced item found:', existing);

    if (eventType === 'ticket.creation' || (eventType === 'ticket.propertyChange' && !existing)) {
      if (eventType === 'ticket.propertyChange') {
        if (pendingSyncs.has(ticketId)) {
          console.log(`⏳ Ticket ${ticketId} is already pending creation. Skipping.`);
          return;
        }

        pendingSyncs.add(ticketId);
        console.log(`⏳ Waiting 30 seconds before re-checking sync for ticket ${ticketId}...`);

        setTimeout(async () => {
          try {
            const recheck = await findSyncedItem({ hubspotObjectId: ticketId, hubspotObjectType: 'ticket' });
            if (recheck) {
              console.log(`🔄 Ticket ${ticketId} was synced during the wait. Skipping creation.`);
            } else {
              console.log(`📌 Ticket ${ticketId} still not synced. Proceeding to creation...`);

              const clickupTaskId = await createClickUpTask({
                ticket,
                company,
                listId: list.id,
                space,
                tags: ['Ticket'] // ✅ Añadir etiqueta
              });

              if (clickupTaskId) {
                await saveSyncedItem({
                  hubspotObjectId: ticket.id,
                  hubspotObjectType: 'ticket',
                  clickupTaskId: clickupTaskId,
                });
                console.log(`✅ Sync record saved for ticket ${ticket.id}`);

                // ✅ Actualizar custom field con URL
                const customFieldId = '939589ca-d9c5-483e-baab-a2b30d008672';
                const hubspotRecordUrl = `https://app.hubspot.com/contacts/46493300/record/0-5/${ticketId}`;
                try {
                  await axios.put(
                    `https://api.clickup.com/api/v2/task/${clickupTaskId}/field/${customFieldId}`,
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
              } else {
                console.warn(`⚠️ ClickUp task not created successfully for ticket ${ticket.id}`);
              }
            }
          } catch (err) {
            console.error(`❌ Error during delayed creation for ticket ${ticketId}:`, err);
          } finally {
            pendingSyncs.delete(ticketId);
            processingEvents.delete(ticketId);
          }
        }, 30000);

        return;
      }

      const clickupTaskId = await createClickUpTask({
        ticket,
        company,
        listId: list.id,
        space,
        tags: ['Ticket'] // ✅ Añadir etiqueta
      });

      if (clickupTaskId) {
        await saveSyncedItem({
          hubspotObjectId: ticket.id,
          hubspotObjectType: 'ticket',
          clickupTaskId: clickupTaskId,
        });
        console.log(`✅ Sync record saved for ticket ${ticket.id}`);

        // ✅ Actualizar custom field con URL
        const customFieldId = '939589ca-d9c5-483e-baab-a2b30d008672';
        const hubspotRecordUrl = `https://app.hubspot.com/contacts/46493300/record/0-5/${ticketId}`;
        try {
          await axios.put(
            `https://api.clickup.com/api/v2/task/${clickupTaskId}/field/${customFieldId}`,
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
      } else {
        console.warn(`⚠️ ClickUp task was not created successfully for ticket ${ticket.id}`);
      }
    } else if (eventType === 'ticket.propertyChange' && existing) {
      const clickupTaskId = existing.clickup_task_id;
      console.log(`🔧 Updating existing ClickUp task ${clickupTaskId} for ticket ${ticketId}`);
      try {
        await updateClickUpTask({ ticketId, taskId: clickupTaskId });
        console.log(`✅ ClickUp task ${clickupTaskId} updated successfully.`);
      } catch (err) {
        console.error(`❌ Failed to update ClickUp task ${clickupTaskId}:`, err);
      }
    } else {
      console.log(`ℹ️ Ignored event type: ${eventType}`);
    }
  } catch (err) {
    console.error(`❌ Unhandled error for ticket ${ticketId}:`, err);
  } finally {
    processingEvents.delete(ticketId);
  }
}

function extractTicketIdFromPayload(event) {
  if (!event || !event.objectId) {
    console.warn('Invalid event payload:', event);
    return null;
  }

  return event.objectId;
}

module.exports = {
  handleHubSpotTicket,
};
