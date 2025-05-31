const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { memoryManager, sessionManager, timeContextManager } = require("./memory-manager");
const delayHandler = require('./delay-handler');

dotenv.config();

const app = express();

// Update CORS to allow requests from your frontend domain
app.use(cors({
  origin: ["https://hackthon-frontend-tau.vercel.app", "http://localhost:3000"],
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

// Store active conversations
const activeConversations = new Map();

// Middleware to initialize memory system
app.use(async (req, res, next) => {
  try {
    // Initialize memory system
    await memoryManager.initializeMemory();
    next();
  } catch (error) {
    console.error("Error initializing memory system:", error);
    next();
  }
});

// Get signed URL for ElevenLabs
app.get("/api/signed-url", async (req, res) => {
  try {
    // Get or create user ID and session ID
    const userId = req.query.userId || uuidv4();
    let sessionId = req.query.sessionId;
    
    if (!sessionId) {
      // Create new session if no session ID provided
      const session = sessionManager.createSession(userId);
      sessionId = session.sessionId;
    } else {
      // Update existing session's last active time
      sessionManager.updateSession(sessionId);
    }
    
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${process.env.AGENT_ID}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": process.env.XI_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to get signed URL");
    }

    const data = await response.json();
    
    // Store the conversation in our active conversations map
    activeConversations.set(sessionId, {
      userId,
      startTime: Date.now(),
      messages: [],
      signedUrl: data.signed_url
    });
    
    res.json({ 
      signedUrl: data.signed_url,
      userId,
      sessionId
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get signed URL" });
  }
});

// Store conversation transcript and extract memories
app.post("/api/store-conversation", async (req, res) => {
  try {
    const { userId, sessionId, messages } = req.body;
    
    if (!userId || !sessionId || !messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid request parameters" });
    }
    
    // Get current session
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    // Update session with interaction
    sessionManager.updateSession(sessionId);
    
    // Process messages for time-based reminders
    const lastUserMessage = messages.find(m => m.role === 'user')?.content;
    if (lastUserMessage) {
      // Check for reminder requests in user message
      checkForReminderRequests(sessionId, userId, lastUserMessage);
    }
    
    // Check for pending reminders
    const pendingReminders = timeContextManager.getPendingReminders(sessionId);
    
    // Store individual messages as conversation memory
    const timeContext = timeContextManager.getCurrentTimeContext();
    const result = await memoryManager.storeConversation(userId, messages, {
      sessionId,
      timeContext,
      conversationId: uuidv4()
    });
    
    // Also store the complete chat history to maintain state
    // This helps the agent remember the entire conversation flow
    // Get existing conversation history
    let conversationHistory = await memoryManager.getConversationHistory(userId, 100);
    
    // Add new messages to history
    messages.forEach(message => {
      // Add timestamp to message
      message.timestamp = Date.now();
      conversationHistory.push(message);
    });
    
    // Store updated history
    await memoryManager.storeCompleteChatHistory(userId, conversationHistory, sessionId);
    
    // Update session with memory ID
    const updatedSession = sessionManager.updateSession(sessionId, {
      memoryIds: [...session.memoryIds, result.id]
    });
    
    res.json({
      success: true,
      memoryId: result.id,
      session: updatedSession,
      pendingReminders: pendingReminders,
      historyCount: conversationHistory.length
    });
  } catch (error) {
    console.error("Error storing conversation:", error);
    res.status(500).json({ error: "Failed to store conversation" });
  }
});

// Function to extract and set time-based reminders from user messages
function checkForReminderRequests(sessionId, userId, message) {
  // Pattern 1: "Remind me in X seconds/minutes/hours to do [task]"
  const reminderPattern1 = /remind me in (\d+) (second|seconds|minute|minutes|hour|hours) to (.*)/i;
  // Pattern 2: "X seconds/minutes/hours ke baad yaad dila dena [task]"
  const reminderPattern2 = /(\d+) (second|seconds|minute|minutes|hour|hours) ke baad yaad dila dena (.*)/i;
  // Pattern 3: "X seconds/minutes/hours baad [task] yaad dila dena"
  const reminderPattern3 = /(\d+) (second|seconds|minute|minutes|hour|hours) baad (.*) yaad dila dena/i;
  
  let match = message.match(reminderPattern1) || message.match(reminderPattern2) || message.match(reminderPattern3);
  
  if (match) {
    const amount = parseInt(match[1]);
    const unit = match[2].toLowerCase();
    const task = match[3];
    
    let durationInSeconds = amount;
    if (unit.includes('minute')) {
      durationInSeconds = amount * 60;
    } else if (unit.includes('hour')) {
      durationInSeconds = amount * 60 * 60;
    }
    
    console.log(`Setting reminder: ${task} in ${durationInSeconds} seconds`);
    
    // Set the reminder
    timeContextManager.setReminder(sessionId, userId, task, durationInSeconds, (reminder) => {
      console.log(`Reminder triggered: ${reminder.task}`);
      // The triggered reminder will be picked up by the next API call
    });
  }
}

// Check for pending reminders
app.get("/api/check-reminders", (req, res) => {
  try {
    const { sessionId } = req.query;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    
    const pendingReminders = timeContextManager.getPendingReminders(sessionId);
    
    // Mark all retrieved reminders as completed
    pendingReminders.forEach(reminder => {
      timeContextManager.completeReminder(reminder.id);
    });
    
    res.json({
      pendingReminders,
      currentTime: timeContextManager.getCurrentTimeContext()
    });
  } catch (error) {
    console.error("Error checking reminders:", error);
    res.status(500).json({ error: "Failed to check reminders" });
  }
});

// Create a reminder
app.post("/api/set-reminder", (req, res) => {
  try {
    const { sessionId, userId, task, durationInSeconds } = req.body;
    
    if (!sessionId || !userId || !task || !durationInSeconds) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    
    const reminder = timeContextManager.setReminder(sessionId, userId, task, durationInSeconds, () => {
      console.log(`Reminder triggered: ${task}`);
    });
    
    res.json({
      success: true,
      reminder
    });
  } catch (error) {
    console.error("Error setting reminder:", error);
    res.status(500).json({ error: "Failed to set reminder" });
  }
});

// Retrieve relevant memories for context
app.post("/api/retrieve-context", async (req, res) => {
  try {
    const { userId, query } = req.body;
    
    if (!userId || !query) {
      return res.status(400).json({ error: "Missing userId or query" });
    }
    
    // Get relevant memories based on query
    const memories = await memoryManager.retrieveRelevantMemories(userId, query);
    
    res.json({
      memories,
      currentTime: timeContextManager.getCurrentTimeContext()
    });
  } catch (error) {
    console.error("Error retrieving context:", error);
    res.status(500).json({ error: "Failed to retrieve context" });
  }
});

// End session and store summary
app.post("/api/end-session", async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    
    console.log(`Ending session: ${sessionId}`);
    
    // End the session and get summary
    const summary = await sessionManager.endSession(sessionId);
    
    if (!summary) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    // Remove from active conversations
    activeConversations.delete(sessionId);
    
    // Clear any active reminders for this session
    timeContextManager.clearSessionReminders(sessionId);
    
    res.json({
      success: true,
      summary
    });
  } catch (error) {
    console.error("Error ending session:", error);
    res.status(500).json({ error: "Failed to end session" });
  }
});

// Get user memories
app.get("/api/user-memories/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    
    const memories = await memoryManager.getAllUserMemories(userId);
    
    res.json({
      memories,
      currentTime: timeContextManager.getCurrentTimeContext()
    });
  } catch (error) {
    console.error("Error retrieving user memories:", error);
    res.status(500).json({ error: "Failed to retrieve user memories" });
  }
});

