import { Version3Client } from 'jira.js';

interface JiraConfig {
  email: string;
  apiToken: string;
  hostName: string;
}

let cachedJiraConfig: JiraConfig | null = null;

export async function getJiraClient(jiraEmail?: string, jiraApiToken?: string, jiraBaseUrl?: string): Promise<Version3Client> {
  const host = jiraBaseUrl || 'https://teamdsc.atlassian.net';
  
  console.log('[Jira Client] Initializing with:', {
    email: jiraEmail ? jiraEmail.substring(0, 5) + '***' : 'undefined',
    apiToken: jiraApiToken ? jiraApiToken.substring(0, 5) + '***' : 'undefined',
    host: host,
  });

  // If we have provided credentials, use those
  if (jiraEmail && jiraApiToken) {
    console.log('[Jira Client] Using provided credentials for basic auth');
    try {
      // Create base64 encoded credentials for basic auth
      const credentials = Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
      console.log('[Jira Client] Base64 credentials prepared (email:apitoken)');
      
      const client = new Version3Client({
        host: host,
        authentication: {
          basic: {
            email: jiraEmail,
            apiToken: jiraApiToken,
          },
        },
      });
      console.log('[Jira Client] Client created successfully with basic auth');
      console.log('[Jira Client] Using host:', host);
      return client;
    } catch (err: any) {
      console.error('[Jira Client] Failed to create client with basic auth:', err.message);
      throw new Error(`Failed to create Jira client: ${err.message}`);
    }
  }

  console.log('[Jira Client] No credentials provided, attempting Replit connector...');

  // Try to use Replit connector if no credentials provided
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (xReplitToken && hostname) {
    try {
      console.log('[Jira Client] Attempting to fetch Replit connector...');
      const response = await fetch(
        'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=jira',
        {
          headers: {
            'Accept': 'application/json',
            'X_REPLIT_TOKEN': xReplitToken
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        const connection = data.items?.[0];
        if (connection?.settings?.oauth?.credentials?.access_token) {
          console.log('[Jira Client] Using Replit connector OAuth');
          return new Version3Client({
            host: connection.settings.site_url,
            authentication: {
              oauth2: { accessToken: connection.settings.oauth.credentials.access_token },
            },
          });
        }
      }
    } catch (err) {
      console.error('[Jira Client] Failed to use Replit connector:', err);
    }
  }

  console.error('[Jira Client] No valid authentication method available');
  throw new Error('Jira authentication failed: Please provide email, API token, and Jira base URL');
}

export async function createJiraIssue(
  client: Version3Client,
  projectKey: string,
  task: any
): Promise<{ key: string | null; error?: string }> {
  const issueInput = {
    fields: {
      project: { key: projectKey },
      summary: task.attributes?.title || 'Untitled',
      description: task.attributes?.description || '',
      issuetype: { name: 'Task' },
    },
  };

  try {
    console.log('[Jira] Creating issue with input:', JSON.stringify(issueInput, null, 2));
    const response = await client.issues.createIssue(issueInput);
    return { key: response.key };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errorMessages?.[0] || err.message || 'Unknown error';
    const status = err.response?.status || err.status || 'unknown';
    const responseData = err.response?.data || err.data || null;
    
    console.error('[Jira] Failed to create issue:', {
      statusCode: status,
      errorMessage: errorMsg,
      fullResponse: responseData,
      errorStack: err.stack,
    });

    // Log a curl command to help with debugging
    const curlEmail = (client as any).authentication?.basic?.email || 'your_email@example.com';
    const curlToken = (client as any).authentication?.basic?.apiToken || 'YOUR_API_TOKEN_HERE';
    const curlBasicAuth = Buffer.from(`${curlEmail}:${curlToken}`).toString('base64');
    const host = (client as any).host || 'https://your-domain.atlassian.net';

    const curlCommand = `curl -X POST \\
  "${host}/rest/api/3/issues" \\
  -H "Authorization: Basic ${curlBasicAuth}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(issueInput)}'`;

    console.error('[Jira] Try this curl command to debug locally:');
    console.error(curlCommand);

    return { key: null, error: errorMsg };
  }
}

export async function testJiraAuth(client: Version3Client): Promise<{ authenticated: boolean; user?: any; error?: string }> {
  try {
    console.log('[Jira] Testing authentication by calling GET /rest/api/3/myself');
    // Use a generic request to call the API directly (method name differs between versions of jira.js)
    const response = await (client as any).requestJira({
      method: 'GET',
      url: '/rest/api/3/myself',
    });
    console.log('[Jira] Authentication successful! Current user:', response);
    return { 
      authenticated: true, 
      user: {
        name: (response as any).name,
        emailAddress: (response as any).emailAddress,
        displayName: (response as any).displayName,
      }
    };
  } catch (err: any) {
    const status = err.response?.status || err.status || 'unknown';
    const responseData = err.response?.data || err.data || null;
    
    console.error('[Jira] Authentication test failed:', {
      statusCode: status,
      errorMessage: err.message,
      fullResponse: responseData,
      errorStack: err.stack,
    });

    // Log curl command for debugging
    const curlEmail = (client as any).authentication?.basic?.email || 'your_email@example.com';
    const curlToken = (client as any).authentication?.basic?.apiToken || 'YOUR_API_TOKEN_HERE';
    const curlBasicAuth = Buffer.from(`${curlEmail}:${curlToken}`).toString('base64');
    const host = (client as any).host || 'https://your-domain.atlassian.net';

    const curlCommand = `curl -X GET \\
  "${host}/rest/api/3/myself" \\
  -H "Authorization: Basic ${curlBasicAuth}" \\
  -H "Accept: application/json"`;

    console.error('[Jira] Try this curl command to test auth locally:');
    console.error(curlCommand);

    return { 
      authenticated: false, 
      error: err.message 
    };
  }
}

export async function addCommentToJiraIssue(
  client: Version3Client,
  issueKey: string,
  commentText: string
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log('[Jira] Adding comment to issue:', issueKey);
    await client.issueComments.addComment({
      issueIdOrKey: issueKey,
      body: commentText,
    });
    return { success: true };
  } catch (err: any) {
    const errorMsg = err.response?.data?.errorMessages?.[0] || err.message || 'Unknown error';
    const status = err.response?.status || err.status || 'unknown';
    const responseData = err.response?.data || err.data || null;
    
    console.error('[Jira] Failed to add comment:', {
      statusCode: status,
      issueKey: issueKey,
      errorMessage: errorMsg,
      fullResponse: responseData,
      errorStack: err.stack,
    });

    // Log a curl command to help with debugging
    const curlEmail = (client as any).authentication?.basic?.email || 'your_email@example.com';
    const curlToken = (client as any).authentication?.basic?.apiToken || 'YOUR_API_TOKEN_HERE';
    const curlBasicAuth = Buffer.from(`${curlEmail}:${curlToken}`).toString('base64');
    const host = (client as any).host || 'https://your-domain.atlassian.net';

    const curlCommand = `curl -X POST \\
  "${host}/rest/api/3/issues/${issueKey}/comments" \\
  -H "Authorization: Basic ${curlBasicAuth}" \\
  -H "Content-Type: application/json" \\
  -d '{"body": "${commentText.replace(/"/g, '\\"')}"}'`;

    console.error('[Jira] Try this curl command to debug locally:');
    console.error(curlCommand);

    return { success: false, error: errorMsg };
  }
}
