import 'dotenv/config';
import { graphqlRequest } from '../server/linear-client';

async function getTeams() {
  const key = process.env.LINEAR_API_KEY || process.env.VITE_LINEAR_API_KEY;
  if (!key) {
    console.error('No LINEAR_API_KEY found in env.');
    process.exit(2);
  }

  try {
    const query = `query { teams { nodes { id name key } } }`;
    const data = await graphqlRequest(key, query);
    console.log('Available teams:');
    console.log(JSON.stringify(data.teams.nodes, null, 2));
  } catch (err: any) {
    console.error('Error fetching teams:', err.message || err);
    process.exit(3);
  }
}

getTeams();