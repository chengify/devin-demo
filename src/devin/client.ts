import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import { getLogger } from '../observability/logger';

const logger = getLogger('devin-client');

export interface DevinSession {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  prompt: string;
  created_at: string;
  updated_at: string;
  result?: any;
  error?: string;
}

export interface CreateSessionRequest {
  prompt: string;
  create_as_user_id?: string;
  knowledge_base_ids?: string[];
  playbook_id?: string;
}

export class DevinClient {
  private client: AxiosInstance;
  private orgId: string;

  constructor() {
    this.orgId = config.devin.orgId;
    
    this.client = axios.create({
      baseURL: config.devin.apiBaseUrl,
      headers: {
        'Authorization': `Bearer ${config.devin.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout for API calls
    });

    // Add request/response logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Devin API request', { 
          method: config.method, 
          url: config.url,
          headers: { ...config.headers, Authorization: '***REDACTED***' }
        });
        return config;
      },
      (error) => {
        logger.error('Devin API request error', { error });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug('Devin API response', { 
          status: response.status,
          url: response.config.url 
        });
        return response;
      },
      (error) => {
        logger.error('Devin API response error', { 
          status: error.response?.status,
          url: error.config?.url,
          data: error.response?.data 
        });
        return Promise.reject(error);
      }
    );
  }

  async createSession(request: CreateSessionRequest): Promise<DevinSession> {
    try {
      logger.info('Creating Devin session', { prompt: request.prompt.substring(0, 100) });
      
      const response = await this.client.post(
        `/organizations/${this.orgId}/sessions`,
        request
      );

      const session = response.data as DevinSession;
      logger.info('Devin session created successfully', { 
        sessionId: session.id,
        status: session.status 
      });

      return session;
    } catch (error) {
      logger.error('Failed to create Devin session', { error });
      throw new Error(`Failed to create Devin session: ${this.getErrorMessage(error)}`);
    }
  }

  async getSession(sessionId: string): Promise<DevinSession> {
    try {
      const response = await this.client.get(
        `/organizations/${this.orgId}/sessions/${sessionId}`
      );

      return response.data as DevinSession;
    } catch (error) {
      logger.error('Failed to get Devin session', { sessionId, error });
      throw new Error(`Failed to get Devin session: ${this.getErrorMessage(error)}`);
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    try {
      await this.client.post(
        `/organizations/${this.orgId}/sessions/${sessionId}/cancel`
      );
      logger.info('Devin session cancelled', { sessionId });
    } catch (error) {
      logger.error('Failed to cancel Devin session', { sessionId, error });
      throw new Error(`Failed to cancel Devin session: ${this.getErrorMessage(error)}`);
    }
  }

  async waitForSessionCompletion(
    sessionId: string,
    timeoutMs: number = 30 * 60 * 1000, // 30 minutes default
    pollIntervalMs: number = 5000 // 5 seconds
  ): Promise<DevinSession> {
    const startTime = Date.now();
    
    logger.info('Waiting for Devin session completion', { 
      sessionId, 
      timeoutMs,
      pollIntervalMs 
    });

    while (Date.now() - startTime < timeoutMs) {
      try {
        const session = await this.getSession(sessionId);
        
        logger.debug('Session status check', { 
          sessionId, 
          status: session.status 
        });

        if (session.status === 'completed') {
          logger.info('Devin session completed successfully', { sessionId });
          return session;
        }

        if (session.status === 'failed' || session.status === 'cancelled') {
          logger.warn('Devin session ended unsuccessfully', { 
            sessionId, 
            status: session.status,
            error: session.error 
          });
          return session;
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      } catch (error) {
        logger.error('Error during session polling', { sessionId, error });
        // Continue polling on transient errors
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }
    }

    // Timeout reached
    logger.error('Devin session timeout', { sessionId, timeoutMs });
    await this.cancelSession(sessionId);
    throw new Error(`Session ${sessionId} timed out after ${timeoutMs}ms`);
  }

  private getErrorMessage(error: any): string {
    if (axios.isAxiosError(error)) {
      return error.response?.data?.message || error.message || 'Unknown API error';
    }
    return error?.message || 'Unknown error';
  }
}

export const devinClient = new DevinClient();
