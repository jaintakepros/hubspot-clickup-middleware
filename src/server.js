const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const { handleHubSpotTicket } = require('./handlers/handleHubSpotTicket');
const handleClickupTasks = require('./handlers/handleClickupTasks');
const { handleHubSpotTask } = require('./handlers/handleHubSpotTask.js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());

// Webhook de HubSpot (tickets y tasks)
app.post('/webhook/hubspot/', async (req, res) => {
  res.sendStatus(200);

  const events = req.body;

  for (const event of events) {
    const { subscriptionType, objectTypeId } = event;

    try {
      if (
        subscriptionType === 'ticket.creation' ||
        subscriptionType === 'ticket.propertyChange'
      ) {
        await handleHubSpotTicket(event);
      } else if (
        subscriptionType === 'object.creation' ||
        subscriptionType === 'object.propertyChange'
      ) {
        // TASK en HubSpot = objectTypeId === '0-27'
        if (objectTypeId === '0-27') {
          await handleHubSpotTask(event);
        }
      }
    } catch (error) {
      console.error('❌ Error handling HubSpot event:', error, '\nEvent:', event);
    }
  }
});

// Webhook de ClickUp
app.post('/webhook/clickup/tasks', async (req, res) => {
  res.sendStatus(200);

  try {
    await handleClickupTasks(req.body);
  } catch (error) {
    console.error('Error handling ClickUp webhook:', error);
  }
});

// En server.js o tu archivo principal
app.get('/ping', (req, res) => {
  res.send('pong');
});


app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
