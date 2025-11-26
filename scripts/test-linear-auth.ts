import 'dotenv/config';
import { testLinearAuth } from '../server/linear-client';

async function main() {
  const key = process.env.LINEAR_API_KEY || process.env.VITE_LINEAR_API_KEY;
  if (!key) {
    console.error('No LINEAR_API_KEY found in env. Set LINEAR_API_KEY or VITE_LINEAR_API_KEY');
    process.exit(2);
  }

  try {
    const result = await testLinearAuth(key);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.authenticated ? 0 : 1);
  } catch (err: any) {
    console.error('Error testing Linear auth:', err.message || err);
    process.exit(3);
  }
}

main();
