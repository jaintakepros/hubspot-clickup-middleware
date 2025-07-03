const axios = require('axios');
const { getPropertyHistory, getTaskPropertyHistory, getHubspotUserById } = require('./hubspot');

const {
  isLikelyDelta,
  deltaToFathomHTML
} = require('../utils/fathomUtils');

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function mapPriority(priority) {
  if (!priority) return null;

  const map = {
    'LOW': 4,
    'MEDIUM': 3,
    'HIGH': 2,
    'URGENT': 1
  };

  return map[priority.toUpperCase()] || null;
}

function mapStatus({ properties }) {
  if (properties?.hs_task_status) {
    const status = properties.hs_task_status.toUpperCase();
    switch (status) {
      case 'COMPLETED': return 'complete';
      default: return 'not started';
    }
  }

  if (properties?.hs_pipeline_stage) {
    switch (properties.hs_pipeline_stage) {
      case '1': return 'not started';
      case '4': return 'complete';
    }
  }

  return undefined;
}

async function findClickUpSpaceByCompanyName(companyName) {
  console.log(`COMPANY TO SEARCH: ${companyName}`)
  const url = 'https://api.clickup.com/api/v2/team';

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: process.env.CLICKUP_API_KEY,
      },
    });

    const teams = response.data.teams || [];

    for (const team of teams) {
      const spacesRes = await axios.get(`https://api.clickup.com/api/v2/team/${team.id}/space`, {
        headers: {
          Authorization: process.env.CLICKUP_API_KEY,
        },
      });

      const matchingSpace = spacesRes.data.spaces.find(space =>
        space.name.toLowerCase().includes(companyName.toLowerCase())
      );

      if (matchingSpace) return matchingSpace;
    }

    return null;
  } catch (error) {
    console.error('Error finding ClickUp space:', error.response?.data || error.message);
    return null;
  }
}

async function findSupportTicketListInSpace(spaceId) {
  try {
    const headers = {
      Authorization: process.env.CLICKUP_API_KEY,
    };

    const foldersRes = await axios.get(`https://api.clickup.com/api/v2/space/${spaceId}/folder`, {
      headers,
    });

    const folders = foldersRes.data.folders || [];

    for (const folder of folders) {
      const listRes = await axios.get(`https://api.clickup.com/api/v2/folder/${folder.id}/list`, {
        headers,
      });

      const matchingList = listRes.data.lists.find(list =>
        list.name.toLowerCase().includes('support ticket form')
      );

      if (matchingList) return matchingList;
    }

    const noFolderRes = await axios.get(`https://api.clickup.com/api/v2/space/${spaceId}/list`, {
      headers,
    });

    const noFolderLists = noFolderRes.data.lists || [];

    const matchingNoFolderList = noFolderLists.find(list =>
      list.name.toLowerCase().includes('support ticket form')
    );

    return matchingNoFolderList || null;
  } catch (error) {
    console.error('Error finding list in ClickUp space:', error.response?.data || error.message);
    return null;
  }
}

async function findClickUpUserByEmail(email) {
  const workspaceId = '9006107495';

  try {
    const response = await axios.get(`https://api.clickup.com/api/v2/team/${workspaceId}`, {
      headers: {
        Authorization: process.env.CLICKUP_API_KEY,
      },
    });

    const members = response.data.team.members || [];

    const matchingMember = members.find(member =>
      member.user?.email?.toLowerCase() === email.toLowerCase()
    );

    return matchingMember?.user?.id || null;
  } catch (error) {
    console.error('Error fetching ClickUp users by workspace ID:', error.response?.data || error.message);
    return null;
  }
}

async function createClickUpTask({ listId, ticket, company }) {
  const url = `https://api.clickup.com/api/v2/list/${listId}/task`;

  let assignees = [];

  try {
    const hubspotUser = await getHubspotUserById(ticket.properties.hubspot_owner_id);
    if (hubspotUser?.email) {
      const clickupUserId = await findClickUpUserByEmail(hubspotUser.email);
      if (clickupUserId) {
        assignees = [clickupUserId];
      } else {
        console.warn(`No ClickUp user found for email ${hubspotUser.email}`);
      }
    } else {
      console.warn(`No email found for HubSpot user ${ticket.properties.hubspot_owner_id}`);
    }
  } catch (error) {
    console.error('Error resolving assignee:', error);
  }

  const dueDate = ticket.properties?.closed_date
    ? new Date(ticket.properties.closed_date).getTime()
    : undefined;

  const taskData = {
    name: ticket.properties.subject || 'No Subject',
    description: ticket.properties.content || 'No content provided.',
    due_date: dueDate,
    assignees,
    priority: mapPriority(ticket.properties.hs_ticket_priority),
    ...(mapStatus(ticket) && { status: mapStatus(ticket) }), // 👈 solo si hay valor
  };

  try {
    const response = await axios.post(url, taskData, {
      headers: {
        Authorization: process.env.CLICKUP_API_KEY,
        'Content-Type': 'application/json',
      },
    });

    const createdTaskId = response.data.id;
    console.log(`Created ClickUp task with ID: ${createdTaskId}`);

    return createdTaskId || null;
  } catch (error) {
    console.error('Error creating task in ClickUp:', error.response?.data || error.message);
    return null;
  }
}

