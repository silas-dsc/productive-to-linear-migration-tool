const LINEAR_GRAPHQL = 'https://api.linear.app/graphql';

export async function graphqlRequest(apiKey: string, query: string, variables?: any, retryCount = 0) {
  const res = await fetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  // Check for rate limit errors
  if (json.errors && json.errors.length) {
    const rateLimitError = json.errors.find((e: any) =>
      e.extensions?.code === 'RATELIMITED' ||
      e.message?.includes('Rate limit exceeded') ||
      res.status === 429
    );

    if (rateLimitError && retryCount < 1) { // Only retry once for rate limits
      // Try to get reset time from header first, then fall back to error info
      const headerResetTime = res.headers.get('X-RateLimit-Requests-Reset');
      let resetDuration: number;

      if (headerResetTime) {
        // Header gives reset time in UTC epoch milliseconds
        const resetTimeMs = parseInt(headerResetTime, 10);
        const nowMs = Date.now();
        resetDuration = Math.max(0, resetTimeMs - nowMs);
      } else {
        // Fall back to duration from error response
        const rateLimitInfo = rateLimitError.extensions?.meta?.rateLimitResult;
        resetDuration = rateLimitInfo?.duration || 60000 * 3; // Default to 3 minutes
      }

      const resetMinutes = Math.ceil(resetDuration / 60000);
      console.log(`[Linear API] Rate limit exceeded. Waiting ${resetMinutes} minutes (${Math.ceil(resetDuration / 1000)} seconds) before retry...`);
      await new Promise(resolve => setTimeout(resolve, resetDuration));

      // Retry the request after waiting
      return graphqlRequest(apiKey, query, variables, retryCount + 1);
    }

    const errorDetails = json.errors.map((e: any) => `${e.message}${e.path ? ` (path: ${e.path.join('.')})` : ''}${e.extensions ? ` [${JSON.stringify(e.extensions)}]` : ''}`).join('; ');
    throw new Error(`GraphQL errors: ${errorDetails}`);
  }

  return json.data;
}

export async function batchGraphQLOperations(apiKey: string, operations: Array<{ alias: string; mutation: string; variables: any }>) {
  // Combine multiple GraphQL operations into a single mutation using aliases
  if (operations.length === 0) return {};
  if (operations.length === 1) {
    const op = operations[0];
    const data = await graphqlRequest(apiKey, `mutation { ${op.alias}: ${op.mutation} }`, op.variables);
    return { [op.alias]: data[op.alias] };
  }

  // Build combined mutation with proper variable handling
  const mutationParts: string[] = [];
  const allVariables: any = {};
  const variableDefinitions: string[] = [];

  operations.forEach((op, index) => {
    // For each operation, rename its variables to avoid conflicts
    let operationMutation = op.alias + ': ' + op.mutation;
    const operationVariables: any = {};

    if (op.variables) {
      Object.entries(op.variables).forEach(([key, value]) => {
        const uniqueKey = `${op.alias}_${key}`;
        // Replace variable references in the mutation
        operationMutation = operationMutation.replace(new RegExp(`\\$${key}\\b`, 'g'), `$${uniqueKey}`);
        operationVariables[uniqueKey] = value;

        // Add to variable definitions (we'll infer types as String! for required params)
        if (!variableDefinitions.includes(`$${uniqueKey}: String!`)) {
          variableDefinitions.push(`$${uniqueKey}: String!`);
        }
      });
    }

    mutationParts.push(operationMutation);
    Object.assign(allVariables, operationVariables);
  });

  const variableDefsStr = variableDefinitions.length > 0 ? `(${variableDefinitions.join(', ')})` : '';
  const mutation = `mutation${variableDefsStr} {
    ${mutationParts.join('\n    ')}
  }`;

  try {
    const data = await graphqlRequest(apiKey, mutation, allVariables);
    return data;
  } catch (err: any) {
    // If batching fails, fall back to individual calls
    console.warn('[Linear API] Batch operations failed, falling back to individual calls:', err.message);
    const results: any = {};
    for (const op of operations) {
      try {
        const data = await graphqlRequest(apiKey, `mutation { ${op.alias}: ${op.mutation} }`, op.variables);
        results[op.alias] = data[op.alias];
      } catch (opErr: any) {
        console.error(`[Linear API] Individual operation ${op.alias} failed:`, opErr.message);
        results[op.alias] = null;
      }
    }
    return results;
  }
}

