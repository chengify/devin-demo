import { Octokit } from 'octokit';
import * as crypto from 'crypto';
import { config } from '../config';
import { getLogger } from '../observability/logger';

const logger = getLogger('github-client');

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: Array<{ name: string }>;
  user: {
    login: string;
  };
  html_url: string;
  repository_url: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  body: string;
  html_url: string;
  state: 'open' | 'closed';
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

export interface CreatePullRequestOptions {
  title: string;
  body: string;
  head: string;
  base: string;
}

export class GitHubClient {
  private octokit: Octokit;
  private owner: string;
  private repo: string;

  constructor() {
    this.octokit = new Octokit({
      auth: config.github.token,
    });

    this.owner = config.github.repoOwner;
    this.repo = config.github.repoName;
  }

  async getIssue(issueNumber: number): Promise<GitHubIssue> {
    try {
      logger.debug('Fetching GitHub issue', { issueNumber });
      
      const response = await this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });

      return response.data as GitHubIssue;
    } catch (error) {
      logger.error('Failed to fetch GitHub issue', { issueNumber, error });
      throw new Error(`Failed to fetch issue #${issueNumber}: ${this.getErrorMessage(error)}`);
    }
  }

  async addIssueComment(issueNumber: number, body: string): Promise<void> {
    try {
      logger.info('Adding comment to GitHub issue', { issueNumber });
      
      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body,
      });

      logger.info('Comment added successfully', { issueNumber });
    } catch (error) {
      logger.error('Failed to add comment to issue', { issueNumber, error });
      throw new Error(`Failed to add comment to issue #${issueNumber}: ${this.getErrorMessage(error)}`);
    }
  }

  async updateIssueLabels(issueNumber: number, labels: string[]): Promise<void> {
    try {
      logger.info('Updating GitHub issue labels', { issueNumber, labels });
      
      await this.octokit.rest.issues.setLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels,
      });

      logger.info('Labels updated successfully', { issueNumber, labels });
    } catch (error) {
      logger.error('Failed to update issue labels', { issueNumber, labels, error });
      throw new Error(`Failed to update labels for issue #${issueNumber}: ${this.getErrorMessage(error)}`);
    }
  }

  async closeIssue(issueNumber: number): Promise<void> {
    try {
      logger.info('Closing GitHub issue', { issueNumber });
      
      await this.octokit.rest.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        state: 'closed',
      });

      logger.info('Issue closed successfully', { issueNumber });
    } catch (error) {
      logger.error('Failed to close issue', { issueNumber, error });
      throw new Error(`Failed to close issue #${issueNumber}: ${this.getErrorMessage(error)}`);
    }
  }

  async createPullRequest(options: CreatePullRequestOptions): Promise<GitHubPullRequest> {
    try {
      logger.info('Creating GitHub pull request', { 
        title: options.title,
        head: options.head,
        base: options.base 
      });
      
      const response = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base,
      });

      const pr = response.data as GitHubPullRequest;
      logger.info('Pull request created successfully', { 
        prNumber: pr.number,
        url: pr.html_url 
      });

      return pr;
    } catch (error) {
      logger.error('Failed to create pull request', { options, error });
      throw new Error(`Failed to create pull request: ${this.getErrorMessage(error)}`);
    }
  }

  async createBranch(branchName: string, baseBranch: string = 'main'): Promise<string> {
    try {
      logger.info('Creating GitHub branch', { branchName, baseBranch });
      
      // Get the SHA of the base branch
      const baseRef = await this.octokit.rest.git.getRef({
        owner: this.owner,
        repo: this.repo,
        ref: `heads/${baseBranch}`,
      });

      const sha = baseRef.data.object.sha;

      // Create the new branch
      await this.octokit.rest.git.createRef({
        owner: this.owner,
        repo: this.repo,
        ref: `refs/heads/${branchName}`,
        sha,
      });

      logger.info('Branch created successfully', { branchName });
      return branchName;
    } catch (error) {
      logger.error('Failed to create branch', { branchName, baseBranch, error });
      throw new Error(`Failed to create branch ${branchName}: ${this.getErrorMessage(error)}`);
    }
  }

  async getDefaultBranch(): Promise<string> {
    try {
      const response = await this.octokit.rest.repos.get({
        owner: this.owner,
        repo: this.repo,
      });

      return response.data.default_branch;
    } catch (error) {
      logger.error('Failed to get default branch', { error });
      throw new Error(`Failed to get default branch: ${this.getErrorMessage(error)}`);
    }
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    const hmac = crypto.createHmac('sha256', config.github.webhookSecret);
    const digest = hmac.update(payload).digest('hex');
    const expectedSignature = `sha256=${digest}`;
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  private getErrorMessage(error: any): string {
    if (error?.response?.data?.message) {
      return error.response.data.message;
    }
    if (error?.message) {
      return error.message;
    }
    return 'Unknown error';
  }
}

export const githubClient = new GitHubClient();
