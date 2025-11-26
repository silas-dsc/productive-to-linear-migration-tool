import 'dotenv/config';
import { getJiraClient, testJiraAuth } from '../server/jira-client';

async function run() {
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;
  const jiraBaseUrl = process.env.JIRA_BASE_URL;

  if (!jiraEmail || !jiraApiToken) {
    console.error('Please set JIRA_EMAIL and JIRA_API_TOKEN in your environment (.env)');
    process.exit(2);
  }

  try {
    const client = await getJiraClient(jiraEmail, jiraApiToken, jiraBaseUrl);
    const result = await testJiraAuth(client);
    if (result.authenticated) {
      console.log('Jira authentication successful:', result.user);
      process.exit(0);
    } else {
      console.error('Jira authentication failed:', result.error);
      process.exit(3);
    }
  } catch (err: any) {
    console.error('Jira authentication error:', err?.message || err);
    process.exit(4);
  }
}

run();
