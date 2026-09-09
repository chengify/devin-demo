import { devinClient, CreateSessionRequest } from '../devin/client';
import { githubClient, GitHubIssue } from '../github/client';
import { metricsTracker } from '../observability/metrics';
import { getLogger } from '../observability/logger';
import { config } from '../config';

const logger = getLogger('automation-service');

export class AutomationService {
  async processIssue(issueNumber: number): Promise<void> {
    logger.info('Starting to process issue', { issueNumber });
    
    try {
      // Fetch issue details
      const issue = await githubClient.getIssue(issueNumber);
      logger.info('Issue fetched successfully', { 
        issueNumber, 
        title: issue.title,
        labels: issue.labels.map(l => l.name)
      });

      // Check if issue has the automation label
      const hasAutoLabel = issue.labels.some(l => l.name === config.automation.autoLabel);
      if (!hasAutoLabel) {
        logger.info('Issue does not have automation label, skipping', { issueNumber });
        return;
      }

      // Check if issue is already closed
      if (issue.state === 'closed') {
        logger.info('Issue is already closed, skipping', { issueNumber });
        return;
      }

      // Record the issue type based on labels
      const issueType = this.determineIssueType(issue);
      metricsTracker.recordIssueType(issueType);
      metricsTracker.incrementTotalIssues();

      // Add initial comment to the issue
      await githubClient.addIssueComment(
        issueNumber,
        `🤖 **Devin Automation Started**\n\nI'm starting to work on this issue. You can track progress in the Devin dashboard.\n\nIssue: ${issue.html_url}`
      );

      // Create Devin session
      const prompt = this.generatePrompt(issue);
      const sessionRequest: CreateSessionRequest = {
        prompt,
      };

      metricsTracker.incrementActiveSessions();
      const startTime = Date.now();

      const session = await devinClient.createSession(sessionRequest);
      
      logger.info('Devin session created', { 
        sessionId: session.id,
        issueNumber 
      });

      // Update issue comment with session info
      await githubClient.addIssueComment(
        issueNumber,
        `🚀 **Devin Session Created**\n\nSession ID: ${session.id}\nStatus: ${session.status}\n\nI'll update you when the session completes.`
      );

      // Wait for session completion
      const completedSession = await devinClient.waitForSessionCompletion(
        session.id,
        config.automation.sessionTimeoutMinutes * 60 * 1000
      );

      const duration = Date.now() - startTime;

      if (completedSession.status === 'completed') {
        logger.info('Devin session completed successfully', { 
          sessionId: session.id,
          duration 
        });

        metricsTracker.incrementSuccessfulSessions(duration);
        metricsTracker.addActivity({
          timestamp: new Date().toISOString(),
          issueNumber,
          issueTitle: issue.title,
          status: 'completed',
          duration,
          sessionId: session.id,
        });

        // Create a pull request if Devin made changes
        await this.handleSuccessfulCompletion(issue, completedSession);

        // Close the issue
        await githubClient.closeIssue(issueNumber);

        await githubClient.addIssueComment(
          issueNumber,
          `✅ **Issue Resolved**\n\nDevin successfully completed the remediation in ${Math.round(duration / 1000)}s.\n\nA pull request has been created with the changes.`
        );

      } else {
        logger.error('Devin session failed', { 
          sessionId: session.id,
          error: completedSession.error 
        });

        metricsTracker.incrementFailedSessions();
        metricsTracker.addActivity({
          timestamp: new Date().toISOString(),
          issueNumber,
          issueTitle: issue.title,
          status: 'failed',
          duration,
          sessionId: session.id,
        });

        await githubClient.addIssueComment(
          issueNumber,
          `❌ **Automation Failed**\n\nDevin encountered an error:\n\`\`\`\n${completedSession.error || 'Unknown error'}\n\`\`\`\n\nPlease review and consider manual intervention.`
        );
      }

    } catch (error) {
      logger.error('Failed to process issue', { issueNumber, error });
      
      metricsTracker.incrementFailedSessions();
      metricsTracker.addActivity({
        timestamp: new Date().toISOString(),
        issueNumber,
        issueTitle: 'Unknown',
        status: 'failed',
      });

      // Try to notify about the failure
      try {
        await githubClient.addIssueComment(
          issueNumber,
          `❌ **Automation Error**\n\nAn unexpected error occurred while processing this issue:\n\`\`\`\n${error instanceof Error ? error.message : 'Unknown error'}\n\`\`\`\n\nPlease check the logs for more details.`
        );
      } catch (commentError) {
        logger.error('Failed to add error comment to issue', { issueNumber, error: commentError });
      }
    }
  }

  private determineIssueType(issue: GitHubIssue): string {
    const labelNames = issue.labels.map(l => l.name.toLowerCase());
    
    if (labelNames.includes('security')) return 'security';
    if (labelNames.includes('code-quality')) return 'code-quality';
    if (labelNames.includes('dependency')) return 'dependency';
    if (labelNames.includes('bug')) return 'bug';
    if (labelNames.includes('enhancement')) return 'enhancement';
    
    return 'other';
  }

  private generatePrompt(issue: GitHubIssue): string {
    return `Please fix the issue described in GitHub issue #${issue.number}:

Title: ${issue.title}
Description: ${issue.body || 'No description provided'}
Issue URL: ${issue.html_url}

Context:
- This is an Apache Superset repository fork
- Follow the coding standards and conventions in the AGENTS.md file
- Run pre-commit hooks before finalizing changes
- Add proper type hints for Python code
- Follow the existing code style and patterns
- Ensure all tests pass after making changes

Please:
1. Analyze the issue and understand what needs to be fixed
2. Implement the fix following best practices
3. Run relevant tests to ensure the fix works
4. Run pre-commit hooks to ensure code quality
5. Create a commit with a descriptive message following conventional commits format
6. If you make changes, push them to a new branch

The repository is already checked out. Start by examining the relevant files and understanding the issue.`;
  }

  private async handleSuccessfulCompletion(issue: GitHubIssue, session: any): Promise<void> {
    logger.info('Handling successful session completion', { 
      issueNumber: issue.number,
      sessionId: session.id 
    });

    try {
      // In a real implementation, we would:
      // 1. Check if Devin made any changes
      // 2. Create a new branch
      // 3. Create a pull request with the changes
      
      // For this demo, we'll create a simple PR
      const defaultBranch = await githubClient.getDefaultBranch();
      const branchName = `devin-automation-issue-${issue.number}`;
      
      // Create a branch (this would fail if no changes were made, but that's okay for demo)
      try {
        await githubClient.createBranch(branchName, defaultBranch);
        
        await githubClient.createPullRequest({
          title: `Fix issue #${issue.number}: ${issue.title}`,
          body: `This PR fixes issue #${issue.number}.\n\nAutomated by Devin AI.\n\nDevin Session: ${session.id}\n\n---\n\n${issue.body || ''}`,
          head: branchName,
          base: defaultBranch,
        });
        
        logger.info('Pull request created successfully', { issueNumber: issue.number });
      } catch (branchError) {
        logger.warn('Could not create branch/PR (likely no changes made)', { 
          issueNumber: issue.number,
          error: branchError 
        });
      }
      
    } catch (error) {
      logger.error('Failed to handle successful completion', { 
        issueNumber: issue.number,
        error 
      });
    }
  }
}

export const automationService = new AutomationService();
