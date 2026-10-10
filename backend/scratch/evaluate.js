import { getOutbreakDetection } from '../src/analytics/anomaly.js'

async function evaluate() {
  console.log('Evaluating baseline moving average detector...')
  const result = await getOutbreakDetection('State', 'Central', 'INFLUENZA_LIKE_ILLNESS')
  
  if (!result || !result.results) {
    console.log('No result to evaluate.')
    return
  }

  const { results: data } = result
  let falseAlerts = 0
  let detectionDelay = null
  let outbreakDetected = false

  // The synthetic sequence generates an outbreak at index 20
  const OUTBREAK_START_IDX = 20
  
  for (let i = 0; i < data.length; i++) {
    const isAlert = data[i].isAlert
    const isActualOutbreak = data[i].isSyntheticOutbreak
    
    if (isAlert && !isActualOutbreak) {
      falseAlerts++
    }
    
    if (isActualOutbreak && isAlert && !outbreakDetected) {
      outbreakDetected = true
      detectionDelay = i - OUTBREAK_START_IDX
    }
  }

  console.log('Evaluation Results:')
  console.log('-------------------')
  console.log(`False Alerts (on normal data): ${falseAlerts} months`)
  console.log(`Detection Delay (after onset): ${detectionDelay !== null ? detectionDelay + ' months' : 'Failed to detect'}`)
  console.log(`Outbreak Identified: ${outbreakDetected ? 'Yes' : 'No'}`)
}

evaluate().catch(console.error)
