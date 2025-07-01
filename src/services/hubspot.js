const axios = require('axios');
const HUBSPOT_API_KEY = process.env.HUBSPOT_API_KEY;
const BASE_URL = 'https://api.hubapi.com';

async function getHubspotTicketDetails(ticketId) {
  const url = `https://api.hubapi.com/crm/v3/objects/tickets/${ticketId}?properties=subject,content,closed_date,hubspot_owner_id,hs_ticket_priority,hs_pipeline_stage&associations=company`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch ticket ${ticketId} from HubSpot:`, error.response?.data || error.message);
    return null;
  }
}

async function getCompanyById(companyId) {
  const url = `https://api.hubapi.com/crm/v3/objects/companies/${companyId}?properties=name,domain`;

  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    return response.data;
  } catch (error) {
    console.error(`Failed to fetch company ${companyId} from HubSpot:`, error.response?.data || error.message);
    return null;
  }
}

async function getHubspotUserById(userId) {
  try {
    const url = 'https://api.hubapi.com/crm/v3/owners';
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const user = response.data.results.find(u => u.id === userId.toString());

    if (!user) {
      console.warn(`HubSpot user with ID ${userId} not found.`);
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  } catch (error) {
    console.error(`Error getting HubSpot user ${userId}:`, error.response?.data || error.message);
    return null;
  }
}

async function getPropertyHistory(ticketId, property) {
  const url = `https://api.hubapi.com/crm/v3/objects/tickets/${ticketId}?propertiesWithHistory=${property}&archived=false`;

  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    // El historial está dentro de `propertiesWithHistory[property]`
    return res.data?.propertiesWithHistory?.[property] || [];
  } catch (err) {
    console.error(`❌ Error getting history for property "${property}" of object ${ticketId}:`, err.response?.data || err.message);
    return [];
  }
}

async function getTaskPropertyHistory(taskId, property) {
  const url = `https://api.hubapi.com/crm/v3/objects/tasks/${taskId}?propertiesWithHistory=${property}&archived=false`;

  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    return res.data?.propertiesWithHistory?.[property] || [];
  } catch (err) {
    console.error(`❌ Error getting history for property "${property}" of task ${taskId}:`, err.response?.data || err.message);
    return [];
  }
}


