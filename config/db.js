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
      serverSelectionTimeoutMS: 10000,
    });
    console.log('MongoDB Connected Successfully');
  } catch (error) {
    const errorMessage = error.message.toLowerCase();
    if (error.code === 18 || errorMessage.includes('bad auth') || errorMessage.includes('authentication failed')) {
      console.error(
        'MongoDB authentication failed. Check the database username, password, authentication database (authSource), and cluster host. URL-encode special characters in the username or password.'
      );
    } else {
      console.error('Database connection failed:', error.message);
    }
    throw error;
  }
};

export default connectDB;