// Create a new file called delay-handler.js
const moment = require('moment');

// Track pending delays
const pendingDelays = new Map();

// Process text for time delays
function processDelayInstructions(text) {
  // Match patterns like "wait for 5 seconds", "delay response by 10 seconds", etc.
  const delayPatterns = [
    /wait for (\d+) seconds?/i,
    /delay (?:response|reply) by (\d+) seconds?/i,
    /pause for (\d+) seconds?/i,
    /hold for (\d+) seconds?/i,
    /wait (\d+) seconds?/i,
  ];
  
  // Also match Hindi-English mixed patterns
  const hinglishPatterns = [
    /(\d+) seconds? wait karo/i,
    /(\d+) seconds? ke baad jawab do/i,
    /(\d+) seconds? ruko/i,
  ];
  
  const allPatterns = [...delayPatterns, ...hinglishPatterns];
  
  let delaySeconds = 0;
  let matchedPattern = false;
  
  for (const pattern of allPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      delaySeconds = parseInt(match[1]);
      matchedPattern = true;
      break;
    }
  }
  
  return {
    hasDelay: matchedPattern,
    delaySeconds: delaySeconds
  };
}

// Create a delay for a session
function createDelay(sessionId, delaySeconds) {
  const now = moment();
  const delayUntil = moment().add(delaySeconds, 'seconds');
  
  const delay = {
    sessionId,
    delaySeconds,
    startTime: now.valueOf(),
    endTime: delayUntil.valueOf(),
    isActive: true
  };
  
  pendingDelays.set(sessionId, delay);
  console.log(`Created delay for session ${sessionId}: ${delaySeconds} seconds`);
  
  return delay;
}

// Check if session has active delay
function hasActiveDelay(sessionId) {
  if (!pendingDelays.has(sessionId)) {
    return false;
  }
  
  const delay = pendingDelays.get(sessionId);
  if (!delay.isActive) {
    return false;
  }
  
  const now = moment().valueOf();
  if (now >= delay.endTime) {
    // Delay has expired
    delay.isActive = false;
    pendingDelays.set(sessionId, delay);
    return false;
  }
  
  // Delay is still active
  return true;
}

// Get remaining delay time
function getRemainingDelayTime(sessionId) {
  if (!pendingDelays.has(sessionId)) {
    return 0;
  }
  
  const delay = pendingDelays.get(sessionId);
  if (!delay.isActive) {
    return 0;
  }
  
  const now = moment().valueOf();
  if (now >= delay.endTime) {
    // Delay has expired
    delay.isActive = false;
    pendingDelays.set(sessionId, delay);
    return 0;
  }
  
  // Calculate remaining time in seconds
  return Math.ceil((delay.endTime - now) / 1000);
}

// Clear delay for a session
function clearDelay(sessionId) {
  if (pendingDelays.has(sessionId)) {
    pendingDelays.delete(sessionId);
    return true;
  }
  return false;
}

module.exports = {
  processDelayInstructions,
  createDelay,
  hasActiveDelay,
  getRemainingDelayTime,
  clearDelay
};