async function findCompanyIdByName(name) {
  try {
    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/companies/search',
      {
        filterGroups: [
          {
            filters: [
              {
                propertyName: 'name',
                operator: 'CONTAINS_TOKEN',
                value: name
              }
            ]
          }
        ],
        properties: ['name'],
        limit: 1
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const results = response.data.results;
    return results.length > 0 ? results[0].id : null;
  } catch (error) {
    console.error(`❌ Error searching HubSpot company by name "${name}":`, error.response?.data || error.message);
    return null;
  }
}

async function createHubspotTask({ name, description, dueDate, ownerId, companyId, priority }) {
  try {
    const properties = {
      hs_task_subject: name,
      hs_task_body: description || '',
      hs_timestamp: dueDate,
    };

    if (ownerId) properties.hubspot_owner_id = ownerId;
    if (priority) properties.hs_task_priority = priority;

    const response = await axios.post(
      'https://api.hubapi.com/crm/v3/objects/tasks',
      {
        properties,
        associations: [
          {
            to: { id: companyId },
            types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 192 }]
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ HubSpot task created (ID: ${response.data.id})`);
    return response.data;
  } catch (error) {
    console.error('❌ Error creating task in HubSpot:', error.response?.data || error.message);
    return null;
  }
}

async function findHubspotOwnerIdByEmail(email) {
  try {
    const response = await axios.get('https://api.hubapi.com/crm/v3/owners', {
      headers: {
        Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const match = response.data.results.find(owner =>
      owner.email?.toLowerCase() === email.toLowerCase()
    );

    if (match) {
      return match.id;
    } else {
      console.warn(`⚠️ No HubSpot owner found for email: ${email}`);
      return null;
    }
  } catch (error) {
    console.error('❌ Error finding HubSpot owner by email:', error.response?.data || error.message);
    return null;
  }
}

async function updateHubspotTaskField(taskId, propertyName, newValue) {
  try {
    const url = `https://api.hubapi.com/crm/v3/objects/tasks/${taskId}`;
    const response = await axios.patch(
      url,
      {
        properties: {
          [propertyName]: newValue,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`✅ HubSpot task ${taskId} updated: ${propertyName} = ${newValue}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to update HubSpot task ${taskId}:`, error.response?.data || error.message);
    return null;
  }
}

async function updateHubspotTicketField(ticketId, propertyName, newValue) {
  try {
    const url = `https://api.hubapi.com/crm/v3/objects/tickets/${ticketId}`;
    const response = await axios.patch(
      url,
      {
        properties: {
          [propertyName]: newValue,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`✅ HubSpot ticket ${ticketId} updated: ${propertyName} = ${newValue}`);
    return response.data;
  } catch (error) {
    console.error(`❌ Failed to update HubSpot ticket ${ticketId}:`, error.response?.data || error.message);
    return null;
  }
}

async function getTasksModifiedSince(sinceDateISO) {
  const url = `${BASE_URL}/crm/v3/objects/tasks/search`;

  const payload = {
    filterGroups: [
      {
        filters: [
          {
            propertyName: 'hs_lastmodifieddate',
            operator: 'GTE',
            value: sinceDateISO
          },
          {
            propertyName: 'hs_task_status',
            operator: 'NEQ',
            value: 'COMPLETED'
          }
        ]
      }
    ],
    properties: ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_priority', 'hs_task_status', 'hubspot_owner_id', 'hs_lastmodifieddate'],
    limit: 100
  };

  const headers = {
    Authorization: `Bearer ${HUBSPOT_API_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    const response = await axios.post(url, payload, { headers });

    // 🔍 Ver el body completo
    console.dir(response.data, { depth: null, colors: true });

    return response.data.results;
  } catch (error) {
    console.error('❌ Error fetching tasks from HubSpot:', error.response?.data || error.message);
    return [];
  }
}


async function getRecentHubspotTasks() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const tasks = await getTasksModifiedSince(fiveMinutesAgo);

  // Enriquecer con asociaciones si es necesario (opcional)
  for (const task of tasks) {
    const companyIds = task.associations?.companies?.results?.map(c => c.id) || [];
    if (companyIds.length > 0) {
      const companyId = companyIds[0];
      const company = await getCompanyById(companyId);
      if (company) {
        task.associations.companies.results[0].name = company.properties?.name || '';
      }
    }
  }

  return tasks;
}
const HUBSPOT_API_BASE_URL = 'https://api.hubapi.com';

const hubspotClient = axios.create({
  baseURL: HUBSPOT_API_BASE_URL,
  headers: {
    Authorization: `Bearer ${process.env.HUBSPOT_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function getHubSpotTaskDetails(taskId) {
  try {
    const properties = [
      'hs_task_subject',
      'hs_task_body',
      'hs_timestamp',
      'hubspot_owner_id',
      'hs_task_priority',
      'hs_task_status'
    ];

    const response = await hubspotClient.get(`/crm/v3/objects/tasks/${taskId}`, {
      params: {
        properties: properties.join(','),
        associations: 'companies'
      }
    });

    return response.data;
  } catch (error) {
    console.error(`❌ Error fetching HubSpot task with ID ${taskId}:`, error.response?.data || error.message);
    return null;
  }
}

async function getRecentlyModifiedProperties(taskId, minutesAgo = 5) {
  const since = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();

  try {
    const response = await hubspotClient.get(`/crm/v3/objects/tasks/${taskId}/history`);

    const recentChanges = {};

    const events = response.data?.results || [];

    for (const event of events) {
      const propertyName = event.propertyName;
      const versions = event.versions || [];

      for (const version of versions) {
        if (new Date(version.timestamp) >= new Date(since)) {
          recentChanges[propertyName] = version.newValue;
          break;
        }
      }
    }

    console.log(`🕵️ Changes in last ${minutesAgo} min for task ${taskId}:`, recentChanges);
    return recentChanges;
  } catch (error) {
    console.error(`❌ Error fetching property history for task ${taskId}:`, error.response?.data || error.message);
    return {};
  }
}



module.exports = {
  getHubspotTicketDetails,
  getCompanyById,
  getHubspotUserById,
  getPropertyHistory,
  findCompanyIdByName,
  createHubspotTask,
  findHubspotOwnerIdByEmail,
  updateHubspotTaskField,
  updateHubspotTicketField,
  getTasksModifiedSince,
  getRecentHubspotTasks,
  getHubSpotTaskDetails,
  getRecentlyModifiedProperties,
  getTaskPropertyHistory
};
