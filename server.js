const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const app = express();

// Update CORS to allow requests from your frontend domain
app.use(cors({
  origin: ["https://hackthon-frontend-tau.vercel.app", "http://localhost:3000"],
  methods: ["GET", "POST"],
  credentials: true
}));
app.use(express.json());

// Add session tracking
const activeSessions = new Map();

app.get("/api/signed-url", async (req, res) => {
  try {
    // Generate a unique session ID for this request
    const sessionId = req.query.sessionId || Date.now().toString();
    
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
    
    // Track this session
    activeSessions.set(sessionId, {
      lastActive: Date.now(),
      signedUrl: data.signed_url
    });
    
    // Include session ID in response
    res.json({ 
      signedUrl: data.signed_url,
      sessionId: sessionId
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to get signed URL" });
  }
});

// Session keep-alive endpoint
app.post("/api/keep-alive", (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId || !activeSessions.has(sessionId)) {
    return res.status(404).json({ error: "Session not found" });
  }
  
  // Update last active timestamp
  const session = activeSessions.get(sessionId);
  session.lastActive = Date.now();
  activeSessions.set(sessionId, session);
  
  res.json({ status: "ok" });
});

// End session endpoint
app.post("/api/end-session", (req, res) => {
  const { sessionId } = req.body;
  
  if (sessionId && activeSessions.has(sessionId)) {
    activeSessions.delete(sessionId);
  }
  
  res.json({ status: "ok" });
});

//API route for getting Agent ID, used for public agents
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
