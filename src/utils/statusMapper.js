function mapStatus(ticket) {
  const stageId = ticket.properties.hs_pipeline_stage;

  console.log(`TICKET STATUS: ${stageId}`);

  if (stageId === '1') return 'not started';
  if (stageId === '4') return 'complete';
  return 'in progress';
}

function mapPriority(priority) {
  switch (priority) {
    case 'HIGH':
      return 2;
    case 'LOW':
      return 0;
    case 'MEDIUM':
      return 1;
    default:
      return null;
  }
}


module.exports = {
  mapStatus,
  mapPriority
};