export async function testLinearAuth(apiKey: string) {
  if (!apiKey) return { authenticated: false, error: 'No API key provided' };
  try {
    const query = `query { viewer { id name email } }`;
    const data = await graphqlRequest(apiKey, query);
    return { authenticated: true, user: data.viewer };
  } catch (err: any) {
    return { authenticated: false, error: err.message };
  }
}

export async function createLinearIssue(apiKey: string, teamId: string, title: string, description: string, stateId?: string) {
  const mutation = `mutation IssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) {
      success
      issue { id identifier url }
    }
  }`;

  const variables = { input: { teamId, title, description, ...(stateId && { stateId }) } };
  const data = await graphqlRequest(apiKey, mutation, variables);
  return data.issueCreate?.issue || null;
}

export async function findIssueByTaskUrl(apiKey: string, teamId: string, taskUrl: string) {
  const query = `query Issues($filter: IssueFilter!) {
    issues(filter: $filter) {
      nodes {
        id
        identifier
        title
        description
      }
    }
  }`;

  const variables = { filter: { team: { id: { eq: teamId } }, description: { contains: taskUrl } } };
  const data = await graphqlRequest(apiKey, query, variables);
  const issues = data.issues?.nodes || [];
  return issues.length > 0 ? issues[0] : null; // Return the first match if any
}

export async function deleteIssue(apiKey: string, issueId: string) {
  const mutation = `mutation IssueDelete($issueId: String!) {
    issueDelete(id: $issueId) {
      success
    }
  }`;

  const variables = { issueId };
  const data = await graphqlRequest(apiKey, mutation, variables);
  return data.issueDelete?.success === true;
}

export async function updateIssue(apiKey: string, issueId: string, title?: string, description?: string) {
  const mutation = `mutation IssueUpdate($input: IssueUpdateInput!) {
    issueUpdate(id: $issueId, input: $input) {
      success
      issue { id identifier }
    }
  }`;

  const variables = { issueId, input: { ...(title && { title }), ...(description && { description }) } };
  const data = await graphqlRequest(apiKey, mutation, variables);
  return data.issueUpdate?.issue || null;
}

export async function getTeamStates(apiKey: string, teamId: string) {
  const query = `query TeamStates($teamId: String!) {
    team(id: $teamId) {
      states {
        nodes {
          id
          name
          type
          color
        }
      }
    }
  }`;

  const variables = { teamId };
  const data = await graphqlRequest(apiKey, query, variables);
  return data.team?.states?.nodes || [];
}

export async function archiveIssue(apiKey: string, issueId: string) {
  const mutation = `mutation IssueArchive($issueId: String!) {
    issueArchive(id: $issueId) {
      success
    }
  }`;

  const variables = { issueId };
  const data = await graphqlRequest(apiKey, mutation, variables);
  return data.issueArchive?.success === true;
}

export async function archiveIssues(apiKey: string, issueIds: string[]) {
  // Batch multiple archive operations into a single GraphQL mutation
  if (issueIds.length === 0) return [];
  if (issueIds.length === 1) {
    const success = await archiveIssue(apiKey, issueIds[0]);
    return [success];
  }

  const operations = issueIds.map((issueId, index) => ({
    alias: `archive${index}`,
    mutation: `issueArchive(id: $issueId) {
      success
    }`,
    variables: { issueId }
  }));

  try {
    const data = await batchGraphQLOperations(apiKey, operations);
    return issueIds.map((_, index) => {
      const alias = `archive${index}`;
      return data[alias]?.success === true;
    });
  } catch (err: any) {
    // If batching fails, fall back to individual calls
    console.warn('[Linear API] Batch archiving failed, falling back to individual calls:', err.message);
    const results = [];
    for (const issueId of issueIds) {
      try {
        const success = await archiveIssue(apiKey, issueId);
        results.push(success);
      } catch (archiveErr: any) {
        console.error(`[Linear API] Failed to archive issue ${issueId}:`, archiveErr.message);
        results.push(false);
      }
    }
    return results;
  }
}

export async function addCommentToIssue(apiKey: string, issueId: string, body: string) {
  // Linear supports generic commentCreate; we use issueId
  const mutation = `mutation CommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) {
      success
      comment { id }
    }
  }`;

  const variables = { input: { issueId, body } };
  const data = await graphqlRequest(apiKey, mutation, variables);
  return data.commentCreate?.success === true;
}

