const dotenv = require('dotenv');
const { Memory } = require('mem0ai');

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
    
  } catch (error) {
    console.error('Error setting up memory system:');
    console.error(error);
    process.exit(1);
  }
}

setupMemory();