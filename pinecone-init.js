const dotenv = require('dotenv');
const { PineconeClient } = require('@pinecone-database/pinecone');
const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');

dotenv.config();

// Initialize OpenAI for generating embeddings
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function initializePinecone() {
  try {
    console.log('Initializing Pinecone...');
    
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
    
    // Initialize Pinecone client
    const pinecone = new PineconeClient();
    await pinecone.init({
      environment: process.env.PINECONE_ENVIRONMENT,
      apiKey: process.env.PINECONE_API_KEY
    });
    
    // Connect to index
    console.log(`Connecting to Pinecone index: ${process.env.PINECONE_INDEX}...`);
    const indexList = await pinecone.listIndexes();
    console.log('Available indexes:', indexList);
    
    const index = pinecone.Index(process.env.PINECONE_INDEX);
    
    // Sample data for Mom agent
    const memoryData = [
      {
        id: 'memory_' + uuidv4(),
        content: "The user enjoys Indian cuisine and prefers spicy food.",
        metadata: { category: "preferences", importance: "high" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "The user is a beginner cook and needs detailed step-by-step instructions.",
        metadata: { category: "skill_level", importance: "high" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "The user is allergic to peanuts and needs to avoid peanut-containing recipes.",
        metadata: { category: "dietary_restrictions", importance: "critical" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "The user has a small kitchen with basic equipment and limited counter space.",
        metadata: { category: "kitchen_setup", importance: "medium" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "The user typically cooks for 1-2 people and prefers recipes that don't make too many leftovers.",
        metadata: { category: "preferences", importance: "medium" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "The user enjoys learning about the cultural background of dishes.",
        metadata: { category: "preferences", importance: "low" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "Time management capabilities include setting accurate reminders, tracking cooking steps duration, and providing time estimates.",
        metadata: { category: "system_capabilities", importance: "high" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "The system has natural conversation abilities like a caring Indian mother who guides cooking with warmth, patience, and occasional light teasing.",
        metadata: { category: "system_personality", importance: "high" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "The system can understand and respond to time-based instructions like 'Remind me in 5 minutes' or '10 seconds ke baad yaad dila dena paani check karne ke liye'.",
        metadata: { category: "system_capabilities", importance: "high" }
      },
      {
        id: 'memory_' + uuidv4(),
        content: "Common Indian recipes include Butter Chicken, Chole, Dal, various Sabzis, Biryani, and Paneer dishes.",
        metadata: { category: "recipes", importance: "medium" }
      }
    ];
    
    console.log(`Generating embeddings for ${memoryData.length} memories...`);
    
    // Create vectors for each memory
    const vectors = [];
    
    for (const memory of memoryData) {
      // Generate embedding using OpenAI
      const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-large",
        input: memory.content,
        encoding_format: "float"
      });
      
      const embedding = embeddingResponse.data[0].embedding;
      
      // Create vector
      vectors.push({
        id: memory.id,
        values: embedding,
        metadata: {
          ...memory.metadata,
          text: memory.content,
          userId: "system-initialization",
          timestamp: Date.now()
        }
      });
      
      console.log(`Generated embedding for memory: ${memory.id}`);
    }
    
    // Upsert vectors to Pinecone
    console.log(`Upserting ${vectors.length} vectors to Pinecone...`);
    
    // Upsert in batches of 10
    const batchSize = 10;
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize);
      await index.upsert({
        upsertRequest: {
          vectors: batch,
          namespace: ""
        }
      });
      console.log(`Upserted batch ${i/batchSize + 1}/${Math.ceil(vectors.length/batchSize)}`);
    }
    
    // Verify data was inserted
    console.log('Verifying data insertion...');
    const statsResponse = await index.describeIndexStats({
      describeIndexStatsRequest: {}
    });
    
    console.log('Pinecone index stats:', statsResponse);
    console.log(`Total vector count: ${statsResponse.totalVectorCount}`);
    
    if (statsResponse.totalVectorCount >= vectors.length) {
      console.log('✅ Successfully initialized Pinecone with memory data!');
    } else {
      console.log('⚠️ Some vectors may not have been inserted correctly.');
    }
    
    // Create a test query to verify search works
    console.log('Testing search functionality...');
    const queryText = "cooking preferences";
    const queryEmbedding = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: queryText,
      encoding_format: "float"
    });
    
    const queryResponse = await index.query({
      queryRequest: {
        vector: queryEmbedding.data[0].embedding,
        topK: 3,
        includeMetadata: true,
        namespace: ""
      }
    });
    
    console.log(`Query "${queryText}" results:`, queryResponse);
    
    if (queryResponse.matches && queryResponse.matches.length > 0) {
      console.log('Search test successful! Found these matches:');
      queryResponse.matches.forEach((match, i) => {
        console.log(`${i+1}. (Score: ${match.score}) ${match.metadata.text}`);
      });
    } else {
      console.log('⚠️ Search test did not return any results.');
    }
    
  } catch (error) {
    console.error('Error initializing Pinecone:');
    console.error(error);
    process.exit(1);
  }
}

initializePinecone(); 