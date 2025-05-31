const { Memory } = require('mem0ai');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

// Initialize Mem0 Memory with Qdrant for persistent storage
const config = {
  vector_store: {
    provider: "qdrant",
    config: {
      host: process.env.QDRANT_HOST || "localhost",
      port: process.env.QDRANT_PORT || 6333,
    }
  },
  llm: {
    provider: "openai",
    config: {
      api_key: process.env.OPENAI_API_KEY,
      model: "gpt-4o"
    }
  }
};

// Initialize memory instance
let memoryInstance = null;

const initializeMemory = async () => {
  if (!memoryInstance) {
    memoryInstance = Memory.from_config(config);
    console.log("Memory system initialized successfully");
  }
  return memoryInstance;
};

// Time context manager
const timeContextManager = {
  getCurrentTimeContext: () => {
    const now = moment();
    return {
      timestamp: now.valueOf(),
      iso: now.toISOString(),
      readableTime: now.format('MMMM Do YYYY, h:mm:ss a'),
      dayOfWeek: now.format('dddd'),
      timeOfDay: (() => {
        const hour = now.hour();
        if (hour < 6) return 'night';
        if (hour < 12) return 'morning';
        if (hour < 18) return 'afternoon';
        return 'evening';
      })()
    };
  },
  
  getSessionDuration: (startTime) => {
    const now = moment();
    const start = moment(startTime);
    const duration = moment.duration(now.diff(start));
    
    return {
      milliseconds: duration.asMilliseconds(),
      seconds: Math.floor(duration.asSeconds()),
      minutes: Math.floor(duration.asMinutes()),
      hours: Math.floor(duration.asHours()),
      humanReadable: duration.humanize()
    };
  }
};

// Memory operations
const memoryManager = {
  // Store conversation with time context
  storeConversation: async (userId, messages, metadata = {}) => {
    try {
      const memory = await initializeMemory();
      
      // Add time context to metadata
      const timeContext = timeContextManager.getCurrentTimeContext();
      const enrichedMetadata = {
        ...metadata,
        timeContext,
        conversationId: metadata.conversationId || uuidv4()
      };
      
      // Store the conversation with Mem0
      const result = await memory.add(messages, userId, enrichedMetadata);
      
      console.log(`Stored conversation for user ${userId} with ID ${result.id}`);
      return result;
    } catch (error) {
      console.error('Error storing conversation in memory:', error);
      throw error;
    }
  },
  
  // Retrieve relevant memories for the current conversation
  retrieveRelevantMemories: async (userId, query) => {
    try {
      const memory = await initializeMemory();
      
      // Search for relevant memories
      const memories = await memory.search(query, userId);
      
      // Enhance memories with time-based context
      const enhancedMemories = memories.map(mem => {
        const createdAt = mem.metadata?.timeContext?.timestamp || Date.now();
        const timeSince = moment(createdAt).fromNow();
        
        return {
          ...mem,
          timeSince,
          isRecent: moment().diff(moment(createdAt), 'hours') < 24
        };
      });
      
      return enhancedMemories;
    } catch (error) {
      console.error('Error retrieving memories:', error);
      return [];
    }
  },
  
  // Get all user memories
  getAllUserMemories: async (userId) => {
    try {
      const memory = await initializeMemory();
      return await memory.get_all(userId);
    } catch (error) {
      console.error('Error getting all user memories:', error);
      return [];
    }
  },
  
  // Update a specific memory
  updateMemory: async (memoryId, newData) => {
    try {
      const memory = await initializeMemory();
      return await memory.update(memoryId, newData);
    } catch (error) {
      console.error(`Error updating memory ${memoryId}:`, error);
      throw error;
    }
  },
  
  // Get memory history
  getMemoryHistory: async (memoryId) => {
    try {
      const memory = await initializeMemory();
      return await memory.history(memoryId);
    } catch (error) {
      console.error(`Error getting memory history for ${memoryId}:`, error);
      return [];
    }
  },
  
  // Delete user memories
  deleteUserMemories: async (userId) => {
    try {
      const memory = await initializeMemory();
      await memory.delete_all(userId);
      console.log(`Deleted all memories for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`Error deleting memories for user ${userId}:`, error);
      throw error;
    }
  }
};

// Session manager
const sessionManager = {
  activeSessions: new Map(),
  
  createSession: (userId) => {
    const sessionId = uuidv4();
    const startTime = Date.now();
    
    sessionManager.activeSessions.set(sessionId, {
      userId,
      startTime,
      lastActiveTime: startTime,
      interactions: 0,
      memoryIds: []
    });
    
    return {
      sessionId,
      startTime,
      timeContext: timeContextManager.getCurrentTimeContext()
    };
  },
  
  updateSession: (sessionId, updates = {}) => {
    if (!sessionManager.activeSessions.has(sessionId)) {
      return null;
    }
    
    const session = sessionManager.activeSessions.get(sessionId);
    const updatedSession = {
      ...session,
      ...updates,
      lastActiveTime: Date.now()
    };
    
    // Increment interactions count if not specified in updates
    if (!updates.hasOwnProperty('interactions')) {
      updatedSession.interactions += 1;
    }
    
    sessionManager.activeSessions.set(sessionId, updatedSession);
    return updatedSession;
  },
  
  getSession: (sessionId) => {
    if (!sessionManager.activeSessions.has(sessionId)) {
      return null;
    }
    
    const session = sessionManager.activeSessions.get(sessionId);
    const duration = timeContextManager.getSessionDuration(session.startTime);
    
    return {
      ...session,
      duration,
      currentTime: timeContextManager.getCurrentTimeContext()
    };
  },
  
  endSession: async (sessionId) => {
    if (!sessionManager.activeSessions.has(sessionId)) {
      return null;
    }
    
    const session = sessionManager.activeSessions.get(sessionId);
    const duration = timeContextManager.getSessionDuration(session.startTime);
    
    // Store session summary in memory
    try {
      const endTime = Date.now();
      const sessionSummary = {
        sessionId,
        userId: session.userId,
        startTime: session.startTime,
        endTime,
        duration: duration.humanReadable,
        interactions: session.interactions,
        memoryIds: session.memoryIds
      };
      
      await memoryManager.storeConversation(
        session.userId,
        [
          {
            role: "system",
            content: `Session summary: User had a conversation lasting ${duration.humanReadable} with ${session.interactions} interactions.`
          }
        ],
        {
          category: "session_summary",
          sessionSummary
        }
      );
      
      sessionManager.activeSessions.delete(sessionId);
      return sessionSummary;
    } catch (error) {
      console.error(`Error ending session ${sessionId}:`, error);
      throw error;
    }
  }
};

module.exports = {
  memoryManager,
  sessionManager,
  timeContextManager,
  initializeMemory
};