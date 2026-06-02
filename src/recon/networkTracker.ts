import type { Page, Request } from '@playwright/test';
import type { NetworkRequestLog } from '../types';

export class NetworkTracker {
  private page: Page;
  private requestStartTimes = new Map<Request, number>();
  private failedRequests: NetworkRequestLog[] = [];

  constructor(page: Page) {
    this.page = page;
    this.setupListeners();
  }

  private setupListeners() {
    this.page.on('request', (request) => {
      this.requestStartTimes.set(request, Date.now());
    });

    this.page.on('response', async (response) => {
      const request = response.request();
      const startTime = this.requestStartTimes.get(request);
      const durationMs = startTime ? Date.now() - startTime : 0;
      this.requestStartTimes.delete(request);

      const status = response.status();
      const url = response.url();
      const method = request.method();
      const headers = response.headers();

      let isGraphQLError = false;
      let graphQLErrors: any[] | undefined = undefined;

      const contentType = headers['content-type'] || '';
      // Only inspect response body for JSON payloads to check for GraphQL errors
      if (status >= 200 && status < 300 && contentType.includes('application/json')) {
        try {
          const text = await response.text();
          const json = JSON.parse(text);
          if (json && Array.isArray(json.errors)) {
            isGraphQLError = true;
            graphQLErrors = json.errors;
          }
        } catch {
          // ignore parsing errors
        }
      }

      if (status >= 400 || isGraphQLError) {
        this.failedRequests.push({
          url,
          method,
          status,
          headers,
          durationMs,
          isGraphQLError,
          graphQLErrors
        });
      }
    });
  }

  public getAndClearFailedRequests(): NetworkRequestLog[] {
    const current = [...this.failedRequests];
    this.failedRequests = [];
    return current;
  }
}
