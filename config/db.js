import mongoose from 'mongoose';

const connectDB = async () => {
  const mongoUri = process.env.MONGO_URI?.trim();

  if (!mongoUri) {
    throw new Error('MONGO_URI is not configured. Add it to server/.env.');
  }

  if (!mongoUri.startsWith('mongodb://') && !mongoUri.startsWith('mongodb+srv://')) {
    throw new Error('MONGO_URI must start with mongodb:// or mongodb+srv://.');
  }

  try {
    await mongoose.connect(mongoUri, {
      authSource: 'admin',
      serverSelectionTimeoutMS: 10000,
    });
    console.log('MongoDB Connected Successfully');
  } catch (error) {
    if (error.message.includes('bad auth') || error.message.includes('authentication failed')) {
      console.error(
        'MongoDB authentication failed. Check the Atlas database username, password, cluster host, and URL-encode special password characters.'
      );
    } else {
      console.error('Database connection failed:', error.message);
    }
    throw error;
  }
};

export default connectDB;