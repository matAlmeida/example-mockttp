import { faker } from '@faker-js/faker';
import { getLocal as mockttpGetLocal } from 'mockttp';
import URL from 'url';
import http from 'http';
import https from 'https';

export class SyntheticRequesterError extends Error {
  public request: any;

  constructor(message?: string, request?: any) {
    super(message);

    this.name = 'RequesterError';
    this.request = request;
  }
}

type RequesterCallback = (response: any) => any

export interface SyntheticRequesterDatasource {
  get(url: string, options?: https.RequestOptions): Promise<any>
}

export class SyntheticRequesterDatasourceImpl implements SyntheticRequesterDatasource {
  constructor(private baseUrl = '', private callback: RequesterCallback = (args) => args) { }

  public async get(url: string, options?: https.RequestOptions) {
    const response = await this.requester('GET', this.baseUrl.concat(url), undefined, options);

    return this.callback(response);
  }

  private requester = (method: string, url: string, data: any = '', options: https.RequestOptions = {}) => new Promise((resolve, reject) => {

    const { hostname, protocol, path, port } = URL.parse(url);

    const rawData = typeof data === 'object' ? JSON.stringify(data) : data;

    const requestData: https.RequestOptions = {
      ...options,
      path,
      method,
      hostname,
      protocol,
      port,
      headers: {
        ...options.headers,
        'Content-Length': rawData.length,
      },
    };

    const request = (protocol === 'https:' ? https : http).request(requestData, (response) => {

      let data = '';
      response.on('data', chunk => data += chunk);

      response.on('end', () => {
        let parsedData;

        try {
          parsedData = data ? JSON.parse(data) : data;
        } catch (error) {
          parsedData = data;
        }

        if ((response.statusCode || 500) >= 400) {
          const error = new SyntheticRequesterError(response.statusMessage, parsedData);
          reject(error);
        }

        resolve(parsedData);
      });
    });

    request.on('error', error => reject(error));

    if (rawData) {
      request.write(rawData);
    }

    request.end();

  });
}

describe('SyntheticRequesterDatasource', () => {
  describe('http', () => {
    const mockHttpServer = mockttpGetLocal({
      http2: false,
    });
    const mockHttpServerPort = 8080;
    mockHttpServer.start(mockHttpServerPort);

    beforeEach(() => {
      mockHttpServer.reset();
    });

    afterAll(() => {
      mockHttpServer.stop();
    });

    const baseUrl = `http://localhost:${mockHttpServerPort}`;
    const syntheticRequesterDatasource: SyntheticRequesterDatasource =
      new SyntheticRequesterDatasourceImpl(baseUrl);

    it('get 200', async () => {
      const endpoint = faker.random.word();
      const expectedResponse = faker.random.words(5);

      const endpointMock = await mockHttpServer.forGet(`/${endpoint}`).thenReply(200, expectedResponse);

      const response = await syntheticRequesterDatasource.get(`/${endpoint}`);

      expect(response).toBe(expectedResponse);

      const requests = await endpointMock.getSeenRequests();
      expect(requests.length).toBe(1);
      expect(requests[0].url).toBe(`${baseUrl}/${endpoint}`);
    });
  });
});