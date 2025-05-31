const dotenv = require('dotenv');
const { Memory } = require('mem0ai');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

console.log('Setting up memory system for VoiceChat AI...');

async function setupMemory() {
  try {
    // Check for required environment variables
    const requiredVars = [
      'PINECONE_API_KEY',
      'PINECONE_ENVIRONMENT',
      'PINECONE_INDEX',
      'OPENAI_API_KEY'
    ];
    
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      console.error('Error: Missing required environment variables:');
      missingVars.forEach(varName => {
        console.error(`- ${varName}`);
      });
      console.error('\nPlease add these to your .env file and try again.');
      process.exit(1);
    }
    
    console.log('Environment variables found. Testing Pinecone connection...');
    
    // Test Pinecone connection
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
    
    const memory = Memory.from_config(config);
    
    // Test basic Pinecone functionality
    console.log('Testing basic memory functionality...');
    
    // Test storing a simple memory
    const testResult = await memory.add(
      [{ role: "system", content: "This is a test memory for setup verification." }], 
      "setup-test-user"
    );
    
    console.log('Memory system test successful!');
    console.log(`Test memory ID: ${testResult.id}`);
    console.log('\nSetup complete! Your memory system is ready to use.');
    console.log('\nTo start your server:');
    console.log('npm run dev');
    
    // Clean up test memory
    await memory.delete(testResult.id);
    
    // Now test conversation memory specifically
    const conversationMemoryWorking = await testConversationMemory(memory);
    if (conversationMemoryWorking) {
      console.log('Conversation memory is working correctly - your agent will be stateful!');
    } else {
      console.log('⚠️ Conversation memory test failed - your agent may not maintain state correctly');
    }
    
  } catch (error) {
    console.error('Error setting up memory system:');
    console.error(error);
    process.exit(1);
  }
}

// Test storing and retrieving conversation history
async function testConversationMemory(memory) {
  console.log('Testing conversation history storage and retrieval...');
  
  const testUserId = "test-conversation-user";
  const testSessionId = uuidv4();
  
  // Sample conversation
  const testConversation = [
    { role: "user", content: "Hello Mom, can you help me cook something?", timestamp: Date.now() - 5000 },
    { role: "assistant", content: "Of course, beta! What would you like to make today?", timestamp: Date.now() - 4000 },
    { role: "user", content: "I want to make butter chicken", timestamp: Date.now() - 3000 },
    { role: "assistant", content: "Great choice! Let's make butter chicken. Do you have all the ingredients ready?", timestamp: Date.now() - 2000 },
    { role: "user", content: "Yes, I have everything", timestamp: Date.now() - 1000 }
  ];
  
  // Store the conversation
  const result = await memory.add(
    testConversation,
    testUserId,
    {
      sessionId: testSessionId,
      conversationType: 'chat_history',
      messageCount: testConversation.length,
      timeContext: {
        timestamp: Date.now(),
        iso: new Date().toISOString()
      }
    }
  );
  
  console.log(`Stored test conversation with ID: ${result.id}`);
  
  // Retrieve the conversation
  const searchResult = await memory.search("butter chicken", testUserId);
  
  if (searchResult.length > 0) {
    console.log('Successfully retrieved conversation about butter chicken!');
    console.log(`Found ${searchResult.length} relevant memories`);
    console.log('✅ Conversation memory storage and retrieval is working correctly');
  } else {
    console.log('⚠️ Could not retrieve the test conversation. Memory retrieval may not be working correctly.');
  }
  
  // Clean up
  await memory.delete_all(testUserId);
  console.log('Cleaned up test conversation data');
  
  return searchResult.length > 0;
}

setupMemory();