export async function addCommentsToIssue(apiKey: string, issueId: string, commentBodies: string[]) {
  // Batch multiple comments into a single GraphQL mutation using aliases
  if (commentBodies.length === 0) return true;
  if (commentBodies.length === 1) {
    return addCommentToIssue(apiKey, issueId, commentBodies[0]);
  }

  // Build a mutation with multiple commentCreate operations
  const mutationParts: string[] = [];
  const variables: any = {};

  commentBodies.forEach((body, index) => {
    const alias = `comment${index}`;
    mutationParts.push(`${alias}: commentCreate(input: $${alias}Input) {
      success
      comment { id }
    }`);
    variables[`${alias}Input`] = { issueId, body };
  });

  const mutation = `mutation AddComments(${commentBodies.map((_, i) => `$${`comment${i}Input`}: CommentCreateInput!`).join(', ')}) {
    ${mutationParts.join('\n    ')}
  }`;

  try {
    const data = await graphqlRequest(apiKey, mutation, variables);
    // Check if all comments were created successfully
    return commentBodies.every((_, index) => {
      const alias = `comment${index}`;
      return data[alias]?.success === true;
    });
  } catch (err: any) {
    // If batching fails, fall back to individual calls
    console.warn('[Linear API] Batch comment creation failed, falling back to individual calls:', err.message);
    for (const body of commentBodies) {
      try {
        await addCommentToIssue(apiKey, issueId, body);
      } catch (commentErr: any) {
        console.error('[Linear API] Failed to add individual comment:', commentErr.message);
      }
    }
    return false; // Some comments may have failed
  }
}

export async function addAttachmentLinkAsComment(apiKey: string, issueId: string, url: string, filename?: string) {
  // Clean up any markdown formatting from the URL
  const cleanUrl = url.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\]\([^)]+\)/g, '');
  const displayName = filename && filename !== cleanUrl ? filename : '';
  const body = displayName ? `Attachment: ${displayName} - ${cleanUrl}` : `Attachment: ${cleanUrl}`;
  return addCommentToIssue(apiKey, issueId, body);
}

export async function createAttachment(apiKey: string, issueId: string, url: string, name?: string) {
  // Try to create an attachment record in Linear. If the server doesn't
  // support direct attachment creation via URL, this will throw and the
  // caller should fallback to posting the link as a comment.
  try {
    const mutation = `mutation AttachmentCreate($input: AttachmentCreateInput!) {
      attachmentCreate(input: $input) {
        success
        attachment { id }
      }
    }`;

    const variables = { input: { issueId, url, name } };
    const data = await graphqlRequest(apiKey, mutation, variables);
    return data.attachmentCreate?.attachment || null;
  } catch (err: any) {
    throw err;
  }
}

export async function createAttachmentFromBuffer(apiKey: string, issueId: string, buffer: Buffer | ArrayBuffer | Uint8Array, filename: string, contentType?: string) {
  // Use multipart GraphQL upload (graphql-multipart-request-spec)
  // Build operations and map fields
  const mutation = `mutation AttachmentCreate($input: AttachmentCreateInput!, $file: Upload!) {
    attachmentCreate(input: $input, file: $file) {
      success
      attachment { id }
    }
  }`;

  const operations = JSON.stringify({ query: mutation, variables: { input: { issueId, name: filename }, file: null } });
  const map = JSON.stringify({ '0': ['variables.file'] });

  const form = new FormData();
  form.append('operations', operations);
  form.append('map', map);

  // Node's FormData/Blob support: convert buffer to Blob
  let blob: any;
  try {
    blob = new Blob([buffer], { type: contentType || 'application/octet-stream' });
  } catch (e) {
    // Fallback for environments without global Blob
    blob = buffer as any;
  }

  form.append('0', blob, filename);

  const res = await fetch(LINEAR_GRAPHQL, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'apollo-require-preflight': 'true',
    } as any,
    body: form as any,
  });

  const json = await res.json();
  if (json.errors && json.errors.length) {
    const errorDetails = json.errors.map((e: any) => `${e.message}${e.path ? ` (path: ${e.path.join('.')})` : ''}${e.extensions ? ` [${JSON.stringify(e.extensions)}]` : ''}`).join('; ');
    throw new Error(`GraphQL errors: ${errorDetails}`);
  }

  return json.data?.attachmentCreate?.attachment || null;
}

export default { testLinearAuth, createLinearIssue, addCommentToIssue, addAttachmentLinkAsComment };
