const { Memory } = require('mem0ai');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

// Initialize Mem0 Memory with Pinecone
const config = {
  vector_store: {
    provider: "pinecone",
    config: {
      api_key: process.env.PINECONE_API_KEY,
      environment: process.env.PINECONE_ENVIRONMENT,
      index: process.env.PINECONE_INDEX
    }
  },
  llm: {
    provider: "openai",
    config: {
      api_key: process.env.OPENAI_API_KEY,
      model: "gpt-4o-mini"
    }
  }
};

// Initialize memory instance
let memoryInstance = null;

const initializeMemory = async () => {
  if (!memoryInstance) {
    try {
      memoryInstance = Memory.from_config(config);
      console.log("Memory system initialized successfully");
    } catch (error) {
      console.error("Error initializing memory system:", error);
      console.log("Falling back to in-memory storage");
      
      // Fallback to in-memory storage if Pinecone setup fails
      memoryInstance = new Memory();
    }
  }
  return memoryInstance;
};

// Time context manager with reminder functionality
const timeContextManager = {
  // Store active reminders
  activeReminders: new Map(),
  
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
  },
  
  // Set a reminder for a future time
  setReminder: (sessionId, userId, task, durationInSeconds, callback) => {
    const reminderId = uuidv4();
    const now = moment();
    const reminderTime = now.add(durationInSeconds, 'seconds');
    
    console.log(`Setting reminder for ${durationInSeconds} seconds from now`);
    
    const reminder = {
      id: reminderId,
      sessionId,
      userId,
      task,
      createdAt: now.valueOf(),
      reminderTime: reminderTime.valueOf(),
      durationInSeconds,
      isCompleted: false,
      wasTriggered: false
    };
    
    // Store the reminder
    timeContextManager.activeReminders.set(reminderId, reminder);
    
    // Set the timeout to trigger the reminder
    const timeoutId = setTimeout(() => {
      const reminderToTrigger = timeContextManager.activeReminders.get(reminderId);
      if (reminderToTrigger && !reminderToTrigger.isCompleted) {
        reminderToTrigger.wasTriggered = true;
        timeContextManager.activeReminders.set(reminderId, reminderToTrigger);
        
        console.log(`Triggering reminder: ${task}`);
        
        // Execute the callback function when the timer completes
        if (callback && typeof callback === 'function') {
          callback(reminderToTrigger);
        }
      }
    }, durationInSeconds * 1000);
    
    // Store the timeout ID so we can clear it if needed
    reminder.timeoutId = timeoutId;
    timeContextManager.activeReminders.set(reminderId, reminder);
    
    return reminder;
  },
  
  // Check if there are any pending reminders for a session
  getPendingReminders: (sessionId) => {
    const now = moment().valueOf();
    const pendingReminders = [];
    
    timeContextManager.activeReminders.forEach((reminder) => {
      if (reminder.sessionId === sessionId && 
          !reminder.isCompleted && 
          reminder.reminderTime <= now &&
          reminder.wasTriggered) {
        pendingReminders.push(reminder);
      }
    });
    
    return pendingReminders;
  },
  
  // Mark a reminder as completed
  completeReminder: (reminderId) => {
    const reminder = timeContextManager.activeReminders.get(reminderId);
    if (reminder) {
      reminder.isCompleted = true;
      timeContextManager.activeReminders.set(reminderId, reminder);
      return true;
    }
    return false;
  },
  
  // Clear all reminders for a session
  clearSessionReminders: (sessionId) => {
    timeContextManager.activeReminders.forEach((reminder, id) => {
      if (reminder.sessionId === sessionId) {
        if (reminder.timeoutId) {
          clearTimeout(reminder.timeoutId);
        }
        timeContextManager.activeReminders.delete(id);
      }
    });
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
      // Return a mock result if memory storage fails
      return { id: uuidv4(), success: false, error: error.message };
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
      return { id: memoryId, success: false, error: error.message };
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
      return false;
    }
  },
  
  // Store complete chat history
  storeCompleteChatHistory: async (userId, messages, sessionId) => {
    try {
      const memory = await initializeMemory();
      
      // Add time context and enhanced metadata
      const timeContext = timeContextManager.getCurrentTimeContext();
      const metadata = {
        sessionId,
        timeContext,
        conversationType: 'chat_history',
        messageCount: messages.length
      };
      
      // Store the entire conversation history
      const result = await memory.add(messages, userId, metadata);
      
      console.log(`Stored complete chat history for user ${userId} with ${messages.length} messages`);
      return result;
    } catch (error) {
      console.error('Error storing chat history in memory:', error);
      return { id: uuidv4(), success: false, error: error.message };
    }
  },
  
  // Get conversation history
  getConversationHistory: async (userId, limit = 20) => {
    try {
      const memory = await initializeMemory();
      
      // Search for conversation history
      const query = "conversation history";
      const memories = await memory.search(query, userId, limit);
      
      // Extract messages from memories
      let allMessages = [];
      memories.forEach(mem => {
        if (mem.messages && Array.isArray(mem.messages)) {
          allMessages = [...allMessages, ...mem.messages];
        }
      });
      
      // Sort by timestamp if available
      allMessages.sort((a, b) => {
        const timeA = a.timestamp || 0;
        const timeB = b.timestamp || 0;
        return timeA - timeB;
      });
      
      return allMessages;
    } catch (error) {
      console.error('Error retrieving conversation history:', error);
      return [];
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
      memoryIds: [],
      timeContext: timeContextManager.getCurrentTimeContext()
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
      lastActiveTime: Date.now(),
      timeContext: timeContextManager.getCurrentTimeContext()
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
      currentTime: timeContextManager.getCurrentTimeContext(),
      pendingReminders: timeContextManager.getPendingReminders(sessionId)
    };
  },
  
  endSession: async (sessionId) => {
    if (!sessionManager.activeSessions.has(sessionId)) {
      return null;
    }
    
    const session = sessionManager.activeSessions.get(sessionId);
    const duration = timeContextManager.getSessionDuration(session.startTime);
    
    // Clear any active reminders for this session
    timeContextManager.clearSessionReminders(sessionId);
    
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
      sessionManager.activeSessions.delete(sessionId);
      return { 
        sessionId,
        error: error.message,
        success: false
      };
    }
  }
};

module.exports = {
  memoryManager,
  sessionManager,
  timeContextManager,
  initializeMemory
};