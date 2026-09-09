import { Request, Response } from 'express';
import { githubClient } from '../github/client';
import { automationService } from '../automation/service';
import { getLogger } from '../observability/logger';

const logger = getLogger('webhook-handler');

export interface GitHubWebhookEvent {
  action?: string;
  issue?: {
    number: number;
    title: string;
    body?: string;
    state: 'open' | 'closed';
    labels: Array<{ name: string }>;
    user: {
      login: string;
    };
    html_url: string;
  };
  repository?: {
    name: string;
    owner: {
      login: string;
    };
  };
  sender?: {
    login: string;
  };
}

export class WebhookHandler {
  async handleIssueEvent(req: Request, res: Response): Promise<void> {
    const signature = req.headers['x-hub-signature-256'] as string;
    const payload = JSON.stringify(req.body);

    // Verify webhook signature
    if (!githubClient.verifyWebhookSignature(payload, signature)) {
      logger.warn('Invalid webhook signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    const event = req.body as GitHubWebhookEvent;
    logger.info('Received GitHub webhook event', { 
      action: event.action,
      issueNumber: event.issue?.number 
    });

    // Check if this is an issue opened event
    if (event.action === 'opened' && event.issue) {
      // Process the issue asynchronously
      this.processIssueAsync(event.issue.number);
      
      res.status(202).json({ 
        message: 'Issue accepted for processing',
        issueNumber: event.issue.number 
      });
      return;
    }

    // Check if this is an issue labeled event
    if (event.action === 'labeled' && event.issue) {
      // Check if the automation label was added
      const hasAutoLabel = event.issue.labels.some(l => l.name === 'devin-automation');
      if (hasAutoLabel) {
        logger.info('Automation label added to issue', { 
          issueNumber: event.issue.number 
        });
        this.processIssueAsync(event.issue.number);
      }
      
      res.status(202).json({ 
        message: 'Label event processed',
        issueNumber: event.issue.number 
      });
      return;
    }

    logger.info('Ignoring webhook event', { action: event.action });
    res.status(200).json({ message: 'Event ignored' });
  }

  private processIssueAsync(issueNumber: number): void {
    // Process the issue in the background
    setImmediate(async () => {
      try {
        await automationService.processIssue(issueNumber);
      } catch (error) {
        logger.error('Error in async issue processing', { 
          issueNumber, 
          error 
        });
      }
    });
  }

  async handlePingEvent(_req: Request, res: Response): Promise<void> {
    logger.info('Received GitHub ping event');
    res.status(200).json({ message: 'Pong' });
  }
}

export const webhookHandler = new WebhookHandler();