// Keep-alive endpoint to maintain session
app.post("/api/keep-alive", (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId" });
    }
    
    // Update session last active time
    const session = sessionManager.updateSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    // Check for pending reminders
    const pendingReminders = timeContextManager.getPendingReminders(sessionId);
    
    res.json({
      success: true,
      session,
      pendingReminders,
      currentTime: timeContextManager.getCurrentTimeContext()
    });
  } catch (error) {
    console.error("Error in keep-alive:", error);
    res.status(500).json({ error: "Failed to update session" });
  }
});

// Get agent ID endpoint
app.get("/api/getAgentId", (req, res) => {
  const agentId = process.env.AGENT_ID;
  res.json({
    agentId: `${agentId}`,
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Get conversation history for contextual awareness
app.get("/api/conversation-history/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    
    // Get conversation history
    const history = await memoryManager.getConversationHistory(userId, limit);
    
    res.json({
      history,
      currentTime: timeContextManager.getCurrentTimeContext()
    });
  } catch (error) {
    console.error("Error retrieving conversation history:", error);
    res.status(500).json({ error: "Failed to retrieve conversation history" });
  }
});

// Check agent stateful status
app.get("/api/check-stateful", async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: "Missing userId parameter" });
    }
    
    // Try to initialize memory
    await memoryManager.initializeMemory();
    
    // Get conversation history
    const history = await memoryManager.getConversationHistory(userId, 5);
    
    // Get all memories
    const allMemories = await memoryManager.getAllUserMemories(userId);
    
    // Check if we can retrieve time-based information
    const timeContext = timeContextManager.getCurrentTimeContext();
    
    res.json({
      status: "success",
      statefulStatus: {
        hasMemory: allMemories.length > 0,
        hasConversationHistory: history.length > 0,
        memoryCount: allMemories.length,
        historyMessageCount: history.length,
        timeAwareness: timeContext,
        isFullyStateful: allMemories.length > 0 && timeContext.timestamp > 0
      },
      sampleMemories: allMemories.slice(0, 2),
      sampleHistory: history.slice(0, 3)
    });
  } catch (error) {
    console.error("Error checking stateful status:", error);
    res.status(500).json({ 
      error: "Failed to check stateful status",
      details: error.message
    });
  }
});

