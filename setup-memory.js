const { exec } = require('child_process');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

dotenv.config();

console.log('Setting up memory system for VoiceChat AI...');

// Check if Docker is installed
exec('docker -v', (error) => {
  if (error) {
    console.error('Docker is required but not installed. Please install Docker first.');
    console.error('Visit https://docs.docker.com/get-docker/ for installation instructions.');
    process.exit(1);
  }
  
  console.log('Docker is installed. Proceeding with Qdrant setup...');
  
  // Create storage directory for Qdrant
  const qdrantStoragePath = path.join(__dirname, 'qdrant_storage');
  if (!fs.existsSync(qdrantStoragePath)) {
    fs.mkdirSync(qdrantStoragePath, { recursive: true });
    console.log(`Created Qdrant storage directory at ${qdrantStoragePath}`);
  }
  
  // Check if Qdrant is already running
  exec('docker ps | grep qdrant', (error, stdout) => {
    if (stdout && stdout.includes('qdrant/qdrant')) {
      console.log('Qdrant is already running. You can use the existing instance.');
      console.log('Setup complete! Your memory system is ready to use.');
      return;
    }
    
    // Start Qdrant container
    const command = `docker run -d -p 6333:6333 -p 6334:6334 -v ${qdrantStoragePath}:/qdrant/storage:z --name voicechat-qdrant qdrant/qdrant`;
    
    exec(command, (error, stdout) => {
      if (error) {
        console.error('Error starting Qdrant container:', error.message);
        process.exit(1);
      }
      
      console.log('Qdrant container started successfully!');
      console.log('Container ID:', stdout.trim());
      console.log('\nSetup complete! Your memory system is ready to use.');
      console.log('\nTo use the memory system:');
      console.log('1. Make sure your .env file contains all required variables (see .env.example)');
      console.log('2. Start your server: npm run dev');
    });
  });
});