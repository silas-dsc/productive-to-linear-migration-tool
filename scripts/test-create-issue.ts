import 'dotenv/config';
import { createLinearIssue } from '../server/linear-client';

async function testCreateIssue() {
  const key = process.env.LINEAR_API_KEY;
  const teamId = process.env.LINEAR_TEAM_ID;
  if (!key || !teamId) {
    console.error('Missing env vars');
    process.exit(2);
  }

  try {
    const result = await createLinearIssue(key, teamId, 'Test Issue', 'Test description');
    console.log('Created issue:', result);
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}

testCreateIssue();