// Create a delay (for waiting before response)
app.post("/api/create-delay", (req, res) => {
  try {
    const { sessionId, delaySeconds, message } = req.body;
    
    if (!sessionId || !delaySeconds) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    
    // Create the delay
    const delay = delayHandler.createDelay(sessionId, delaySeconds);
    
    // Store the message that will be sent after the delay
    if (message) {
      delay.message = message;
    }
    
    res.json({
      success: true,
      delay
    });
  } catch (error) {
    console.error("Error creating delay:", error);
    res.status(500).json({ error: "Failed to create delay" });
  }
});

// Check if session has active delay
app.get("/api/check-delay", (req, res) => {
  try {
    const { sessionId } = req.query;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Missing sessionId parameter" });
    }
    
    const hasDelay = delayHandler.hasActiveDelay(sessionId);
    const remainingSeconds = delayHandler.getRemainingDelayTime(sessionId);
    
    res.json({
      hasActiveDelay: hasDelay,
      remainingSeconds: remainingSeconds
    });
  } catch (error) {
    console.error("Error checking delay:", error);
    res.status(500).json({ error: "Failed to check delay" });
  }
});

// Process message for delays
app.post("/api/process-message", (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    if (!sessionId || !message) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    
    // Process the message for delay instructions
    const result = delayHandler.processDelayInstructions(message);
    
    if (result.hasDelay) {
      // Create a delay
      delayHandler.createDelay(sessionId, result.delaySeconds);
    }
    
    res.json({
      success: true,
      hasDelay: result.hasDelay,
      delaySeconds: result.delaySeconds
    });
  } catch (error) {
    console.error("Error processing message:", error);
    res.status(500).json({ error: "Failed to process message" });
  }
});

// Add this middleware to patch the system prompt for better time handling
app.use(async (req, res, next) => {
  // Only intercept requests to ElevenLabs API
  if (req.path.includes('/api/signed-url')) {
    // Store the original send function
    const originalSend = res.send;
    
    // Override the send function
    res.send = function(body) {
      try {
        // Parse the response body
        const data = JSON.parse(body);
        
        // If it has a signed URL, add our time handling instructions
        if (data.signedUrl) {
          console.log('Adding time handling instructions to agent system prompt');
          
          // Store the modified URL
          res.locals.patchedUrl = data.signedUrl;
          
          // You'll need to implement a way to patch the ElevenLabs system prompt
          // This might require a proxy or a custom implementation
        }
      } catch (error) {
        console.error('Error patching system prompt:', error);
      }
      
      // Call the original send function
      return originalSend.call(this, body);
    };
  }
  
  next();
});

// Add this endpoint to handle errors more gracefully
app.use((req, res, next) => {
  res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
    method: req.method
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
