import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { NetworkTracker } from '../../../src/recon/networkTracker';
import type { Page, Request, Response } from '@playwright/test';

describe('NetworkTracker', () => {
  it('tracks failed API requests and detects GraphQL errors', async () => {
    let requestCallback: any = null;
    let responseCallback: any = null;

    const mockPage = {
      on: (event: string, callback: any) => {
        if (event === 'request') {
          requestCallback = callback;
        } else if (event === 'response') {
          responseCallback = callback;
        }
      }
    } as unknown as Page;

    const tracker = new NetworkTracker(mockPage);

    assert.ok(requestCallback);
    assert.ok(responseCallback);

    // 1. Simulate a successful non-JSON request
    const mockRequest1 = {
      method: () => 'GET'
    } as unknown as Request;
    const mockResponse1 = {
      request: () => mockRequest1,
      status: () => 200,
      url: () => 'https://example.com/asset.js',
      headers: () => ({ 'content-type': 'application/javascript' })
    } as unknown as Response;

    requestCallback!(mockRequest1);
    await responseCallback!(mockResponse1);

    // 2. Simulate a failed API request (status 400)
    const mockRequest2 = {
      method: () => 'POST'
    } as unknown as Request;
    const mockResponse2 = {
      request: () => mockRequest2,
      status: () => 400,
      url: () => 'https://example.com/api/users',
      headers: () => ({ 'content-type': 'application/json' })
    } as unknown as Response;

    requestCallback!(mockRequest2);
    await responseCallback!(mockResponse2);

    // 3. Simulate a GraphQL success response containing errors
    const mockRequest3 = {
      method: () => 'POST'
    } as unknown as Request;
    const mockResponse3 = {
      request: () => mockRequest3,
      status: () => 200,
      url: () => 'https://example.com/graphql',
      headers: () => ({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ errors: [{ message: 'Unauthorized access' }] })
    } as unknown as Response;

    requestCallback!(mockRequest3);
    await responseCallback!(mockResponse3);

    // 4. Simulate a normal GraphQL success response (no errors)
    const mockRequest4 = {
      method: () => 'POST'
    } as unknown as Request;
    const mockResponse4 = {
      request: () => mockRequest4,
      status: () => 200,
      url: () => 'https://example.com/graphql',
      headers: () => ({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ data: { user: { name: 'Adithya' } } })
    } as unknown as Response;

    requestCallback!(mockRequest4);
    await responseCallback!(mockResponse4);

    const failed = tracker.getAndClearFailedRequests();
    assert.equal(failed.length, 2);

    // Verify first failure (status 400)
    assert.equal(failed[0].status, 400);
    assert.equal(failed[0].url, 'https://example.com/api/users');
    assert.equal(failed[0].isGraphQLError, false);

    // Verify second failure (GraphQL error)
    assert.equal(failed[1].status, 200);
    assert.equal(failed[1].url, 'https://example.com/graphql');
    assert.equal(failed[1].isGraphQLError, true);
    assert.deepEqual(failed[1].graphQLErrors, [{ message: 'Unauthorized access' }]);

    // Verify they are cleared after retrieve
    assert.equal(tracker.getAndClearFailedRequests().length, 0);
  });
});
