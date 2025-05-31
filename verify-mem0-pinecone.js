const dotenv = require('dotenv');
const { Memory } = require('mem0ai');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

async function verifyMem0PineconeConnection() {
  try {
    console.log('Verifying Mem0 connection to Pinecone...');
    
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
    
    // Initialize Mem0 with Pinecone
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
      },
      embedder: {
        provider: "openai",
        config: {
          api_key: process.env.OPENAI_API_KEY,
          model: "text-embedding-3-large"
        }
      }
    };
    
    console.log('Initializing Mem0 with configuration:', JSON.stringify(config, null, 2));
    
    const memory = Memory.from_config(config);
    console.log('Mem0 initialized successfully');
    
    // Test adding a memory
    const testUserId = `test-user-${Date.now()}`;
    console.log(`Creating test memory for user ${testUserId}...`);
    
    const testResult = await memory.add(
      [{ role: "system", content: "This is a test memory from verify-mem0-pinecone script." }],
      testUserId
    );
    
    console.log(`Test memory created with ID: ${testResult.id}`);
    
    // Test retrieving the memory
    console.log('Retrieving test memory...');
    const retrieveResult = await memory.get(testResult.id);
    
    if (retrieveResult) {
      console.log('✅ Successfully retrieved test memory:', retrieveResult);
    } else {
      console.log('⚠️ Failed to retrieve test memory');
    }
    
    // Test searching for the memory
    console.log('Searching for test memory...');
    const searchResults = await memory.search("test memory", testUserId);
    
    if (searchResults.length > 0) {
      console.log(`✅ Successfully found ${searchResults.length} memories in search`);
    } else {
      console.log('⚠️ Search did not return any results');
    }
    
    // Clean up test memory
    console.log('Cleaning up test memory...');
    await memory.delete(testResult.id);
    
    console.log('Verification complete!');
    
    if (retrieveResult && searchResults.length > 0) {
      console.log('✅ Mem0 connection to Pinecone is working correctly');
    } else {
      console.log('⚠️ There may be issues with the Mem0-Pinecone connection');
    }
    
  } catch (error) {
    console.error('Error verifying Mem0-Pinecone connection:');
    console.error(error);
  }
}

verifyMem0PineconeConnection(); 