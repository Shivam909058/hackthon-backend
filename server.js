const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { memoryManager, sessionManager, timeContextManager } = require("./memory-manager");

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
    
    // Store conversation in memory
    const timeContext = timeContextManager.getCurrentTimeContext();
    const result = await memoryManager.storeConversation(userId, messages, {
      sessionId,
      timeContext,
      conversationId: uuidv4()
    });
    
    // Update session with memory ID
    const updatedSession = sessionManager.updateSession(sessionId, {
      memoryIds: [...session.memoryIds, result.id]
    });
    
    res.json({
      success: true,
      memoryId: result.id,
      session: updatedSession
    });
  } catch (error) {
    console.error("Error storing conversation:", error);
    res.status(500).json({ error: "Failed to store conversation" });
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
    
    // End the session and get summary
    const summary = await sessionManager.endSession(sessionId);
    
    if (!summary) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    // Remove from active conversations
    activeConversations.delete(sessionId);
    
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
    
    res.json({
      success: true,
      session
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