async function updateClickUpTask({ ticketId, taskId, modifiedProps = null }) {
  const url = `https://api.clickup.com/api/v2/task/${taskId}`;
  const headers = {
    Authorization: process.env.CLICKUP_API_KEY,
    'Content-Type': 'application/json',
  };

  const payload = {};

  if (modifiedProps) {
    // Se está actualizando desde una TASK de HubSpot (vía webhook object.propertyChange)
    for (const [property, value] of Object.entries(modifiedProps)) {
      switch (property) {
        case 'hs_task_subject':
          payload.name = value;
          break;

        case 'hs_task_body':
          payload.description = latestValue;
          break;

        /*  
        case 'hs_timestamp':
          if (value) {
            const dueTimestamp = new Date(value).getTime();
            payload.due_date = dueTimestamp;
          }
          break;
        */

        case 'hubspot_owner_id': {
          try {
            const hubspotUser = await getHubspotUserById(value);
            if (!hubspotUser?.email) break;

            const clickupUserId = await findClickUpUserByEmail(hubspotUser.email);
            if (!clickupUserId) break;

            const currentRes = await axios.get(url, { headers });
            const currentIds = currentRes.data.assignees.map(a => a.id);
            //const idsToRemove = currentIds.filter(id => id !== clickupUserId);

            payload.assignees = {
              add: [clickupUserId],
              //rem: idsToRemove,
            };
          } catch (err) {
            console.error(`❌ Error syncing assignee:`, err.response?.data || err.message);
          }
          break;
        }

        case 'hs_task_priority':
          payload.priority = mapPriority(value);
          break;

        case 'hs_task_status': {
          const mapped = mapStatus({ properties: { hs_task_status: value } });
          if (mapped !== undefined) {
            payload.status = mapped;
          }
          break;
        }
      }
    }
  } else {
    // Se está actualizando desde un TICKET (se usa historial)
    const PROPERTIES = [
      'subject',
      'content',
      'closed_date',
      'hubspot_owner_id',
      'hs_ticket_priority',
      'hs_pipeline_stage'
    ];
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    for (const property of PROPERTIES) {
      const history = await getPropertyHistory(ticketId, property);
      if (!Array.isArray(history) || history.length === 0) continue;

      const changedRecently = history.some(entry => entry.timestamp > fiveMinutesAgo);
      if (!changedRecently) continue;

      const latestValue = history
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0]?.value;
      if (latestValue === undefined) continue;

      switch (property) {
        case 'subject':
          payload.name = latestValue;
          break;

        case 'content':
          payload.description = latestValue;
          break;

        case 'hs_pipeline_stage': {
          const mapped = mapStatus({ properties: { hs_pipeline_stage: latestValue } });
          if (mapped !== undefined) {
            payload.status = mapped;
          }
          break;
        }

        case 'closed_date': {
          const timestamp = latestValue ? new Date(latestValue).getTime() : null;
          if (timestamp) {
            payload.due_date = timestamp;
          }
          break;
        }

        case 'hubspot_owner_id': {
          try {
            const hubspotUser = await getHubspotUserById(latestValue);
            if (!hubspotUser?.email) break;

            const clickupUserId = await findClickUpUserByEmail(hubspotUser.email);
            if (!clickupUserId) break;

            const currentRes = await axios.get(url, { headers });
            const currentIds = currentRes.data.assignees.map(a => a.id);
            //const idsToRemove = currentIds.filter(id => id !== clickupUserId);

            payload.assignees = {
              add: [clickupUserId],
              //rem: idsToRemove,
            };
          } catch (err) {
            console.error(`❌ Error syncing assignee:`, err.response?.data || err.message);
          }
          break;
        }

        case 'hs_ticket_priority':
          payload.priority = mapPriority(latestValue);
          break;
      }
    }
  }

  if (Object.keys(payload).length === 0) {
    console.log(`⚠️ No recent property changes detected for ${ticketId || taskId}`);
    return;
  }

  console.log(`🛠 Updating task ${taskId} with payload:`, JSON.stringify(payload, null, 2));

  try {
    const res = await axios.put(url, payload, { headers });
    console.log(`✅ Task ${taskId} updated successfully`);
    return res.data;
  } catch (err) {
    console.error(`❌ Failed to update task ${taskId}:`, err.response?.data || err.message);
    return null;
  }
}


