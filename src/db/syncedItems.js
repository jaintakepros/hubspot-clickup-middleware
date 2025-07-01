const pool = require('./pool');

// ✅ Verifica si el ticket ya fue sincronizado
async function isTicketAlreadySynced(hubspotTicketId) {
  const query = `
    SELECT 1
    FROM synced_items
    WHERE hubspot_object_id = $1 AND hubspot_object_type = 'ticket'
    LIMIT 1
  `;
  const values = [hubspotTicketId];

  const result = await pool.query(query, values);
  return result.rowCount > 0;
}

// 🆕 Verifica si cualquier objeto de HubSpot ya fue sincronizado
async function isHubspotObjectAlreadySynced(hubspotObjectId) {
  const query = `
    SELECT 1
    FROM synced_items
    WHERE hubspot_object_id = $1
    LIMIT 1
  `;
  const result = await pool.query(query, [hubspotObjectId]);
  return result.rowCount > 0;
}

// 🆕 Obtiene un objeto sincronizado solo por su ID de HubSpot
async function findSyncedItemByHubspotObjectId(hubspotObjectId) {
  const query = `
    SELECT *
    FROM synced_items
    WHERE hubspot_object_id = $1
    LIMIT 1
  `;
  const result = await pool.query(query, [hubspotObjectId]);
  return result.rows[0] || null;
}

// 📝 Guarda la relación ticket-task sincronizada
async function saveSyncedItem({ hubspotObjectId, hubspotObjectType, clickupTaskId }) {
  const client = await pool.connect();
  try {
    const query = `
      INSERT INTO synced_items (hubspot_object_id, hubspot_object_type, clickup_task_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (hubspot_object_id, hubspot_object_type) DO NOTHING;
    `;

    const values = [hubspotObjectId, hubspotObjectType, clickupTaskId];

    console.log('📥 Executing INSERT into synced_items with values:', values);
    await client.query(query, values);
    console.log(`✅ Sync record saved for ${hubspotObjectType} ${hubspotObjectId}`);
  } catch (err) {
    console.error(`❌ Failed to save sync record for ${hubspotObjectType} ${hubspotObjectId}:`, err);
  } finally {
    client.release();
  }
}

async function getClickUpTaskIdByHubspotTicketId(ticketId) {
  const result = await pool.query(
    'SELECT clickup_task_id FROM synced_items WHERE hubspot_object_id = $1 AND hubspot_object_type = $2',
    [ticketId, 'ticket']
  );
  return result.rows[0]?.clickup_task_id || null;
}

// 🔍 Busca el registro de sincronización completo
async function findSyncedItem({ hubspotObjectId, hubspotObjectType }) {
  const query = `
    SELECT * FROM synced_items
    WHERE hubspot_object_id = $1 AND hubspot_object_type = $2
    LIMIT 1
  `;
  const values = [hubspotObjectId, hubspotObjectType];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function findSyncedItemByClickupTaskId(clickupTaskId) {
  const query = `
    SELECT * FROM synced_items
    WHERE clickup_task_id = $1
    LIMIT 1
  `;
  const values = [clickupTaskId];

  const result = await pool.query(query, values);
  return result.rows[0] || null;
}

async function isClickupTaskAlreadySynced(clickupTaskId) {
  const query = `
    SELECT 1
    FROM synced_items
    WHERE clickup_task_id = $1
    LIMIT 1
  `;
  const values = [clickupTaskId];

  const result = await pool.query(query, values);
  return result.rowCount > 0;
}

module.exports = {
  isTicketAlreadySynced,
  saveSyncedItem,
  getClickUpTaskIdByHubspotTicketId,
  findSyncedItem,
  isClickupTaskAlreadySynced,
  findSyncedItemByClickupTaskId,
  isHubspotObjectAlreadySynced,
  findSyncedItemByHubspotObjectId
};