async function updateClickUpTaskFromHubspotTask({ hubspotTaskId, clickupTaskId }) {
  const url = `https://api.clickup.com/api/v2/task/${clickupTaskId}`;
  const headers = {
    Authorization: process.env.CLICKUP_API_KEY,
    'Content-Type': 'application/json',
  };

  const PROPERTIES = [
    'hs_task_subject',
    'hs_task_body',
    'hs_timestamp',
    'hubspot_owner_id',
    'hs_task_priority',
    'hs_task_status',
  ];

  const payload = {};
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  for (const property of PROPERTIES) {
    const history = await getTaskPropertyHistory(hubspotTaskId, property);
    if (!Array.isArray(history) || history.length === 0) continue;

    const changedRecently = history.some(entry => new Date(entry.timestamp).getTime() > fiveMinutesAgo);
    if (!changedRecently) continue;

    const latestValue = history
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp))[0]?.value;
    if (latestValue === undefined) continue;

    switch (property) {
      case 'hs_task_subject':
        payload.name = latestValue;
        break;

      case 'hs_task_body':
        if (isLikelyDelta(latestValue)) {
          payload.description = deltaToFathomHTML(latestValue); // Si es Delta, lo convertimos en HTML
        } else {
          payload.description = latestValue; // Texto plano, lo dejamos tal cual
        }
        break;


      /*
      case 'hs_timestamp': {
        const timestamp = latestValue ? new Date(latestValue).getTime() : null;
        if (timestamp) payload.due_date = timestamp;
        break;
      }
      */

      case 'hubspot_owner_id': {
        try {
          const hubspotUser = await getHubspotUserById(latestValue);
          if (!hubspotUser?.email) break;

          const clickupUserId = await findClickUpUserByEmail(hubspotUser.email);
          if (!clickupUserId) break;

          const currentRes = await axios.get(url, { headers });
          const currentIds = currentRes.data.assignees.map(a => a.id);
          //const idsToRemove = currentIds.filter(id => id !== clickupUserId);

          payload.assignees = {
            add: [clickupUserId],
            //rem: idsToRemove,
          };
        } catch (err) {
          console.error(`❌ Error syncing assignee:`, err.response?.data || err.message);
        }
        break;
      }

      case 'hs_task_priority':
        payload.priority = mapPriority(latestValue);
        break;

      case 'hs_task_status':
        payload.status = latestValue === 'COMPLETED' ? 'complete' : 'not started';
        break;
    }
  }

  if (Object.keys(payload).length === 0) {
    console.log(`⚠️ No recent property changes detected for task ${hubspotTaskId}`);
    return;
  }

  console.log(`🛠 Updating ClickUp task ${clickupTaskId} with:`, payload);

  try {
    const res = await axios.put(url, payload, { headers });
    console.log(`✅ ClickUp task ${clickupTaskId} updated successfully`);
    return res.data;
  } catch (err) {
    console.error(`❌ Failed to update ClickUp task ${clickupTaskId}:`, err.response?.data || err.message);
    return null;
  }
}



async function getClickUpTaskDetails(taskId) {
  try {
    const response = await axios.get(`https://api.clickup.com/api/v2/task/${taskId}`, {
      headers: {
        Authorization: process.env.CLICKUP_API_KEY
      }
    });

    return response.data;
  } catch (error) {
    console.error(`❌ Error al obtener detalles de la tarea ${taskId}:`, error.response?.data || error.message);
    return null;
  }
}

async function getClickUpSpaceDetails(spaceId) {
  try {
    const response = await axios.get(`https://api.clickup.com/api/v2/space/${spaceId}`, {
      headers: {
        Authorization: process.env.CLICKUP_API_KEY
      }
    });

    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching ClickUp space ${spaceId}:`, error.response?.data || error.message);
    return null;
  }
}


module.exports = {
  findClickUpSpaceByCompanyName,
  findSupportTicketListInSpace,
  findClickUpUserByEmail,
  createClickUpTask,
  updateClickUpTask,
  getClickUpTaskDetails,
  getClickUpSpaceDetails,
  updateClickUpTaskFromHubspotTask
};
